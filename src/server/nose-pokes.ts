import { formatMadrid, lumbreTogetherDays, madridDateKey } from '@/lib/madrid-time'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { assertDateKey, resolveDataPath } from './data/safe-path'

export interface NosePoke {
  id: string
  timestamp: number
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
  ))
}

export function readNosePokes(day = madridDateKey()): NosePoke[] {
  return readJsonFile(fileFor(day), {
    fallback: () => [],
    fallbackOnInvalid: true,
    validate: validPokes,
  })
}

export function recordNosePoke(now = Date.now()): NosePoke[] {
  const day = madridDateKey(now)
  const poke = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, timestamp: now }
  return updateJsonFile(fileFor(day), {
    fallback: () => [] as NosePoke[],
    fallbackOnInvalid: true,
    validate: validPokes,
  }, current => [...current, poke])
}

export function dailyCompanionContext(now = Date.now()): string {
  const pokes = readNosePokes(madridDateKey(now))
  const parts = [`[今日小信息]\n今天是小火和星星在一起的第 ${lumbreTogetherDays(now)} 天。`]
  if (pokes.length) {
    const times = pokes.map(poke => formatMadrid(poke.timestamp, false).slice(-5)).join('、')
    parts.push(`[今日戳鼻子]\n小火今天一共戳了豹子鼻子 ${pokes.length} 次。\n时间：${times}。`)
  }
  return parts.join('\n')
}
