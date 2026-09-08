export type ReceiptMetric = { chars: number; bytes: number }

export type MessageRequestAudit = {
  persona: ReceiptMetric
  summary: ReceiptMetric
  history: ReceiptMetric
  toolResults: ReceiptMetric
  toolDefinitions: ReceiptMetric
  currentContext: ReceiptMetric
  total: ReceiptMetric
}

export type RequestAuditHints = {
  summary?: ReceiptMetric
  currentContext?: ReceiptMetric
}

const EMPTY_METRIC: ReceiptMetric = { chars: 0, bytes: 0 }

export function measureReceiptText(value: unknown): ReceiptMetric {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return { chars: Array.from(text).length, bytes: new TextEncoder().encode(text).byteLength }
}

function safeMetric(value: unknown): ReceiptMetric {
  if (!value || typeof value !== 'object') return EMPTY_METRIC
  const metric = value as Partial<ReceiptMetric>
  const chars = Number(metric.chars)
  const bytes = Number(metric.bytes)
  return {
    chars: Number.isSafeInteger(chars) && chars >= 0 ? Math.min(chars, 50_000_000) : 0,
    bytes: Number.isSafeInteger(bytes) && bytes >= 0 ? Math.min(bytes, 200_000_000) : 0,
  }
}

function addMetrics(...values: ReceiptMetric[]): ReceiptMetric {
  return values.reduce((total, value) => ({
    chars: total.chars + value.chars,
    bytes: total.bytes + value.bytes,
  }), { ...EMPTY_METRIC })
}

export function createMessageRequestAudit({
  system,
  messages,
  tools,
  volatileContext,
  hints,
}: {
  system: string
  messages: unknown[]
  tools: unknown[]
  volatileContext: string
  hints?: RequestAuditHints
}): MessageRequestAudit {
  const persona = measureReceiptText(system)
  const summary = safeMetric(hints?.summary)
  const history = measureReceiptText(messages)
  const toolResults = { ...EMPTY_METRIC }
  const toolDefinitions = measureReceiptText(tools)
  const currentContext = addMetrics(safeMetric(hints?.currentContext), measureReceiptText(volatileContext))
  return {
    persona,
    summary,
    history,
    toolResults,
    toolDefinitions,
    currentContext,
    total: addMetrics(persona, summary, history, toolResults, toolDefinitions, currentContext),
  }
}

export function addToolResultsToAudit(audit: MessageRequestAudit, results: unknown): MessageRequestAudit {
  const toolResults = measureReceiptText(results)
  return {
    ...audit,
    toolResults,
    total: addMetrics(audit.persona, audit.summary, audit.history, toolResults, audit.toolDefinitions, audit.currentContext),
  }
}
