import { getPencilDrawingImage } from '@/server/data/repositories/pencil-drawings'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: { id: string } }) {
  const image = getPencilDrawingImage(context.params.id)
  if (!image) return new Response('not found', { status: 404 })
  return new Response(Uint8Array.from(image), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Length': String(image.length),
    },
  })
}

