import { NextRequest, NextResponse } from 'next/server'

type Provider = 'anthropic' | 'openai-compatible'

function trimSlash(s: string) {
  return (s || '').replace(/\/+$/, '')
}

function normalizeOpenAIBase(baseUrl: string) {
  const base = trimSlash(baseUrl || 'https://api.openai.com/v1')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', ownedBy: 'anthropic' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', ownedBy: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5', ownedBy: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', ownedBy: 'anthropic' },
]

export async function POST(req: NextRequest) {
  try {
    const { provider = 'openai-compatible', baseUrl, apiKey } = await req.json() as {
      provider: Provider
      baseUrl?: string
      apiKey?: string
    }

    if (provider === 'anthropic') {
      return NextResponse.json({ models: ANTHROPIC_MODELS })
    }

    if (!apiKey) {
      return NextResponse.json({ error: '缺少 API Key，不能拉取模型列表。' }, { status: 400 })
    }

    const base = normalizeOpenAIBase(baseUrl || 'https://api.openai.com/v1')
    const url = `${base}/models`
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://lumbre.zeabur.app',
        'X-Title': 'Lumbre',
      },
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Upstream ${res.status}: ${text.slice(0, 800)}` }, { status: res.status })
    }

    const data = await res.json()
    
    // Handle various response formats from different providers
    let raw: any[] = []
    if (Array.isArray(data?.data)) {
      raw = data.data
    } else if (Array.isArray(data)) {
      raw = data
    } else if (data?.models && Array.isArray(data.models)) {
      raw = data.models
    } else if (data?.data?.models && Array.isArray(data.data.models)) {
      raw = data.data.models
    }

    const models = raw
      .map((m: any) => ({
        id: m.id || m.model || m.name || '',
        name: m.name || m.id || m.model || '',
        ownedBy: m.owned_by || m.ownedBy || m.provider || m.created_by || '',
        created: m.created,
      }))
      .filter((m: any) => m.id)
      .sort((a: any, b: any) => a.id.localeCompare(b.id))

    return NextResponse.json({ models, _debug: { url, rawCount: raw.length, totalParsed: models.length } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
