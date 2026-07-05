import { NextRequest } from 'next/server'
import { proxyBrainMethod } from '../../_helpers'
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  return proxyBrainMethod(req, `/api/bucket/${id}/pin`, 'POST')
}
