export interface ChatStreamEvent {
  type: string
  content?: string
  name?: string
  input?: unknown
  result?: string
  [key: string]: unknown
}

function parseDataLine(line: string): ChatStreamEvent | undefined {
  if (!line.startsWith('data: ')) return undefined
  const raw = line.slice(6).trimEnd()
  if (!raw || raw === '[DONE]') return undefined
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value as ChatStreamEvent : undefined
  } catch {
    // Proxies and upstreams may inject comments or malformed keepalive frames.
    return undefined
  }
}

/**
 * Reads the model gateway's SSE response without assuming network chunks align
 * with event boundaries. A server `done` event is authoritative, so we cancel
 * the reader instead of waiting indefinitely for a mobile proxy to close it.
 */
export async function* readChatEventStream(response: Response): AsyncGenerator<ChatStreamEvent> {
  if (!response.body) throw new Error('响应没有可读取的流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  try {
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const event = parseDataLine(line)
        if (!event) continue
        yield event
        if (event.type === 'done') {
          finished = true
          break
        }
      }
    }

    if (!finished && buffer) {
      const event = parseDataLine(buffer)
      if (event) yield event
    }
  } finally {
    if (finished) {
      try { await reader.cancel() } catch { /* the response may already be closed */ }
    }
    reader.releaseLock()
  }
}
