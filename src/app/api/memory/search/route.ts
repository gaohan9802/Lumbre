import { NextRequest } from 'next/server'
import { proxyBrainGet } from '../../_helpers'
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  return proxyBrainGet(req, `/api/search?q=${encodeURIComponent(q)}`)
}
