import { NextRequest } from 'next/server'
import { proxyBrainGet } from '../../_helpers'
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  const v = req.nextUrl.searchParams.get('valence') || ''
  const a = req.nextUrl.searchParams.get('arousal') || ''
  let path = `/api/breath-debug?q=${encodeURIComponent(q)}`
  if (v) path += `&valence=${v}`
  if (a) path += `&arousal=${a}`
  return proxyBrainGet(req, path)
}
