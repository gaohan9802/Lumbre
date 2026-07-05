import { NextRequest } from 'next/server'
import { proxyBrainGet } from '../../_helpers'
export const POST = async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  return proxyBrainGet('/api/search', {
    q: body.query || '',
    limit: String(body.limit || 20),
    include_vector: body.include_vector ? 'true' : 'false',
  })
}
export const GET = (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q') || ''
  return proxyBrainGet('/api/search', { q, limit: '20' })
}
