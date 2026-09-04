import { NextRequest, NextResponse } from 'next/server'
import { resolveChatCredential } from '@/server/chat/credentials'
import { assertPublicHttpUrl } from '@/server/agent/tools/web-fetch'

type Provider = 'anthropic' | 'openai-compatible'

function trimSlash(s: string) {
  return (s || '').replace(/\/+$/, '')
}

const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', ownedBy: 'anthropic' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', ownedBy: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5', ownedBy: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', ownedBy: 'anthropic' },
]

/**
 * Build an ordered, de-duplicated list of candidate `/models` URLs from a raw base.
 * 民间中转站 base 五花八门：有的带 /v1，有的不带；anthropic 官方在 /v1/models。
 * provider 只决定尝试顺序，两种路径都会试，最大化兼容。
 */
function candidateModelUrls(rawBase: string, provider: Provider): string[] {
  const base = trimSlash(rawBase || (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'))
  const noV1 = base.replace(/\/v1$/, '')
  const withV1 = base.endsWith('/v1') ? base : `${base}/v1`

  const v1Url = `${withV1}/models`
  const bareUrl = `${noV1}/models`
  const asIsUrl = `${base}/models`

  const ordered = provider === 'openai-compatible'
    ? [v1Url, asIsUrl, bareUrl]
    : [v1Url, asIsUrl, bareUrl]

  return Array.from(new Set(ordered))
}

/** Parse many provider response shapes into a raw model array. */
function parseModelsPayload(data: any): any[] {
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.models)) return data.models
  if (Array.isArray(data?.data?.models)) return data.data.models
  return []
}

function normalizeModels(raw: any[]) {
  return raw
    .map((m: any) => ({
      id: m.id || m.model || m.name || '',
      name: m.name || m.id || m.model || '',
      ownedBy: m.owned_by || m.ownedBy || m.provider || m.created_by || '',
      created: m.created,
    }))
    .filter((m: any) => m.id)
    .sort((a: any, b: any) => a.id.localeCompare(b.id))
}

/** Single request with a superset of auth headers — servers ignore what they don't need. */
async function tryFetch(url: string, apiKey: string): Promise<{ ok: boolean; status: number; models?: any[]; text?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 9000)
  try {
    await assertPublicHttpUrl(url)
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        // OpenAI-style
        Authorization: `Bearer ${apiKey}`,
        // Anthropic-style — harmless to OpenAI servers
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'HTTP-Referer': 'https://lumbre.zeabur.app',
        'X-Title': 'Lumbre',
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, text }
    }
    const data = await res.json().catch(() => null)
    return { ok: true, status: res.status, models: parseModelsPayload(data) }
  } catch (err: any) {
    return { ok: false, status: 0, text: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'network error') }
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profileId } = await req.json() as { profileId?: string }
    const credential = resolveChatCredential(profileId)

    if (!credential) {
      return NextResponse.json({ error: '这个模型渠道还没有在服务器配置凭据。' }, { status: 400 })
    }

    const { provider, baseUrl, apiKey } = credential

    const urls = candidateModelUrls(baseUrl || '', provider)
    const attempts: { upstreamOrigin: string; status: number }[] = []

    // Fire all candidates concurrently — a slow/unreachable station shouldn't
    // block the others (sequential 3×9s could stall the whole request).
    const results = await Promise.all(urls.map(async (url) => ({ url, r: await tryFetch(url, apiKey) })))
    for (const { url, r } of results) {
      attempts.push({ upstreamOrigin: new URL(url).origin, status: r.status })
      if (r.ok && r.models && r.models.length > 0) {
        const models = normalizeModels(r.models)
        if (models.length > 0) {
          return NextResponse.json({ models, _debug: { upstreamOrigin: new URL(url).origin, rawCount: r.models.length, totalParsed: models.length } })
        }
      }
    }

    // 全部失败：anthropic 至少给内置列表兜底，别让用户空手而归
    if (provider === 'anthropic') {
      return NextResponse.json({
        models: ANTHROPIC_MODELS,
        _debug: { fallback: true, note: '中转站未返回模型列表，已使用内置 Claude 列表兜底。如需其它模型请手动添加模型 ID。', attempts },
      })
    }

    const last = attempts[attempts.length - 1]
    return NextResponse.json({
      error: `拉取模型失败。尝试了 ${attempts.length} 个地址都没成功。最后一次：${last?.upstreamOrigin} → ${last?.status || 'network'}`.trim(),
      _debug: { attempts },
    }, { status: 502 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
