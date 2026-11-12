'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, RotateCcw, Search, Wrench } from 'lucide-react'
import { toolbox as toolboxApi } from '@/lib/api'
import type { ToolCatalogItem, ToolCatalogSnapshot } from '@/lib/tool-catalog'
import { setToolDisplayLabelOverrides } from '@/features/chat/tool-display'
import { useTheme } from '@/lib/theme'
import { useChatStore } from '@/lib/chatStore'
import { normalizeChatWindowRole } from '@/lib/chat-window-role'

const DOMAIN_LABELS: Record<string, string> = {
  memory: '记忆', diary: '日记', notes: '纸条与留言', photos: '照片', todo: '待办', thesis: '论文', wishes: '愿望',
  wake: '唤醒', context: '上下文', period: '经期', health: '健康与能量', mail: '邮件', web: '网页', bookmarks: '书签', coupons: '券包',
  poems: '共诗', 'intimacy-wheel': '今天怎么操', stories: '故事', research: '研究', games: '游戏', media: '书影', 'future-letter': '未来信',
  kitchen: '小厨房',
  dictionary: '小火辞典', summaries: '摘要',
  engawa: '豹子的窗台',
}

const RISK_LABELS = { green: '直接读取', yellow: '可写入', red: '需要确认', black: '禁止' } as const

type Draft = { description: string; displayLabel: string }
const WORK_NATIVE_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent']

function labelMap(snapshot: ToolCatalogSnapshot) {
  return Object.fromEntries(snapshot.tools.map(tool => [tool.name, tool.displayLabel]))
}

