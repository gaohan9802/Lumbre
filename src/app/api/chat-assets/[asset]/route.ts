import { readChatImage, storeChatImage } from '@/server/data/repositories/chat-assets'

const MAX_AVATAR_BODY = 1_500_000

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

export async function POST(request: Request, context: { params: { asset: string } }) {
  if (context.params.asset !== 'avatar') return Response.json({ error: 'not found' }, { status: 404 })
  const length = Number(request.headers.get('content-length') || 0)
  if (length > MAX_AVATAR_BODY) return Response.json({ error: '头像文件太大' }, { status: 413 })
  const body = await request.json().catch(() => ({}))
  const image = typeof body.image === 'string' ? body.image : ''
  if (!image || image.length > MAX_AVATAR_BODY) return Response.json({ error: '头像文件无效' }, { status: 400 })
  const url = storeChatImage(image)
  if (!url.startsWith('/api/chat-assets/')) return Response.json({ error: '只支持常见图片格式' }, { status: 400 })
  return Response.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
