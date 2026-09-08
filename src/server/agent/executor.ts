import { createToolConfirmation, resolveToolConfirmation } from '@/server/data/repositories/tool-security'
import type { ToolCallContext } from './context'
import { createToolContext } from './context'
import { recordToolAudit } from './audit'
import { confirmationTarget, evaluateToolPolicy, resolveToolRisk } from './policy'
import { getRegisteredTool } from './registry'
import type { RegisteredTool, ToolExecutionRequest, ToolExecutionResult, ToolRiskLevel } from './types'

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
}

function auditBase(tool: RegisteredTool | undefined, request: ToolExecutionRequest, context: ToolCallContext, risk: ToolRiskLevel) {
  return {
    at: new Date().toISOString(),
    actorId: context.actorId,
    sessionId: context.sessionId,
    source: context.source,
    tool: request.name,
    domain: tool?.domain || 'unknown' as const,
    risk,
    inputKeys: Object.keys(request.input || {}).sort(),
    target: confirmationTarget(request.name, request.input || {}),
  }
}

async function runAllowedTool(
  tool: RegisteredTool,
  request: ToolExecutionRequest,
  context: ToolCallContext,
  confirmed: boolean,
): Promise<ToolExecutionResult> {
  const started = Date.now()
  const risk = resolveToolRisk(tool, request.input)
  try {
    const result = await tool.execute(request.input, context)
    const returnedError = result.startsWith('Tool error') || result.startsWith('Unknown tool:')
    recordToolAudit({
      ...auditBase(tool, request, context, risk),
      outcome: returnedError ? 'failed' : (confirmed ? 'confirmed' : 'allowed'),
      durationMs: Date.now() - started,
      error: returnedError ? result.slice(0, 300) : undefined,
    })
    return { ...request, result, error: returnedError || undefined }
  } catch (error) {
    const message = safeError(error)
    recordToolAudit({
      ...auditBase(tool, request, context, risk),
      outcome: 'failed',
      durationMs: Date.now() - started,
      error: message,
    })
    return { ...request, result: `Tool error (${request.name}): ${message}`, error: true }
  }
}

export async function executeTool(
  name: string,
  input: Record<string, any>,
  context: ToolCallContext = createToolContext(),
): Promise<string> {
  const request = { name, input: input || {} }
  const tool = getRegisteredTool(name)
  if (!tool) {
    recordToolAudit({ ...auditBase(undefined, request, context, 'black'), outcome: 'denied', error: 'Unknown tool' })
    return `Tool denied: Unknown tool ${name}`
  }

  const decision = evaluateToolPolicy(tool, request.input, context)
  if (decision.requiresConfirmation) {
    const { token, confirmation } = createToolConfirmation({
      tool: name,
      input: request.input,
      actorId: context.actorId,
      sessionId: context.sessionId,
      requestedSource: context.source,
    })
    recordToolAudit({ ...auditBase(tool, request, context, decision.level), outcome: 'confirmation-required' })
    return JSON.stringify({
      ok: false,
      code: 'CONFIRMATION_REQUIRED',
      message: '需要小火确认后才能执行',
      confirmation: {
        token,
        id: confirmation.id,
        tool: name,
        label: tool.confirmationLabel || name,
        target: confirmationTarget(name, request.input),
        expiresAt: confirmation.expiresAt,
      },
    })
  }

  if (!decision.allowed) {
    recordToolAudit({ ...auditBase(tool, request, context, decision.level), outcome: 'denied', error: decision.reason })
    return `Tool denied: ${decision.reason}`
  }

  return (await runAllowedTool(tool, request, context, false)).result
}

export async function executeToolBatch(
  calls: ToolExecutionRequest[],
  context: ToolCallContext,
  maxCalls: number,
): Promise<ToolExecutionResult[]> {
  const limit = Math.max(0, Math.floor(maxCalls))
  const results: ToolExecutionResult[] = []
  let stopWrites = false
  for (let index = 0; index < calls.length; index += 1) {
    const call = { name: calls[index].name, input: calls[index].input || {} }
    const registered = getRegisteredTool(call.name)
    if (stopWrites && registered && resolveToolRisk(registered, call.input) !== 'green') {
      const result = 'Tool denied: a previous write or destructive tool failed'
      recordToolAudit({
        ...auditBase(registered, call, context, resolveToolRisk(registered, call.input)),
        outcome: 'denied',
        error: 'Previous write or destructive tool failed',
      })
      results.push({ ...call, result, error: true })
      continue
    }
    if (index >= limit) {
      const result = 'Tool denied: per-request tool call limit reached'
      recordToolAudit({
        ...auditBase(getRegisteredTool(call.name), call, context, 'black'),
        outcome: 'denied',
        error: 'Per-request tool call limit reached',
      })
      results.push({ ...call, result, error: true })
      continue
    }
    // Deliberately sequential: destructive/write operations can never race one another.
    const result = await executeTool(call.name, call.input, context)
    const error = result.startsWith('Tool denied:') || result.startsWith('Tool error')
    if (error && (!registered || resolveToolRisk(registered, call.input) !== 'green')) stopWrites = true
    results.push({ ...call, result, error })
  }
  return results
}

export async function resolveAndExecuteToolConfirmation(options: {
  token: string
  actorId?: string
  sessionId?: string
  approve: boolean
}): Promise<{ ok: boolean; code?: string; result?: string; tool?: string }> {
  const actorId = options.actorId || 'lumbre-authenticated-user'
  const resolved = resolveToolConfirmation(options.token, actorId, options.sessionId, options.approve)
  if (!resolved.ok) return { ok: false, code: resolved.code }

  const confirmation = resolved.confirmation
  const context = createToolContext({ actorId, sessionId: options.sessionId, source: 'user-confirmed' })
  const request = { name: confirmation.tool, input: confirmation.input }
  const tool = getRegisteredTool(request.name)
  if (!options.approve) {
    recordToolAudit({ ...auditBase(tool, request, context, tool ? resolveToolRisk(tool, request.input) : 'black'), outcome: 'rejected' })
    return { ok: true, code: 'rejected', tool: request.name, result: '用户已取消操作' }
  }
  if (!tool) return { ok: false, code: 'unknown-tool' }

  const decision = evaluateToolPolicy(tool, request.input, context, true)
  if (!decision.allowed) {
    recordToolAudit({ ...auditBase(tool, request, context, decision.level), outcome: 'denied', error: decision.reason })
    return { ok: false, code: 'denied', tool: request.name, result: decision.reason }
  }

  const result = await runAllowedTool(tool, request, context, true)
  return { ok: !result.error, tool: request.name, result: result.result }
}

export type { ToolExecutionResult as ToolCallResult } from './types'