export function ToolboxView() {
  const night = useTheme(state => state.theme === 'night')
  const activeSession = useChatStore(state => state.settings.sessions.find(session => session.id === state.settings.activeSessionId))
  const [snapshot, setSnapshot] = useState<ToolCatalogSnapshot>({ tools: [] })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const applySnapshot = (next: ToolCatalogSnapshot) => {
    setSnapshot(next)
    setDrafts(Object.fromEntries(next.tools.map(tool => [tool.name, { description: tool.description, displayLabel: tool.displayLabel }])))
    setToolDisplayLabelOverrides(labelMap(next))
    window.dispatchEvent(new CustomEvent('lumbre-tool-labels-updated'))
  }

  useEffect(() => {
    let current = true
    toolboxApi.list()
      .then(next => { if (current) applySnapshot(next) })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : '工具箱读取失败') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  const dirty = useMemo(() => snapshot.tools.filter(tool => {
    const draft = drafts[tool.name]
    return draft && (draft.description !== tool.description || draft.displayLabel !== tool.displayLabel)
  }), [drafts, snapshot.tools])
  const schemaChanges = dirty.filter(tool => drafts[tool.name]?.description !== tool.description).length
  const workMode = normalizeChatWindowRole(activeSession?.windowRole) === 'work'
  const workLifeTools = snapshot.tools.filter(tool => tool.risk === 'green' && !tool.conditionalRisk)

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const groups = new Map<string, ToolCatalogItem[]>()
    for (const tool of snapshot.tools) {
      const draft = drafts[tool.name]
      const haystack = `${tool.name}\n${DOMAIN_LABELS[tool.domain] || tool.domain}\n${draft?.displayLabel || ''}\n${draft?.description || ''}`.toLowerCase()
      if (needle && !haystack.includes(needle)) continue
      groups.set(tool.domain, [...(groups.get(tool.domain) || []), tool])
    }
    return Array.from(groups.entries())
  }, [drafts, query, snapshot.tools])

  const change = (name: string, patch: Partial<Draft>) => setDrafts(current => ({
    ...current,
    [name]: { ...current[name], ...patch },
  }))

  const save = async () => {
    if (!dirty.length) return
    setSaving(true)
    setError('')
    try {
      const next = await toolboxApi.update(dirty.map(tool => ({ name: tool.name, ...drafts[tool.name] })))
      applySnapshot(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工具箱保存失败')
    } finally {
      setSaving(false)
    }
  }

  return <div className="flex h-full flex-col">
    <div className="shrink-0 border-b border-current/10 px-5 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-xl"><Wrench size={18}/>工具箱</h2>
          <p className="mt-1 text-[10px] opacity-45">{snapshot.tools.length || '—'} 项 · 内部名称与权限只读</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!dirty.length || saving} onClick={() => setDrafts(Object.fromEntries(snapshot.tools.map(tool => [tool.name, { description: tool.description, displayLabel: tool.displayLabel }]))) } className="rounded-xl border border-current/15 px-3 py-2 text-[10px] disabled:opacity-30">撤销修改</button>
          <button type="button" disabled={!dirty.length || saving} onClick={() => void save()} className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs disabled:opacity-35 ${night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}保存{dirty.length ? ` ${dirty.length} 项` : ''}
          </button>
        </div>
      </div>
      <label className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 ${night ? 'border-night-border bg-night-card' : 'chat-dialog-field'}`}>
        <Search size={14} className="opacity-40"/>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索内部名、前端名、介绍或领域" className="min-w-0 flex-1 bg-transparent text-xs outline-none"/>
      </label>
      {schemaChanges > 0 && <p className="mt-2 text-[10px] text-amber-600">其中 {schemaChanges} 项修改了星星看到的介绍，保存后工具 schema 会刷新一次缓存；不会更换 session ID。</p>}
      {error && <p role="alert" className="mt-2 text-[10px] text-red-500">{error}</p>}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {workMode && <section className={`mb-4 rounded-2xl border p-4 ${night ? 'border-night-border bg-night-card' : 'chat-dialog-card'}`}>
        <p className="text-sm font-medium">当前是工作窗</p>
        <p className="mt-1 text-[10px] leading-5 opacity-50">生活工具固定为只读（{workLifeTools.length} 项）；原生代码工具只在隔离代码副本内开放。这里展示权限，不提供绕过窗口边界的总开关。</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{WORK_NATIVE_TOOLS.map(name => <code key={name} className="rounded-lg border border-current/10 px-2 py-1 text-[9px] opacity-65">{name}</code>)}</div>
      </section>}
      {loading ? <div className="grid h-40 place-items-center"><Loader2 className="animate-spin opacity-35"/></div> : grouped.length === 0 ? <div className="py-16 text-center text-xs opacity-40">没有找到工具</div> : <div className="space-y-3">
        {grouped.map(([domain, tools]) => <details key={domain} open={query.trim() ? true : undefined} className={`rounded-2xl border ${night ? 'border-night-border bg-night-card' : 'chat-dialog-card'}`}>
          <summary className="cursor-pointer px-4 py-3 text-sm"><span className="font-medium">{DOMAIN_LABELS[domain] || domain}</span><span className="ml-2 text-[10px] opacity-40">{tools.length} 项</span></summary>
          <div className="space-y-3 border-t border-current/10 p-3">
            {tools.map(tool => {
              const draft = drafts[tool.name] || { description: tool.description, displayLabel: tool.displayLabel }
              const changed = draft.description !== tool.description || draft.displayLabel !== tool.displayLabel
              return <article key={tool.name} className={`rounded-xl border p-3 ${changed ? 'border-amber-400/60' : 'border-current/10'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="select-all text-[11px] opacity-65">{tool.name}</code>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] ${tool.risk === 'red' || tool.conditionalRisk ? 'bg-red-500/10 text-red-500' : tool.risk === 'yellow' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{tool.conditionalRisk ? '写入／删除需确认' : RISK_LABELS[tool.risk]}</span>
                </div>
                <label className="mt-3 block text-[10px] opacity-55">前端显示名
                  <input value={draft.displayLabel} maxLength={80} onChange={event => change(tool.name, { displayLabel: event.target.value })} className={`mt-1 w-full rounded-lg border px-3 py-2 text-xs outline-none ${night ? 'border-night-border bg-night-surface' : 'chat-dialog-field'}`}/>
                </label>
                <label className="mt-3 block text-[10px] opacity-55">星星看到的工具介绍
                  <textarea value={draft.description} maxLength={2000} rows={3} onChange={event => change(tool.name, { description: event.target.value })} className={`mt-1 w-full resize-y rounded-lg border px-3 py-2 text-xs leading-5 outline-none ${night ? 'border-night-border bg-night-surface' : 'chat-dialog-field'}`}/>
                </label>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[9px] opacity-35">{draft.description.length}/2000</span>
                  <button type="button" disabled={draft.description === tool.defaultDescription && draft.displayLabel === tool.defaultDisplayLabel} onClick={() => change(tool.name, { description: tool.defaultDescription, displayLabel: tool.defaultDisplayLabel })} className="flex items-center gap-1 text-[9px] opacity-45 disabled:opacity-20"><RotateCcw size={10}/>恢复默认</button>
                </div>
              </article>
            })}
          </div>
        </details>)}
      </div>}
    </div>
  </div>
}
