/**
 * coread-digest.ts — 章节脉络摘要生成，带并发去重锁。
 * 供 chat/chapter 路由共享调用：同一 (book, chapter) 只会有一个在途请求，
 * 避免翻页 + 聊天同时触发导致的重复 LLM 调用。
 */
import { callLLM, LLMProfile } from './coread-llm'
import { getChapter, getDigest, setDigest } from './coread-store'

const inFlight = new Map<string, Promise<string>>()

const DIGEST_SYS = '你是一个精准的情节摘要助手，只依据给定原文，不臆造。'
const DIGEST_PROMPT =
  '下面是一本书某一章的原文。写一段不超过120字的情节脉络摘要（发生了什么、出场人物、关键转折），纯叙述、无标题无列表无markdown，直接输出正文：\n\n'

/**
 * 确保某章有 digest。已有则直接返回；没有则生成（去重）。
 * profile 为空或章节过短时静默返回空串。
 */
export function ensureDigest(profile: LLMProfile | null | undefined, bookId: string, cnum: number): Promise<string> {
  if (!profile?.apiKey || !cnum || cnum < 1) return Promise.resolve('')
  const existing = getDigest(bookId, cnum)
  if (existing) return Promise.resolve(existing)

  const key = `${bookId}:${cnum}`
  const running = inFlight.get(key)
  if (running) return running

  const ch = getChapter(bookId, cnum)
  if (!ch || (ch.content || '').length < 200) return Promise.resolve('')

  const raw = ch.content.replace(/\s+/g, ' ').slice(0, 7000)
  const task = callLLM(profile, [{ role: 'user', content: DIGEST_PROMPT + raw }], DIGEST_SYS, {
    maxTokens: 240,
    temperature: 0.3,
  })
    .then((out) => {
      const digest = (out || '').trim()
      if (digest.length > 10) {
        setDigest(bookId, cnum, digest)
        return digest
      }
      return ''
    })
    .catch(() => '')
    .finally(() => { inFlight.delete(key) })

  inFlight.set(key, task)
  return task
}
