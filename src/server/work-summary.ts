import { addMadridDays, formatMadrid, madridDateKey, parseMadridDateTime } from '@/lib/madrid-time'
import { isCcModel } from '@/lib/cc-model'
import { normalizeChatWindowRole } from '@/lib/chat-window-role'
import type { ChatMessage } from '@/features/chat/state/types'
import type { WorkSummaryEntry } from '@/lib/work-summary'
import { createCcArchiveSummary } from './chat/cc-gateway'
import { loadSyncManifest, loadSyncSessions, loadSyncSessionTails } from './chat-sync'
import { readWorkSummaryData, updateWorkSummaryData } from './data/repositories/work-summary'

const DAY_START_HOUR = 5
const TURNS_PER_PART = 100

const PROMPT = `这是一个只在临时分支中执行的内部工作归档任务。下面是同一个 Lumbre 工作窗在一个日界线内的记录。

请写一份给下次继续工作的你的工作摘要，必须准确保留：用户目标与边界、已经确定的方案及理由、涉及和修改的文件、分支与 git 状态、运行过的命令与关键结果、测试和验证、部署状态、失败尝试、未解决风险、以及下一步应从哪里继续。区分“已完成”“只讨论”“待验证”，不要把计划写成事实。保留必要的路径、标识和错误原文；删除寒暄、重复解释和无效探索。只输出摘要正文，不要标题、JSON或额外说明。`

function localHour(now: number) {
  return Number(formatMadrid(now).slice(11, 13))
}

function dayBounds(day: string): [number, number] {
  const start = parseMadridDateTime(`${day}T${String(DAY_START_HOUR).padStart(2, '0')}:00:00`)
  const end = parseMadridDateTime(`${addMadridDays(day, 1)}T${String(DAY_START_HOUR).padStart(2, '0')}:00:00`)
  if (!start || !end) throw new Error('工作摘要日界线无效')
  return [start.getTime(), end.getTime()]
}

function activeWorkSessionIds() {
  return loadSyncManifest().sessions
    .filter(session => normalizeChatWindowRole(session?.windowRole) === 'work')
    .map(session => session.id)
}

function rounds(session: any, day: string) {
  const [start, end] = dayBounds(day)
  const messages = [...(session.messages || [])]
    .filter(message => ['user', 'assistant'].includes(message?.role) && Number(message.timestamp) >= start && Number(message.timestamp) < end)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp)) as ChatMessage[]
  const result: ChatMessage[][] = []
  let current: ChatMessage[] = []
  const flush = () => {
    if (current.some(item => item.role === 'user') && current.some(item => item.role === 'assistant')) result.push(current)
  }
  for (const message of messages) {
    if (message.role === 'user' && current.some(item => item.role === 'assistant')) { flush(); current = [] }
    current.push(message)
  }
  flush()
  return result
}

function transcript(chunk: ChatMessage[][]) {
  return chunk.flatMap(round => round.map(message => {
    const tools = (message.tool_calls || []).map(call => `[工具 ${call.name}] ${JSON.stringify(call.input || {}).slice(0, 500)} → ${String(call.result || '').slice(0, 1500)}`).join('\n')
    return `[${formatMadrid(Number(message.timestamp))}] ${message.role === 'user' ? '小火' : '星星'}：${String(message.content || '').slice(0, 8000)}${tools ? `\n${tools}` : ''}`
  })).join('\n\n')
}

function key(sessionId: string, day: string) {
  return `${sessionId}:${day}`
}

export function workSummaryNeedsRun(now = Date.now()) {
  if (localHour(now) < DAY_START_HOUR) return false
  const day = addMadridDays(madridDateKey(now), -1)
  const data = readWorkSummaryData()
  return activeWorkSessionIds().some(sessionId => !data.completedDays[key(sessionId, day)])
}

