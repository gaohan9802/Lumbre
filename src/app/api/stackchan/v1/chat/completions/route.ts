import { randomUUID } from 'node:crypto'
import { hasMatchingBearerSecret } from '@/server/bearer-auth'
import { createTransportBatchId, runTransportTurn } from '@/server/chat/transport-turn'

export const runtime = 'nodejs'

const maxBodyBytes = 16 * 1024
const noStore = { 'Cache-Control': 'no-store' }

function error(message: string, status: number) {
  return Response.json({ error: { message } }, { status, headers: noStore })
}

function latestUserInput(messages: { role?: unknown; content?: unknown }[]) {
  const content = messages.findLast(message => message?.role === 'user')?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const text = content
    .filter(part => part && typeof part === 'object' && (part as any).type === 'text')
    .map(part => String((part as any).text || '').trim()).filter(Boolean).join('\n')
  return text
}

export async function POST(request: Request) {
  if (!hasMatchingBearerSecret(request.headers.get('authorization'), process.env.LUMBRE_STACKCHAN_SECRET || '')) {
    return error('Unauthorized', 401)
  }
  const sessionId = process.env.LUMBRE_STACKCHAN_SESSION_ID?.trim()
  if (!sessionId) return error('StackChan chat window is not configured', 503)
  if (Number(request.headers.get('content-length')) > maxBodyBytes) return error('Request too large', 413)

  let body: { messages?: { role?: unknown; content?: unknown }[]; stream?: boolean }
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > maxBodyBytes) return error('Request too large', 413)
    body = JSON.parse(raw)
  } catch {
    return error('Invalid JSON', 400)
  }
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const text = latestUserInput(messages)
  if (!text || text.length > 4000) return error('Expected a user transcript of 1–4000 characters', 400)

  const requestId = request.headers.get('idempotency-key') || randomUUID()
  const batchId = createTransportBatchId('stackchan', JSON.stringify([requestId, text]))
  const part = { externalId: batchId, text, timestamp: Date.now(), images: [] }
  try {
    const reply = await runTransportTurn('stackchan', sessionId, batchId, [part])
    const completion = { id: `chatcmpl-${batchId}`, created: Math.floor(Date.now() / 1000), model: 'lumbre-star' }
    if (body.stream === true) {
      const chunk = (delta: object, finish_reason: 'stop' | null) => JSON.stringify({
        ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }],
      })
      const result = `data: ${chunk({ role: 'assistant', content: reply.text }, null)}\n\ndata: ${chunk({}, 'stop')}\n\ndata: [DONE]\n\n`
      return new Response(result, { headers: { ...noStore, 'Content-Type': 'text/event-stream; charset=utf-8' } })
    }
    return Response.json({
      ...completion, object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: reply.text }, finish_reason: 'stop' }],
    }, { headers: noStore })
  } catch {
    return error('Lumbre could not complete the voice turn', 502)
  }
}
