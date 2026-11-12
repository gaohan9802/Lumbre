#!/usr/bin/env node

import fs from 'node:fs'
import readline from 'node:readline'

function readContext() {
  const contextFile = process.argv[2]
  if (!contextFile) return {}
  try {
    const stat = fs.statSync(contextFile)
    if (!stat.isFile() || stat.size > 8 * 1024) throw new Error('invalid context file')
    return JSON.parse(fs.readFileSync(contextFile, 'utf8'))
  } finally {
    try { fs.unlinkSync(contextFile) } catch {}
  }
}

const context = readContext()
const bridgeUrl = String(context.bridgeUrl || '')
const bridgeSecret = String(context.bridgeSecret || '')
const conversationId = String(context.conversationId || '')
const eventFile = String(context.eventFile || '')
const maxCalls = Math.max(1, Math.min(20, Number(context.maxCalls) || 20))
const source = ['unattended-wake', 'work'].includes(context.source) ? context.source : 'chat'
const cacheWarm = context.cacheWarm === true
const toolCallsDenied = context.toolCallsDenied === true
let calls = 0

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function error(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

function safeInput(value, depth = 0) {
  if (depth > 4) return '[nested]'
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeInput(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
    key,
    /password|token|secret|api[_-]?key|authorization/i.test(key) ? '[redacted]' : safeInput(item, depth + 1),
  ]))
}

function recordToolEvent(payload, input, phase, callId) {
  if (!eventFile) return
  const event = {
    phase,
    callId: String(callId ?? '').slice(0, 120),
    name: String(payload.name || '').slice(0, 120),
    input: safeInput(input),
    ...(phase === 'complete' ? {
      result: String(payload.result || '').slice(0, 16_000),
      error: payload.isError === true,
    } : {}),
  }
  fs.appendFileSync(eventFile, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function bridge(pathname = '', init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  timer.unref()
  try {
    const response = await fetch(`${bridgeUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${bridgeSecret}`,
        ...(init.headers || {}),
      },
      signal: controller.signal,
    })
    const text = await response.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch { data = {} }
    if (!response.ok) throw new Error(String(data?.error || `Lumbre tool bridge returned ${response.status}`))
    return data
  } finally {
    clearTimeout(timer)
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return error(message?.id ?? null, -32600, 'Invalid request')
  if (message.method === 'notifications/initialized') return
  if (message.method === 'ping') return write({ jsonrpc: '2.0', id: message.id, result: {} })
  if (message.method === 'initialize') {
    return write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: String(message.params?.protocolVersion || '2025-06-18'),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lumbre', version: '1.0.0' },
      },
    })
  }
  if (message.method === 'tools/list') {
    // Each window keeps a stable schema; work windows intentionally see only
    // the read-only subset while ordinary chat/wake schemas remain unchanged.
    const data = await bridge(`?session_id=${encodeURIComponent(conversationId)}&source=${encodeURIComponent(source === 'work' ? 'work' : 'chat')}`)
    return write({ jsonrpc: '2.0', id: message.id, result: { tools: Array.isArray(data.tools) ? data.tools : [] } })
  }
  if (message.method === 'tools/call') {
    if (cacheWarm || toolCallsDenied) {
      return write({ jsonrpc: '2.0', id: message.id, result: {
        content: [{ type: 'text', text: cacheWarm ? 'Tool denied during silent cache warm' : 'Tool denied in this chat-only channel' }],
        isError: true,
      } })
    }
    if (calls >= maxCalls) {
      return write({ jsonrpc: '2.0', id: message.id, result: {
        content: [{ type: 'text', text: 'Tool denied: per-request tool call limit reached' }],
        isError: true,
      } })
    }
    calls += 1
    const name = String(message.params?.name || '')
    const input = message.params?.arguments && typeof message.params.arguments === 'object'
      ? message.params.arguments : {}
    recordToolEvent({ name }, input, 'start', message.id)
    const data = await bridge('', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: conversationId, source, name, input }),
    })
    recordToolEvent(data, input, 'complete', message.id)
    return write({ jsonrpc: '2.0', id: message.id, result: {
      content: Array.isArray(data.content) ? data.content : [{ type: 'text', text: String(data.result || '') }],
      isError: data.isError === true,
    } })
  }
  if (message.id !== undefined) error(message.id, -32601, 'Method not found')
}

if (!/^https?:\/\//.test(bridgeUrl) || bridgeSecret.length < 32 || !conversationId || !eventFile) {
  process.stderr.write('LUMBRE_MCP_START_FAILED invalid bridge configuration\n')
  process.exit(1)
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
let queue = Promise.resolve()
input.on('line', line => {
  queue = queue.then(async () => {
    let message
    try { message = JSON.parse(line) }
    catch { return error(null, -32700, 'Parse error') }
    try { await handle(message) }
    catch (cause) {
      if (message?.id !== undefined) error(message.id, -32603, cause instanceof Error ? cause.message.slice(0, 300) : 'Internal error')
    }
  })
})
