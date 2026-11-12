'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronRight, FileText, Flag, Loader2, Lock, Pencil, RotateCcw, Trash2, Unlock, X } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { summaries as summariesApi } from '@/lib/api'
import type { SummaryArchiveEntry, SummaryArchiveLevel, SummaryArchiveSnapshot } from '@/lib/summary-archive'
import { ChatSession, useChatStore } from '@/lib/chatStore'
import { formatMadrid } from '@/lib/madrid-time'
import { PaperActionDialog } from '@/components/PaperActionDialog'
import { normalizeChatWindowRole } from '@/lib/chat-window-role'
import type { WorkSummarySnapshot } from '@/lib/work-summary'

const EMPTY_ARCHIVE: SummaryArchiveSnapshot = {
  entries: [], completedDays: {}, completedStages: {}, completedMonths: {}, status: { running: false },
}
const EMPTY_WORK: WorkSummarySnapshot = { entries: [], completedDays: {}, status: { running: false } }

const LEVELS: Array<{ value: 'all' | SummaryArchiveLevel; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'daily', label: '每日' }, { value: 'weekly', label: '阶段' }, { value: 'monthly', label: '月摘要' },
]

function periodLabel(entry: SummaryArchiveEntry) {
  if (entry.level === 'monthly') {
    const [year, month] = entry.periodKey.split('-')
    return `${year}年${Number(month)}月`
  }
  if (entry.level === 'weekly') {
    const [start, end] = entry.periodKey.split('..')
    return `${start.replaceAll('-', '.')} — ${end.replaceAll('-', '.')}`
  }
  const [year, month, day] = entry.periodKey.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function levelName(level: SummaryArchiveLevel) {
  return level === 'daily' ? '每日摘要' : level === 'weekly' ? '阶段摘要' : '月摘要'
}

export function SummaryDialog({ open, onClose, session }: { open: boolean; onClose: () => void; session?: ChatSession }) {
  const { theme } = useTheme(); const night = theme === 'night'
  const { settings, updateSessionSummaryConfig } = useChatStore()
  const [archive, setArchive] = useState<SummaryArchiveSnapshot>(EMPTY_ARCHIVE)
  const [workArchive, setWorkArchive] = useState<WorkSummarySnapshot>(EMPTY_WORK)
  const [level, setLevel] = useState<'all' | SummaryArchiveLevel>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ title: '', content: '' })
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SummaryArchiveEntry | null>(null)
  const config = session?.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount, modeVersion: 2 as const }
  const workMode = normalizeChatWindowRole(session?.windowRole) === 'work'
  const card = night ? 'bg-night-surface border-night-border' : 'chat-dialog-card'

  const refresh = useCallback(async () => {
    try {
      const [home, work] = await Promise.all([
        summariesApi.list(),
        workMode && session?.id
          ? fetch(`/api/work-summaries?session_id=${encodeURIComponent(session.id)}`, { cache: 'no-store' }).then(async response => {
              if (!response.ok) throw new Error('工作摘要读取失败')
              return response.json()
            })
          : Promise.resolve(EMPTY_WORK),
      ])
      setArchive(home); setWorkArchive(work); setError('')
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '摘要档案读取失败') }
  }, [session?.id, workMode])

  useEffect(() => { if (open) void refresh() }, [open, refresh])

  const entries = useMemo(() => archive.entries.filter(entry => level === 'all' || entry.level === level), [archive.entries, level])
  const grouped = useMemo(() => {
    const groups = new Map<string, SummaryArchiveEntry[]>()
    for (const entry of entries) groups.set(entry.periodKey, [...(groups.get(entry.periodKey) || []), entry])
    return Array.from(groups.entries()).map(([key, items]) => [key, items.sort((a, b) => (a.partIndex || 0) - (b.partIndex || 0))] as const)
  }, [entries])
  const oldSummaries = [...(session?.summaries || [])].sort((a, b) => b.endAt - a.endAt)
  const oldStages = [...(session?.stageSummaries || [])].sort((a, b) => b.endAt - a.endAt)

  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const action = async (id: string, operation: () => Promise<unknown>) => {
    setBusyId(id); setError('')
    try { await operation(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '摘要操作失败') }
    finally { setBusyId('') }
  }

  const saveEdit = (entry: SummaryArchiveEntry) => {
    const content = draft.content.trim(); const title = draft.title.trim()
    if (!content) return setError('摘要正文不能为空')
    void action(entry.id, () => summariesApi.update(entry.id, { content, ...(entry.level === 'daily' ? {} : { title }), needsCorrection: false }))
    setEditing(null)
  }

  return <AnimatePresence>{open && <>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[72] bg-black/40 backdrop-blur-sm" />
    <motion.div initial={{ opacity: 0, scale: .96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 12 }} className={`fixed z-[73] inset-x-0 mx-auto w-[min(680px,calc(100vw-2rem))] max-h-[84dvh] overflow-y-auto rounded-2xl ${night ? 'bg-night-card text-night-text shadow-2xl' : 'chat-dialog'}`} style={{ top: 'max(calc(env(safe-area-inset-top,0px) + 7dvh),7dvh)' }}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-current/10 bg-inherit px-5 py-4"><h3 className="flex items-center gap-2 text-lg font-medium"><FileText size={18} />{workMode ? '工作与家中摘要' : '摘要档案'}</h3><button onClick={onClose} aria-label="关闭摘要档案" className="p-2 opacity-60"><X size={20} /></button></div>
      <div className="space-y-5 p-5">
        {workMode && <section className={`space-y-3 rounded-2xl border p-4 ${card}`}>
          <div><p className="text-sm font-medium">本窗工作摘要</p><p className="mt-1 text-[10px] opacity-50">独立于家中摘要；每天 05:00 结算，每 100 个完整轮次一张。</p></div>
          {workArchive.entries.length ? <div className="space-y-3">{workArchive.entries.map(entry => <details key={entry.id} className="rounded-xl border border-current/10 p-3"><summary className="cursor-pointer text-xs font-medium">{entry.kind === 'checkpoint' ? `${entry.day} · 压缩检查点` : `${entry.day} · 第 ${entry.partIndex}/${entry.partCount} 张`} · {entry.turnCount}轮</summary><p className="mt-3 whitespace-pre-wrap text-xs leading-6 opacity-80">{entry.content}</p></details>)}</div> : <p className="rounded-xl border border-current/10 px-3 py-4 text-center text-xs opacity-45">完成第一个家日后会生成。</p>}
          {workArchive.status.error && <p className="text-[10px] text-red-500">{workArchive.status.error}</p>}
        </section>}

        <section className={`space-y-4 rounded-2xl border p-4 ${card}`}>
          {workMode && <p className="text-sm font-medium">家中共享摘要</p>}
          {!workMode && <>
          <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">这个窗口加入每日摘要</p><p className="mt-1 text-[10px] opacity-50">每天 05:00 结算；每 100 个完整轮次一张</p></div><button aria-label="切换这个窗口的每日摘要" aria-pressed={config.autoEnabled} onClick={() => session && updateSessionSummaryConfig(session.id, { autoEnabled: !config.autoEnabled })} className={`relative h-8 w-14 shrink-0 rounded-full p-1 shadow-inner ${config.autoEnabled ? (night ? 'bg-night-amber' : 'bg-[#DBB9B3]') : (night ? 'border border-night-border bg-night-bg' : 'border border-gray-300 bg-gray-200')}`}><motion.span animate={{ x: config.autoEnabled ? 24 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} className="block h-6 w-6 rounded-full bg-white shadow-md" /></button></div>
          </>}
          <div className={`rounded-xl px-3 py-2 text-[11px] leading-5 ${night ? 'bg-night-bg/60' : 'chat-dialog-accent'}`}>
            {workMode ? '工作窗自动带入最近 1 张每日摘要和 1 张阶段摘要，也可以用只读工具搜索全部家中摘要。' : '自动带入最近 3 张每日摘要和 1 张阶段摘要；月摘要只留在抽屉与搜索工具里。'}
            {archive.status.lastSuccessAt ? <span className="block opacity-55">最近完成：{formatMadrid(archive.status.lastSuccessAt, false)}</span> : null}
          </div>
          {error || archive.status.error ? <div role="alert" className={`rounded-xl px-3 py-2 text-[11px] leading-5 ${night ? 'bg-red-950/30 text-red-200' : 'bg-red-50 text-red-600'}`}>{error || archive.status.error}</div> : null}
          <button disabled={!!busyId || archive.status.running} onClick={() => void action('run', () => summariesApi.run())} className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs disabled:opacity-40 ${night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>{busyId === 'run' || archive.status.running ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}补写下一张待完成摘要</button>
        </section>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-current/10 p-1">{LEVELS.map(item => <button key={item.value} onClick={() => setLevel(item.value)} className={`min-w-16 flex-1 rounded-lg px-3 py-2 text-[11px] ${level === item.value ? (night ? 'bg-night-surface text-night-amber' : 'chat-dialog-accent') : 'opacity-50'}`}>{item.label}</button>)}</div>

        {!grouped.length ? <div className="py-10 text-center text-xs opacity-45">每日档案会在下一个 05:00 日界线后开始生成。</div> : grouped.map(([period, items]) => <section key={period} className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs"><b>{periodLabel(items[0])}</b><span className="opacity-40">{items.length > 1 ? `${items.length}张` : levelName(items[0].level)}</span></div>
          {items.map(entry => {
            const isOpen = expanded.has(entry.id); const isEditing = editing === entry.id; const busy = busyId === entry.id
            return <div key={entry.id} className={`rounded-2xl border ${card} ${entry.needsCorrection ? 'ring-1 ring-red-400/60' : ''}`}>
              <div className="flex gap-2 p-3"><button aria-label={isOpen ? '收起摘要' : '展开摘要'} onClick={() => toggle(entry.id)} className="p-1 opacity-60">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button onClick={() => toggle(entry.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-medium">{entry.title || `${levelName(entry.level)}${entry.partCount && entry.partCount > 1 ? ` · ${entry.partIndex}/${entry.partCount}` : ''}`}</p><p className="mt-1 text-[10px] opacity-45">{formatMadrid(entry.startAt, false)} — {formatMadrid(entry.endAt, false)}{entry.turnCount ? ` · ${entry.turnCount}轮` : ''}</p><p className="mt-1 text-[9px] opacity-55">{entry.locked ? '已锁定 ' : ''}{entry.needsCorrection ? '来源已变化 ' : ''}{entry.editedAt ? '已编辑' : ''}</p></button><button title={entry.locked ? '解锁' : '锁定'} disabled={busy} onClick={() => void action(entry.id, () => summariesApi.update(entry.id, { locked: !entry.locked }))} className="p-1 opacity-45 disabled:opacity-20">{entry.locked ? <Lock size={13} /> : <Unlock size={13} />}</button><button title="标记纠错" disabled={entry.locked || busy} onClick={() => void action(entry.id, () => summariesApi.update(entry.id, { needsCorrection: !entry.needsCorrection }))} className={`p-1 disabled:opacity-20 ${entry.needsCorrection ? 'text-red-500' : 'opacity-35'}`}><Flag size={13} /></button></div>
              {isOpen ? <div className="border-t border-current/10 px-4 pb-4 pt-3 sm:pl-11">{isEditing && !entry.locked ? <>{entry.level !== 'daily' && <input value={draft.title} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} placeholder="标题" className={`w-full rounded-xl p-3 text-sm outline-none ${night ? 'bg-night-card' : 'chat-dialog-field'}`} />}<textarea value={draft.content} onChange={event => setDraft(value => ({ ...value, content: event.target.value }))} rows={12} className={`mt-2 w-full rounded-xl p-3 text-xs leading-6 outline-none ${night ? 'bg-night-card' : 'chat-dialog-field'}`} /><div className="mt-2 flex justify-end gap-3"><button onClick={() => setEditing(null)} className="text-xs opacity-50">取消</button><button onClick={() => saveEdit(entry)} className={`flex items-center gap-1 text-xs ${night ? 'text-night-amber' : 'text-[#9c6e69]'}`}><Check size={12} />保存</button></div></> : <><p className="whitespace-pre-wrap text-sm leading-7">{entry.content}</p><div className="mt-3 flex flex-wrap gap-2"><button disabled={entry.locked || busy} onClick={() => { setEditing(entry.id); setDraft({ title: entry.title || '', content: entry.content }) }} className="flex items-center gap-1 rounded-lg border border-current/15 px-3 py-1.5 text-[10px] disabled:opacity-35"><Pencil size={11} />编辑纠错</button><button disabled={entry.locked || busy} onClick={() => void action(entry.id, () => summariesApi.regenerate(entry.id))} className="flex items-center gap-1 rounded-lg border border-current/15 px-3 py-1.5 text-[10px] disabled:opacity-35">{busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}重新生成</button><button disabled={entry.locked || busy} onClick={() => setDeleteTarget(entry)} className="ml-auto flex items-center gap-1 px-3 py-1.5 text-[10px] text-red-500 disabled:opacity-30"><Trash2 size={11} />删除</button></div></>}</div> : null}
            </div>
          })}
        </section>)}

        {(oldSummaries.length > 0 || oldStages.length > 0) && <details className={`rounded-2xl border p-4 ${card}`}><summary className="cursor-pointer text-xs font-medium">旧滚动摘要 · 只读保留（{oldSummaries.length + oldStages.length}张）</summary><div className="mt-4 space-y-3">{[...oldStages.map(item => ({ id: item.id, title: item.title, text: item.content, startAt: item.startAt, endAt: item.endAt, locked: item.locked })), ...oldSummaries.map(item => ({ id: item.id, title: '普通摘要', text: item.eventSummary, startAt: item.startAt, endAt: item.endAt, locked: item.locked }))].sort((a, b) => b.endAt - a.endAt).map(item => <div key={item.id} className="rounded-xl border border-current/10 p-3"><p className="text-xs font-medium">{item.title}</p><p className="mt-1 text-[9px] opacity-45">{formatMadrid(item.startAt, false)} — {formatMadrid(item.endAt, false)}{item.locked ? ' · 已锁定' : ''}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-6 opacity-75">{item.text}</p></div>)}</div></details>}
      </div>
    </motion.div>
    <PaperActionDialog open={!!deleteTarget} title="确认删除这张摘要？" confirmLabel="删除" danger onClose={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) void action(deleteTarget.id, () => summariesApi.remove(deleteTarget.id)); setDeleteTarget(null) }}><p className="text-xs leading-5 opacity-60">删除后无法撤销；引用它的上层摘要会标记为来源已变化。</p></PaperActionDialog>
  </>}</AnimatePresence>
}
