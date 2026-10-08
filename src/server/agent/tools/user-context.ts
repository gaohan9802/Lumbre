import { getDataDir } from '@/server/data/config'
import { readJsonFile, writeJsonFile } from '@/server/data/json-file'
import { resolveDataPath } from '@/server/data/safe-path'

export interface UserContextSnapshot {
  lat?: number
  lon?: number
  accuracy?: number
  temp?: number | null
  weatherCode?: number
  city?: string
  road?: string
  houseNumber?: string
  address?: string
  updatedAt: number
}

const emptyContext = (): UserContextSnapshot => ({ updatedAt: 0 })
const contextPath = () => resolveDataPath(getDataDir(), 'context', 'user-location.json')

function validContext(value: unknown): value is UserContextSnapshot {
  if (!value || typeof value !== 'object') return false
  const ctx = value as UserContextSnapshot
  return Number.isFinite(ctx.updatedAt)
    && (ctx.lat == null || (Number.isFinite(ctx.lat) && ctx.lat >= -90 && ctx.lat <= 90))
    && (ctx.lon == null || (Number.isFinite(ctx.lon) && ctx.lon >= -180 && ctx.lon <= 180))
    && (ctx.accuracy == null || (Number.isFinite(ctx.accuracy) && ctx.accuracy >= 0))
}

export function updateUserContext(ctx: Omit<UserContextSnapshot, 'updatedAt'>): UserContextSnapshot {
  const next = { ...ctx, updatedAt: Date.now() }
  if (!validContext(next)) throw new Error('Invalid user location context')
  writeJsonFile(contextPath(), next)
  return next
}

export function getUserContext(): UserContextSnapshot {
  return readJsonFile(contextPath(), { fallback: emptyContext, validate: validContext })
}

export function preciseLocationContext(now = Date.now()): string {
  const ctx = getUserContext()
  if (!ctx.updatedAt || ctx.lat == null || ctx.lon == null) return '小火 GPS：尚无定位快照。'
  const ageMinutes = Math.max(0, Math.floor((now - ctx.updatedAt) / 60_000))
  return [
    '小火 GPS（精确位置；每轮自动附带，勿向小火机械复述）：',
    `纬度 ${ctx.lat}，经度 ${ctx.lon}${ctx.accuracy != null ? `，精度约 ±${Math.round(ctx.accuracy)} 米` : ''}`,
    `地址：${ctx.address || [ctx.road, ctx.houseNumber, ctx.city].filter(Boolean).join(' ') || '地址解析中'}`,
    `Google Maps：https://www.google.com/maps/search/?api=1&query=${ctx.lat},${ctx.lon}`,
    `定位于 ${new Date(ctx.updatedAt).toISOString()}，距今 ${ageMinutes} 分钟${ageMinutes > 60 ? '（这是最后已知位置）' : ''}`,
  ].join('\n')
}
