export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getChapter, getAnnotations, updateProgress } from '@/server/coread-store'
import { ensureDigest } from '@/server/coread-digest'
import { LLMProfile } from '@/server/coread-llm'

function resolveProfile(apiProfile: any): LLMProfile | null {
  if (apiProfile?.apiKey) {
    return {
      provider: apiProfile.provider === 'anthropic' ? 'anthropic' : 'openai-compatible',
      baseUrl: apiProfile.baseUrl || '',
      apiKey: apiProfile.apiKey,
      model: apiProfile.modelId || apiProfile.model || 'claude-sonnet-4-20250514',
    }
  }
  const baseUrl = process.env.LLM_BASE_URL || process.env.COREAD_LLM_BASE_URL || ''
  const apiKey = process.env.LLM_API_KEY || process.env.COREAD_LLM_API_KEY || ''
  const model = process.env.LLM_MODEL || process.env.COREAD_LLM_MODEL || 'deepseek-chat'
  if (!baseUrl || !apiKey) return null
  return { provider: 'openai-compatible', baseUrl, apiKey, model }
}

// POST /api/coread/chapter — get chapter content + annotations
// Body: { bookId, chapterNum, api_profile? }
export async function POST(req: NextRequest) {
  try {
    const { bookId, chapterNum, api_profile } = await req.json()
    if (!bookId || chapterNum === undefined) {
      return NextResponse.json({ error: 'missing bookId or chapterNum' }, { status: 400 })
    }

    const chapter = getChapter(bookId, chapterNum)
    if (!chapter) {
      return NextResponse.json({ error: '章节不存在' }, { status: 404 })
    }

    updateProgress(bookId, chapterNum)

    // Sequential reading accumulates story arc: backfill the chapter we just
    // left (chapterNum - 1) so anti-spoiler digests exist even without chatting.
    if (chapterNum > 1) {
      const profile = resolveProfile(api_profile)
      if (profile) void ensureDigest(profile, bookId, chapterNum - 1)
    }

    const annotations = getAnnotations(bookId, chapterNum)

    return NextResponse.json({
      chapter: {
        chapterNum: chapter.chapterNum,
        title: chapter.title,
        content: chapter.content,
        digest: chapter.digest,
      },
      annotations,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
