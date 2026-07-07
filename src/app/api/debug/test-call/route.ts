import { NextRequest, NextResponse } from 'next/server'
import { ALL_TOOLS } from '@/server/tools'

export async function POST(req: NextRequest) {
  const { apiKey, message = '你现在有哪些工具可以用？简要列出' } = await req.json()
  if (!apiKey) return NextResponse.json({ error: 'apiKey required' }, { status: 400 })

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: '你是测试助手。请如实回答你当前可以调用哪些工具。',
    tools: ALL_TOOLS,
    messages: [{ role: 'user', content: message }],
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  
  return NextResponse.json({
    status: res.status,
    tools_sent: ALL_TOOLS.length,
    tool_names: ALL_TOOLS.map(t => t.name),
    response: data,
  })
}
