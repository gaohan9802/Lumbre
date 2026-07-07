import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { ALL_TOOLS } from '@/server/tools'

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

  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || '/persistent'
  const diaryDir = path.join(dataDir, 'diaries')
  const notesDir = path.join(dataDir, 'notes')

  const check = (p: string) => {
    try {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        const files = fs.readdirSync(p)
        return { exists: true, type: 'dir', count: files.length, files: files.slice(0, 10) }
      }
      return { exists: true, type: 'file', size: stat.size }
    } catch {
      return { exists: false }
    }
  }

  let sampleDiary = null
  try {
    const files = fs.readdirSync(diaryDir).filter(f => f.endsWith('.json'))
    if (files.length > 0) {
      const content = fs.readFileSync(path.join(diaryDir, files[0]), 'utf-8')
      sampleDiary = { filename: files[0], content: content.slice(0, 200) }
    }
  } catch (e: any) {
    sampleDiary = { error: e.message }
  }

  return NextResponse.json({
    version: 'v3-tool-debug-20260707',
    cwd, dataDir, diaryDir, notesDir,
    persistent: check(dataDir),
    diaries: check(diaryDir),
    notes: check(notesDir),
    seedDir: check(path.join(cwd, 'src', 'seed')),
    bucketsDir: check(path.join(dataDir, 'buckets')),
    tools: { count: ALL_TOOLS.length, names: ALL_TOOLS.map(t => t.name) },
    sampleDiary,
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
