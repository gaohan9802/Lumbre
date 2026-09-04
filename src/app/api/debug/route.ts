import { NextRequest, NextResponse } from 'next/server'
import { ALL_TOOLS } from '@/server/agent/registry'
import { inspectLegacyChatRaw, inspectLegacyChatSessions, inspectPersistentData } from '@/server/data/diagnostics'

export async function GET(req: NextRequest) {
  const testMode = req.nextUrl.searchParams.get('test')
  
  if (testMode === 'tools') {
    return NextResponse.json({
      count: ALL_TOOLS.length,
      tools: ALL_TOOLS.map(t => t.name),
      sample_schema: ALL_TOOLS[0],
    })
  }

  if (testMode === 'version') {
    return NextResponse.json({ version: 'v3-tool-debug-20260707', timestamp: Date.now() })
  }

  if (testMode === 'raw') {
    return NextResponse.json(inspectLegacyChatRaw())
  }

  if (testMode === 'sessions') {
    return NextResponse.json(inspectLegacyChatSessions())
  }

  return NextResponse.json({
    ...inspectPersistentData(),
    tools: { count: ALL_TOOLS.length, names: ALL_TOOLS.map(t => t.name) },
  })
}

// POST: test Claude API call with tools
export async function POST(req: NextRequest) {
  try {
    const { apiKey, message = '你可以使用哪些工具？列出来' } = await req.json()
    
    if (!apiKey) {
      return NextResponse.json({ error: 'Send { "apiKey": "sk-ant-...", "message": "..." }' }, { status: 400 })
    }
    
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: '你是一个测试助手。请如实列出你当前可以调用的所有工具。',
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
      api_status: res.status,
      tools_sent_count: ALL_TOOLS.length,
      tools_sent_names: ALL_TOOLS.map(t => t.name),
      response: data,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
