import { NextRequest, NextResponse } from 'next/server'
import {
  deleteModelCredential,
  upsertModelCredential,
} from '@/server/data/repositories/model-credentials'
import { listChatCredentialStatus } from '@/server/chat/credentials'

export const dynamic = 'force-dynamic'

function noStore(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, {
    ...init,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', ...(init.headers || {}) },
  })
}

export async function GET() {
  try {
    return noStore({ profiles: listChatCredentialStatus() })
  } catch (error: any) {
    return noStore({ error: error?.message || '读取模型渠道失败' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const profiles = Array.isArray(body.profiles) ? body.profiles : [body]
    let updated = 0
    const failures: Array<{ id: string; error: string }> = []
    for (const profile of profiles) {
      if (!profile?.id || !profile?.apiKey) continue
      try {
        upsertModelCredential({
          id: String(profile.id),
          provider: profile.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic',
          baseUrl: String(profile.baseUrl || ''),
          apiKey: String(profile.apiKey),
        })
        updated++
      } catch (error: any) {
        failures.push({ id: String(profile.id), error: String(error?.message || '保存失败') })
      }
    }
    if (!updated) return noStore({ error: failures[0]?.error || '缺少模型渠道 ID 或 API Key', failures }, { status: 400 })
    return noStore({ ok: true, updated, failures, profiles: listChatCredentialStatus() })
  } catch (error: any) {
    return noStore({ error: error?.message || '保存模型渠道失败' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body.id || '').trim()
    if (!id) return noStore({ error: '缺少模型渠道 ID' }, { status: 400 })
    return noStore({ ok: true, removed: deleteModelCredential(id) })
  } catch (error: any) {
    return noStore({ error: error?.message || '删除模型渠道失败' }, { status: 500 })
  }
}
