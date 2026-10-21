import { formatMadrid, lumbreTogetherDays, madridDateKey } from '@/lib/madrid-time'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { assertDateKey, assertIdentifier, resolveDataPath } from './data/safe-path'

export interface NosePoke {
  id: string
  timestamp: number
  sessionId?: string
}

const NOSE_POKE_DIR = resolveDataPath(getDataDir(), 'nose-pokes')

function fileFor(day: string) {
  return resolveDataPath(NOSE_POKE_DIR, `${assertDateKey(day, 'nose poke date')}.json`)
}

function validPokes(value: unknown): value is NosePoke[] {
  return Array.isArray(value) && value.every(item => (
    !!item && typeof item === 'object'
    && typeof item.id === 'string' && !!item.id
    && typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
    && (item.sessionId === undefined || typeof item.sessionId === 'string')
  ))
}

function sessionId(value: string): string {
  return assertIdentifier(value, /^[A-Za-z0-9_-]{1,180}$/, 'chat session id')
}

export function readNosePokes(day = madridDateKey(), session?: string): NosePoke[] {
  const pokes = readJsonFile(fileFor(day), {
    fallback: () => [] as NosePoke[],
    fallbackOnInvalid: true,
    validate: validPokes,
  })
  return session ? pokes.filter(poke => poke.sessionId === sessionId(session)) : pokes
}

export function recordNosePoke(session: string, now = Date.now()): NosePoke[] {
  const day = madridDateKey(now)
  const safeSessionId = sessionId(session)
  const poke = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, timestamp: now, sessionId: safeSessionId }
  const pokes = updateJsonFile(fileFor(day), {
    fallback: () => [] as NosePoke[],
    fallbackOnInvalid: true,
    validate: validPokes,
  }, current => [...current, poke])
  return pokes.filter(item => item.sessionId === safeSessionId)
}

export function dailyCompanionContext(session?: string, now = Date.now()): string {
  const pokes = session ? readNosePokes(madridDateKey(now), session) : []
  const parts = [`[今日小信息]\n今天是小火和星星在一起的第 ${lumbreTogetherDays(now)} 天。`]
  if (pokes.length) {
    const times = pokes.map(poke => formatMadrid(poke.timestamp, false).slice(-5)).join('、')
    parts.push(`[今日戳鼻子]\n小火今天一共戳了豹子鼻子 ${pokes.length} 次。\n时间：${times}。`)
  }
  return parts.join('\n')
}
