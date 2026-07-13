import { NextRequest } from 'next/server'
import { getPhoto } from '@/server/photo-store'

/**
 * Serve a stored photo as a real HTTP image (decoded from its base64 dataUrl).
 * Lets us pass small http(s) image URLs to upstream vision models instead of
 * bloated base64 payloads — many OpenAI-compatible relays choke on data: URLs.
 */
export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const photo = getPhoto(ctx.params.id)
  if (!photo?.url) return new Response('not found', { status: 404 })

  const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(photo.url)
  if (!m) {
    // Already a remote URL — redirect to it.
    return Response.redirect(photo.url, 302)
  }
  const buf = Buffer.from(m[2], 'base64')
  return new Response(buf, {
    headers: {
      'Content-Type': m[1] || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
