import { madridDateKey, parseMadridDateTime } from '@/lib/madrid-time'
import { appendUsageRecord, readUsageRecords } from './data/repositories/usage'

export function recordUsage(inputTokens: number, outputTokens: number, model: string, provider: string) {
  const now = new Date()
  const date = madridDateKey(now)
  appendUsageRecord(date, {
    timestamp: now.toISOString(),
    inputTokens,
    outputTokens,
    model,
    provider,
  })
}

export function getUsageStats() {
  const now = new Date()
  const today = madridDateKey(now)

  // Get last 14 days
  const days: { date: string; calls: number; inputTokens: number; outputTokens: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const todayNoon = parseMadridDateTime(`${today}T12:00:00`) || now
    const d = new Date(todayNoon.getTime() - i * 86400000)
    const dateStr = madridDateKey(d)
    const records = readUsageRecords(dateStr)

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
