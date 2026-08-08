import fs from 'fs'
import path from 'path'
import { madridDateKey, parseMadridDateTime } from '@/lib/madrid-time'

const USAGE_DIR = '/persistent/usage'

function ensureDir() {
  if (!fs.existsSync(USAGE_DIR)) fs.mkdirSync(USAGE_DIR, { recursive: true })
}

interface UsageRecord {
  timestamp: string
  inputTokens: number
  outputTokens: number
  model: string
  provider: string
}

function getFilePath(date: string) {
  return path.join(USAGE_DIR, `${date}.json`)
}

export function recordUsage(inputTokens: number, outputTokens: number, model: string, provider: string) {
  ensureDir()
  const now = new Date()
  const date = madridDateKey(now)
  const filePath = getFilePath(date)

  let records: UsageRecord[] = []
  try {
    if (fs.existsSync(filePath)) {
      records = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch {}

  records.push({
    timestamp: now.toISOString(),
    inputTokens,
    outputTokens,
    model,
    provider,
  })

  fs.writeFileSync(filePath, JSON.stringify(records, null, 2))
}

export function getUsageStats() {
  ensureDir()
  const now = new Date()
  const today = madridDateKey(now)

  // Get last 14 days
  const days: { date: string; calls: number; inputTokens: number; outputTokens: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const todayNoon = parseMadridDateTime(`${today}T12:00:00`) || now
    const d = new Date(todayNoon.getTime() - i * 86400000)
    const dateStr = madridDateKey(d)
    const filePath = getFilePath(dateStr)

    let records: UsageRecord[] = []
    try {
      if (fs.existsSync(filePath)) {
        records = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      }
    } catch {}

    const input = records.reduce((sum, r) => sum + r.inputTokens, 0)
    const output = records.reduce((sum, r) => sum + r.outputTokens, 0)

    days.push({
      date: dateStr,
      calls: records.length,
      inputTokens: input,
      outputTokens: output,
    })
  }

  const todayStats = days.find(d => d.date === today) || { calls: 0, inputTokens: 0, outputTokens: 0 }
  
  // Last 7 days
  const weekDays = days.slice(-7)
  const weekStats = weekDays.reduce(
    (acc, d) => ({
      calls: acc.calls + d.calls,
      inputTokens: acc.inputTokens + d.inputTokens,
      outputTokens: acc.outputTokens + d.outputTokens,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0 }
  )

  return {
    today: { ...todayStats, cost: (todayStats.inputTokens * 3 + todayStats.outputTokens * 15) / 1000000 },
    week: { ...weekStats, cost: (weekStats.inputTokens * 3 + weekStats.outputTokens * 15) / 1000000 },
    dailyBreakdown: days.map(d => ({
      date: d.date,
      calls: d.calls,
      tokens: d.inputTokens + d.outputTokens,
    })),
  }
}
