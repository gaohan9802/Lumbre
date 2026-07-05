import { NextRequest } from 'next/server'
import { proxyBrainGet } from '../../_helpers'
export const POST = async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  const id = body.bucket_id || ''
  if (!id) return new Response('missing bucket_id', { status: 400 })
  return proxyBrainGet(`/api/bucket/${id}`)
}
