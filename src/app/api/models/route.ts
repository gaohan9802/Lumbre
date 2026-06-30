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
]

export async function POST(req: NextRequest) {
  try {
    const { provider = 'openai-compatible', baseUrl, apiKey } = await req.json() as {
      provider: Provider
      baseUrl?: string
      apiKey?: string
    }

    if (provider === 'anthropic') {
      // Anthropic does not need a remote fetch for our current use case; keep a stable seed list
      // and allow manual model IDs in the UI.
      return NextResponse.json({ models: ANTHROPIC_MODELS })
    }

    if (!apiKey) {
      return NextResponse.json({ error: '缺少 API Key，不能拉取模型列表。' }, { status: 400 })
    }

    const res = await fetch(`${normalizeOpenAIBase(baseUrl || 'https://api.openai.com/v1')}/models`, {
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
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
    const models = raw
      .map((m: any) => ({
        id: m.id || m.name,
        name: m.name || m.id,
        ownedBy: m.owned_by || m.ownedBy || m.provider,
        created: m.created,
      }))
      .filter((m: any) => m.id)
      .sort((a: any, b: any) => a.id.localeCompare(b.id))

    return NextResponse.json({ models })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
