import { NextRequest } from 'next/server'
import { photoThumbnail } from '@/server/photo-store'

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const thumbnail = await photoThumbnail(ctx.params.id)
  if (!thumbnail) return new Response('not found', { status: 404 })
  if (thumbnail.redirect) return Response.redirect(thumbnail.redirect, 302)
  return new Response(thumbnail.bytes ? new Uint8Array(thumbnail.bytes) : null, {
    headers: {
      'Content-Type': thumbnail.mime || 'image/webp',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
