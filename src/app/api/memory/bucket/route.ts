import { NextRequest } from 'next/server'
import { proxyBrainGet } from '../../_helpers'
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  return proxyBrainGet(req, `/api/bucket/${id}`)
}
