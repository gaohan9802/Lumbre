import { NextRequest, NextResponse } from 'next/server'
import { acceptWeComMessage, decodeWeComEnvelope, parseWeComMessage } from '@/server/wechat/wecom'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function query(request: NextRequest, key: string) {
  return request.nextUrl.searchParams.get(key) || ''
}

function error(cause: unknown, status = 403) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new NextResponse(message, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: NextRequest) {
  try {
    const echo = decodeWeComEnvelope({
      signature: query(request, 'msg_signature'),
      timestamp: query(request, 'timestamp'),
      nonce: query(request, 'nonce'),
      encrypted: query(request, 'echostr'),
    })
    return new NextResponse(echo, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch (cause) { return error(cause) }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 1_000_000) return error('企业微信回调过大', 413)
    const encrypted = /<Encrypt>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/Encrypt>/.exec(raw)
    const value = String(encrypted?.[1] ?? encrypted?.[2] ?? '').trim()
    if (!value) return error('企业微信回调缺少密文', 400)
    const xml = decodeWeComEnvelope({
      signature: query(request, 'msg_signature'),
      timestamp: query(request, 'timestamp'),
      nonce: query(request, 'nonce'),
      encrypted: value,
    })
    const message = parseWeComMessage(xml)
    if (message) acceptWeComMessage(message)
    return new NextResponse('success', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch (cause) { return error(cause) }
}