export async function runWorkSummaryMaintenance(now = Date.now()) {
  if (localHour(now) < DAY_START_HOUR) return { status: 'not_due' as const }
  const day = addMadridDays(madridDateKey(now), -1)
  const data = readWorkSummaryData()
  const sessionId = activeWorkSessionIds().find(id => !data.completedDays[key(id, day)])
  const session = sessionId ? loadSyncSessions([sessionId])[0] : null
  if (!session) return { status: 'idle' as const }
  const workRounds = rounds(session, day)
  if (!workRounds.length) {
    updateWorkSummaryData(current => ({ ...current, completedDays: { ...current.completedDays, [key(session.id, day)]: 'empty' }, status: { running: false, lastAttemptAt: now, lastSuccessAt: Date.now() } }))
    return { status: 'empty' as const }
  }
  const chunks = Array.from({ length: Math.ceil(workRounds.length / TURNS_PER_PART) }, (_, index) => workRounds.slice(index * TURNS_PER_PART, (index + 1) * TURNS_PER_PART))
  const completed = new Set(data.entries.filter(item => item.sessionId === session.id && item.day === day).map(item => item.partIndex))
  const index = chunks.findIndex((_, part) => !completed.has(part + 1))
  if (index < 0) return { status: 'idle' as const }
  updateWorkSummaryData(current => ({ ...current, status: { ...current.status, running: true, lastAttemptAt: now, error: undefined } }))
  try {
    const model = isCcModel(session.ccModel) ? session.ccModel : undefined
    const result: any = await createCcArchiveSummary(session.id, `${PROMPT}\n\n<work_source>\n${transcript(chunks[index])}\n</work_source>`, model)
    if (result?.status !== 'completed' || !String(result.text || '').trim() || result.transcriptRemoved !== true) {
      throw new Error(result?.error?.message || result?.error || 'CC 没有安全完成工作摘要')
    }
    const sourceIds = chunks[index].flatMap(round => round.map(message => message.id))
    const entry: WorkSummaryEntry = {
      id: `work:${session.id}:${day}:${index + 1}`, kind: 'daily', sessionId: session.id, day,
      startAt: Number(chunks[index][0][0].timestamp), endAt: Number(chunks[index].at(-1)!.at(-1)!.timestamp),
      createdAt: Date.now(), content: String(result.text).trim(), partIndex: index + 1,
      partCount: chunks.length, turnCount: chunks[index].length, sourceIds,
    }
    updateWorkSummaryData(current => ({
      ...current,
      entries: [...current.entries.filter(item => item.id !== entry.id), entry],
      completedDays: index === chunks.length - 1 ? { ...current.completedDays, [key(session.id, day)]: 'complete' } : current.completedDays,
      status: { running: false, lastAttemptAt: now, lastSuccessAt: Date.now(), error: undefined },
    }))
    return { status: 'completed' as const, entry }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    updateWorkSummaryData(current => ({ ...current, status: { running: false, lastAttemptAt: now, error: error.slice(0, 500) } }))
    return { status: 'failed' as const, error }
  }
}

export function workSummarySnapshot(sessionId: string) {
  const data = readWorkSummaryData()
  return { ...data, status: { ...data.status, running: false }, entries: data.entries.filter(item => item.sessionId === sessionId).sort((a, b) => b.endAt - a.endAt) }
}

export async function checkpointWorkSummary(sessionId: string) {
  const session = loadSyncSessionTails([sessionId], 120)[0]
  if (!session || normalizeChatWindowRole(session.windowRole) !== 'work') throw new Error('这不是活跃工作窗')
  const messages = (session.messages || []).filter((message: any) => ['user', 'assistant'].includes(message?.role)).slice(-120) as ChatMessage[]
  if (!messages.length) return null
  const model = isCcModel(session.ccModel) ? session.ccModel : undefined
  const result: any = await createCcArchiveSummary(session.id, `${PROMPT}\n\n这次是压缩前检查点；只写当前仍有效的工作状态和下一步。\n\n<work_source>\n${transcript([messages])}\n</work_source>`, model)
  if (result?.status !== 'completed' || !String(result.text || '').trim() || result.transcriptRemoved !== true) {
    throw new Error(result?.error?.message || result?.error || 'CC 没有安全完成工作检查点')
  }
  const now = Date.now()
  const entry: WorkSummaryEntry = {
    id: `checkpoint:${sessionId}:${now}`, kind: 'checkpoint', sessionId, day: madridDateKey(now),
    startAt: Number(messages[0].timestamp) || now, endAt: Number(messages.at(-1)?.timestamp) || now,
    createdAt: now, content: String(result.text).trim(), partIndex: 1, partCount: 1,
    turnCount: messages.filter(message => message.role === 'user').length,
    sourceIds: messages.map(message => message.id),
  }
  updateWorkSummaryData(current => ({ ...current, entries: [...current.entries, entry], status: { running: false, lastAttemptAt: now, lastSuccessAt: now, error: undefined } }))
  return entry
}

export function workSummaryContext(sessionId: string) {
  const entries = workSummarySnapshot(sessionId).entries.slice(0, 2).reverse()
  if (!entries.length) return ''
  return `[本工作窗最近工作摘要]\n${entries.map(item => `${item.day} · 第${item.partIndex}/${item.partCount}张\n${item.content}`).join('\n\n---\n\n')}`
}
