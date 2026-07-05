import { NextRequest } from 'next/server'
import { proxyBrainGet } from '../../_helpers'
export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit') || '50'
  return proxyBrainGet(req, `/api/import/results?limit=${limit}`)
}
