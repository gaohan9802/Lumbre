import { createHash } from 'node:crypto'
import { getDataDir } from '@/server/data/config'
import { readJsonFile, updateJsonFile } from '@/server/data/json-file'
import { resolveDataPath } from '@/server/data/safe-path'
import { choose, continueCampaign, createCampaign, currentPayload, progressPayload } from './engine'
import type { DetroitCampaign, DetroitDifficulty } from './types'

const ROOT = resolveDataPath(getDataDir(), 'detroit')

function savePath(sessionId: string): string {
  if (!sessionId || sessionId.length > 180) throw new Error('缺少有效的聊天会话')
  return resolveDataPath(ROOT, `${createHash('sha256').update(sessionId).digest('hex')}.json`)
}

function validSave(value: unknown): value is DetroitCampaign {
  const save = value as DetroitCampaign
  return !!save && save.schema_version === 1 && typeof save.campaign_id === 'string'
    && ['playing', 'between_chapters', 'complete'].includes(save.status)
    && Array.isArray(save.completed_chapters)
}

function readSave(sessionId: string): DetroitCampaign | null {
  return readJsonFile<DetroitCampaign | null>(savePath(sessionId), {
    fallback: () => null,
    validate: value => value === null || validSave(value),
  })
}

export function readDetroitGame(sessionId: string, detail = 'progress', chapterNumber?: number): Record<string, any> {
  const save = readSave(sessionId)
  if (!save) return { ok: true, status: 'not_started', instruction: '小火还没有在这个聊天里开始游戏。' }
  if (detail === 'current') return currentPayload(save)
  if (detail === 'history') {
    const chapter = Number.isSafeInteger(chapterNumber)
      ? save.completed_chapters.find(item => item.index === chapterNumber)
      : save.completed_chapters.at(-1)
    if (!chapter) return { ok: true, status: save.status, history: null }
    return {
      ok: true,
      status: save.status,
      chapter: { number: chapter.index, id: chapter.chapter_id, title: chapter.title },
      ending: chapter.ending,
      route: chapter.decisions.filter(decision => decision.choice_id).map(decision => ({
        node_id: decision.node_id,
        choice: decision.choice_text,
        reasoning: decision.reasoning,
      })),
    }
  }
  return progressPayload(save)
}

export function playDetroitGame(sessionId: string, input: Record<string, any>): Record<string, any> {
  const action = String(input.action || '')
  const filePath = savePath(sessionId)
  let payload: Record<string, any> | undefined
  updateJsonFile<DetroitCampaign | null>(filePath, {
    fallback: () => null,
    validate: value => value === null || validSave(value),
  }, current => {
    if (action === 'start') {
      if (current) {
        payload = currentPayload(current, { resumed: true })
        return current
      }
      const difficulty = String(input.difficulty || 'casual') as DetroitDifficulty
      if (!['casual', 'experienced', 'hardcore'].includes(difficulty)) throw new Error('未知游戏难度')
      const next = createCampaign(difficulty)
      payload = currentPayload(next, { resumed: false })
      return next
    }
    if (!current) throw new Error('游戏尚未开始，请先调用 start')
    if (action === 'continue') {
      continueCampaign(current)
      payload = currentPayload(current)
      return current
    }
    if (action === 'choose') {
      const deduplicated = choose(
        current,
        String(input.chapter_id || ''),
        String(input.node_id || ''),
        String(input.choice_id || ''),
        String(input.reasoning || ''),
      )
      payload = currentPayload(current, { deduplicated })
      return current
    }
    throw new Error('未知游戏操作')
  })
  if (!payload) throw new Error('游戏没有返回结果')
  return payload
}
