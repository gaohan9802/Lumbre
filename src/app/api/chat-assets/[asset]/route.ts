import { readChatImage } from '@/server/data/repositories/chat-assets'

export async function GET(_request: Request, context: { params: { asset: string } }) {
  const image = readChatImage(`/api/chat-assets/${context.params.asset}`)
  if (!image) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
