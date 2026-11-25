'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity, Archive, Bold, Check, ChevronLeft, Code2, Edit3, Image as ImageIcon, List,
  MessageCircle, MessageCircleQuestion, MoreHorizontal, NotebookPen, PenTool, Pin, Plus, Quote,
  Search, Share2, Sigma, X,
} from 'lucide-react'
import { study as api } from '@/lib/api'
import { compressImage } from '@/lib/image'
import { shareToChat } from '@/lib/share'
import { useTheme } from '@/lib/theme'
import { StudyMarkdown } from './StudyMarkdown'
import { InkCanvas } from './InkCanvas'

type Field = { id: string; name: string; archived: boolean }
type NoteSummary = { id: string; field_id: string; title: string; tags: string[]; pinned: boolean; updated_at: string; question_count: number; open_question_count: number }
type Reply = { id: string; author: 'fire' | 'star'; content: string; created_at: string }
type MarkdownBlock = { id: string; type: 'markdown'; content: string }
type QuestionBlock = { id: string; type: 'question'; question: string; quote?: string; status: 'open' | 'answered' | 'resolved'; replies: Reply[]; created_at: string; updated_at: string }
type AssetBlock = { id: string; type: 'image' | 'ink'; asset_id: string; caption: string }
type Block = MarkdownBlock | QuestionBlock | AssetBlock
type Comment = { id: string; author: 'fire' | 'star'; content: string; block_id?: string; quote?: string; created_at: string }
type Note = { id: string; field_id: string; title: string; tags: string[]; pinned: boolean; archived: boolean; blocks: Block[]; comments: Comment[]; created_at: string; updated_at: string }
type QuestionItem = { note_id: string; note_title: string; field_id: string; field_name: string; section?: string; question: QuestionBlock }
type ActivityItem = { id: string; at: string; kind: string; field_name: string; note_id: string; note_title: string; section?: string }

const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
const shortDate = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const timeOnly = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
const questionLabel = { open: '等待回答', answered: '已回答', resolved: '已解决' } as const

function sectionBefore(blocks: Block[], target: string) {
  let heading = ''
  for (const block of blocks) {
    if (block.type === 'markdown') heading = Array.from(block.content.matchAll(/^#{1,6}\s+(.+)$/gm)).at(-1)?.[1]?.trim() || heading
    if (block.id === target) return heading
  }
  return heading
}

export function StudyView() {
  const night = useTheme(state => state.theme === 'night')
  const [fields, setFields] = useState<Field[]>([])
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirtyState] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [newField, setNewField] = useState('')
  const [newNote, setNewNote] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [questions, setQuestions] = useState<QuestionItem[]>([])
  const [questionFilter, setQuestionFilter] = useState('')
  const [activityOpen, setActivityOpen] = useState(false)
  const [activity, setActivity] = useState<{ today: ActivityItem[]; yesterday: ActivityItem[]; older: ActivityItem[] }>({ today: [], yesterday: [], older: [] })
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [questionComposer, setQuestionComposer] = useState<{ afterId?: string; quote?: string } | null>(null)
  const [questionDraft, setQuestionDraft] = useState('')
  const [inkOpen, setInkOpen] = useState(false)
  const [noteMenuOpen, setNoteMenuOpen] = useState(false)
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const textareas = useRef(new Map<string, HTMLTextAreaElement>())
  const noteRef = useRef<Note | null>(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)
  const revisionRef = useRef(0)

  const setDirty = (value: boolean) => { dirtyRef.current = value; setDirtyState(value) }
  useEffect(() => { noteRef.current = note }, [note])

  const loadOverview = useCallback(async () => {
    const data = await api.overview()
    setFields(data.fields || []); setNotes(data.notes || [])
    setFieldId(current => current && data.fields?.some((field: Field) => field.id === current) ? current : data.fields?.[0]?.id || null)
  }, [])
  useEffect(() => { void loadOverview().catch(cause => setError(cause?.message || '小书桌加载失败')) }, [loadOverview])

  const loadNote = useCallback(async (id: string, questionId?: string) => {
    if (dirtyRef.current && !window.confirm('还有未保存的修改，要放弃并打开其他笔记吗？')) return
    const data = await api.note(id)
    setNote(data.note); noteRef.current = data.note; setFieldId(data.note.field_id); setDirty(false); setSaveState('saved'); setEditing(false); setError('')
    if (questionId) requestAnimationFrame(() => setTimeout(() => document.querySelector(`[data-question-id="${CSS.escape(questionId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80))
  }, [])
  const leaveNote = () => {
    if (dirtyRef.current && !window.confirm('还有未保存的修改，要放弃并返回笔记列表吗？')) return
    setNote(null); noteRef.current = null; setEditing(false); setError('')
  }

  const refreshNote = useCallback(async () => {
    const current = noteRef.current
    if (!current || dirtyRef.current || editing) return
    try { const data = await api.note(current.id); setNote(data.note); noteRef.current = data.note } catch {}
  }, [editing])
  useEffect(() => { const timer = window.setInterval(() => void refreshNote(), 15_000); return () => window.clearInterval(timer) }, [refreshNote])

  const updateNote = (fn: (current: Note) => Note) => {
    setNote(current => { if (!current) return current; const next = fn(current); noteRef.current = next; return next })
    revisionRef.current += 1
    setDirty(true); setSaveState('saving')
  }

  const save = useCallback(async () => {
    const current = noteRef.current
    if (!current || !dirtyRef.current) return
    if (savingRef.current) { queuedRef.current = true; return }
    const revision = revisionRef.current
    savingRef.current = true; setSaveState('saving')
    try {
      const data = await api.act('save_note', { id: current.id, expected_updated_at: current.updated_at, patch: { title: current.title, tags: current.tags, pinned: current.pinned, archived: current.archived, blocks: current.blocks } })
      if (noteRef.current?.id === current.id) {
        if (revisionRef.current === revision) {
          setNote(data.note); noteRef.current = data.note; setDirty(false); setSaveState('saved')
        } else {
          const newer = { ...noteRef.current, updated_at: data.note.updated_at }
          setNote(newer); noteRef.current = newer; queuedRef.current = true
        }
      }
      await loadOverview()
    } catch (cause: any) { setSaveState('error'); setError(cause?.message || '笔记保存失败') }
    finally { savingRef.current = false; if (queuedRef.current) { queuedRef.current = false; void save() } }
  }, [loadOverview])
  useEffect(() => { if (!dirty) return; const timer = window.setTimeout(() => void save(), 800); return () => window.clearTimeout(timer) }, [dirty, note, save])

  const createField = async (name = newField) => {
    if (!name.trim()) return
    const data = await api.act('create_field', { name: name.trim() }); setNewField(''); await loadOverview(); setFieldId(data.field.id)
  }
  const createNote = async (title = newNote) => {
    if (!fieldId || !title.trim()) return
    const data = await api.act('create_note', { field_id: fieldId, title: title.trim() }); setNewNote(''); await loadOverview(); await loadNote(data.note.id); setEditing(true)
  }
  const filteredNotes = notes.filter(item => !fieldId || item.field_id === fieldId)

  const replaceBlock = (id: string, patch: Partial<Block>) => updateNote(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...patch } as Block : block) }))
  const insertAfter = (afterId: string | undefined, block: Block) => updateNote(current => {
    const index = afterId ? current.blocks.findIndex(item => item.id === afterId) : current.blocks.length - 1
    const blocks = [...current.blocks]; blocks.splice(Math.max(0, index + 1), 0, block); return { ...current, blocks }
  })
  const removeBlock = (id: string) => updateNote(current => ({ ...current, blocks: current.blocks.filter(block => block.id !== id) }))

  const applySyntax = (before: string, after = '', fallback = '文字') => {
    const id = activeBlockId || note?.blocks.find(block => block.type === 'markdown')?.id
    if (!id || !note) return
    const block = note.blocks.find(item => item.id === id)
    if (!block || block.type !== 'markdown') return
    const element = textareas.current.get(id), start = element?.selectionStart ?? block.content.length, end = element?.selectionEnd ?? start
    const selected = block.content.slice(start, end) || fallback
    replaceBlock(id, { content: `${block.content.slice(0, start)}${before}${selected}${after}${block.content.slice(end)}` })
    requestAnimationFrame(() => element?.focus())
  }

  const openQuestion = (afterId?: string, quote?: string) => { setQuestionComposer({ afterId, quote }); setQuestionDraft('') }
  const addQuestion = () => {
    if (!note || !questionDraft.trim()) return
    const target = questionComposer?.afterId || activeBlockId || note.blocks.at(-1)?.id
    const element = target ? textareas.current.get(target) : undefined
    const source = target ? note.blocks.find(block => block.id === target) : undefined
    const selected = element && source?.type === 'markdown' ? source.content.slice(element.selectionStart, element.selectionEnd) : ''
    const quote = questionComposer?.quote || selected
    const block: QuestionBlock = { id: uid(), type: 'question', question: questionDraft.trim(), ...(quote ? { quote } : {}), status: 'open', replies: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    if (source?.type === 'markdown' && element) {
      const split = element.selectionEnd
      updateNote(current => {
        const index = current.blocks.findIndex(item => item.id === source.id), blocks = [...current.blocks]
        const before = { ...source, content: source.content.slice(0, split) }, after = source.content.slice(split)
        blocks.splice(index, 1, before, block, ...(after ? [{ id: uid(), type: 'markdown' as const, content: after }] : [])); return { ...current, blocks }
      })
    } else insertAfter(target, block)
    setQuestionComposer(null); setQuestionDraft('')
  }

  const uploadData = async (kind: 'image' | 'ink', dataUrl: string, strokes?: unknown[]) => {
    try {
      const data = await api.upload(kind, dataUrl, '', strokes)
      insertAfter(activeBlockId || note?.blocks.at(-1)?.id, { id: uid(), type: kind, asset_id: data.asset.id, caption: '' }); setInkOpen(false); setError('')
    } catch (cause: any) { setError(cause?.message || '图片上传失败') }
  }
  const uploadImage = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return
    const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
    await uploadData('image', await compressImage(raw, 1800, .88))
    if (imageInput.current) imageInput.current.value = ''
  }

  const shareNote = () => {
    if (!note) return
    const headings = note.blocks.flatMap(block => block.type === 'markdown' ? Array.from(block.content.matchAll(/^#{1,6}\s+(.+)$/gm)).map(match => match[1].trim()) : []).slice(0, 8)
    shareToChat({ kind: 'study-note', title: `学习笔记 · ${note.title}`, subtitle: `${fields.find(field => field.id === note.field_id)?.name || '小书桌'}${note.tags.length ? ` · ${note.tags.map(tag => `#${tag}`).join(' ')}` : ''}`, body: headings.length ? `包含：${headings.join('、')}` : '一篇正在生长的学习笔记。', metadata: { note_id: note.id } })
  }
  const shareQuestion = (block: QuestionBlock) => {
    if (!note) return
    shareToChat({ kind: 'study-question', title: '学习提问', subtitle: `${fields.find(field => field.id === note.field_id)?.name || '小书桌'} / ${note.title}${sectionBefore(note.blocks, block.id) ? ` / ${sectionBefore(note.blocks, block.id)}` : ''}`, body: block.question, metadata: { note_id: note.id, question_id: block.id } })
  }

  const openQuestions = async () => { const data = await api.questions(questionFilter); setQuestions(data.questions || []); setQuestionsOpen(true) }
  useEffect(() => { if (questionsOpen) void api.questions(questionFilter).then(data => setQuestions(data.questions || [])) }, [questionFilter, questionsOpen])
  const openActivity = async () => { setActivity(await api.activity()); setActivityOpen(true) }
  const search = async () => { if (!searchQuery.trim()) return setSearchResults([]); const data = await api.search(searchQuery); setSearchResults(data.results || []) }
  const addComment = async () => {
    if (!note || !commentDraft.trim()) return
    if (dirtyRef.current) { await save(); if (dirtyRef.current) return }
    await api.act('comment', { note_id: note.id, content: commentDraft.trim() }); setCommentDraft(''); const data = await api.note(note.id); setNote(data.note); noteRef.current = data.note
  }
  const setQuestionStatus = async (block: QuestionBlock, status: 'open' | 'resolved') => {
    if (!note) return
    if (dirtyRef.current) { await save(); if (dirtyRef.current) return }
    const data = await api.act('question_status', { note_id: note.id, question_id: block.id, status }); setNote(data.note); noteRef.current = data.note; await loadOverview()
  }

  const panel = night ? 'border border-night-border bg-night-surface' : 'chat-dialog-card'
  const fieldName = fields.find(field => field.id === note?.field_id)?.name || '小书桌'

  return <div className={`h-full min-h-0 overflow-hidden ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-current/10 px-3 py-2.5 sm:px-5">
        {note && <button aria-label="返回笔记列表" onClick={leaveNote} className="rounded-full p-2 md:hidden"><ChevronLeft size={18}/></button>}
        <NotebookPen size={17} className="opacity-55"/><h1 className="font-serif text-lg font-semibold">小书桌</h1>
        <div className="flex-1"/>
        <button aria-label="搜索笔记" onClick={() => setSearchOpen(true)} className="rounded-full p-2 opacity-65 hover:bg-current/5"><Search size={16}/></button>
        <button aria-label="提问箱" onClick={() => void openQuestions()} className="relative rounded-full p-2 opacity-65 hover:bg-current/5"><MessageCircleQuestion size={17}/>{notes.reduce((sum, item) => sum + item.open_question_count, 0) > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-[#b86d78] px-1 text-center text-[8px] leading-4 text-white">{Math.min(99, notes.reduce((sum, item) => sum + item.open_question_count, 0))}</span>}</button>
        <button aria-label="学习动态" onClick={() => void openActivity()} className="rounded-full p-2 opacity-65 hover:bg-current/5"><Activity size={17}/></button>
        <button aria-label="新建笔记" disabled={!fieldId} onClick={() => void createNote('新的笔记')} className="rounded-full p-2 opacity-65 hover:bg-current/5 disabled:opacity-20"><Plus size={18}/></button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[190px] shrink-0 flex-col border-r border-current/10 p-3 md:flex">
          <p className="px-2 py-2 text-[10px] tracking-[.2em] opacity-40">学习分区</p>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">{fields.map(field => <button key={field.id} onClick={() => { if (dirtyRef.current && !window.confirm('还有未保存的修改，要放弃并切换分区吗？')) return; setFieldId(field.id); setNote(null); noteRef.current = null; setEditing(false) }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${fieldId === field.id ? 'bg-current/10' : 'hover:bg-current/5'}`}><span className="truncate">{field.name}</span><span className="text-[9px] opacity-35">{notes.filter(note => note.field_id === field.id).length}</span></button>)}</div>
          <div className="mt-2 flex gap-1"><input value={newField} onChange={event => setNewField(event.target.value)} onKeyDown={event => event.key === 'Enter' && void createField()} placeholder="新建分区" className="min-w-0 flex-1 rounded-xl bg-current/5 px-3 py-2 text-xs outline-none"/><button aria-label="添加分区" onClick={() => void createField()} className="rounded-xl p-2 hover:bg-current/5"><Plus size={14}/></button></div>
        </aside>

        <aside className={`${note ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-current/10 p-3 md:w-[260px]`}>
          {!fields.length ? <div className="m-auto w-full max-w-xs p-4 text-center"><p className="font-serif text-xl">从今天开始学一点什么</p><p className="mt-2 text-xs opacity-50">先建一个学习分区。</p><div className="mt-5 grid grid-cols-3 gap-2">{[['∑', '数学'], ['</>', '编程'], ['あ', '日语']].map(([mark, name]) => <button key={name} onClick={() => void createField(name)} className={`rounded-2xl p-4 ${panel}`}><span className="block text-lg">{mark}</span><span className="mt-2 block text-xs">{name}</span></button>)}</div><div className="mt-3 flex gap-2"><input value={newField} onChange={event => setNewField(event.target.value)} placeholder="其他分区" className="min-w-0 flex-1 rounded-xl bg-current/5 px-3 py-2 text-xs outline-none"/><button onClick={() => void createField()} className="rounded-xl border border-current/10 px-3 text-xs">创建</button></div></div> : <>
            <div className="mb-3 flex items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fields.find(field => field.id === fieldId)?.name || '全部笔记'}</p><p className="text-[9px] opacity-40">{filteredNotes.length} 篇</p></div></div>
            <div className="mb-3 flex gap-1"><input value={newNote} onChange={event => setNewNote(event.target.value)} onKeyDown={event => event.key === 'Enter' && void createNote()} placeholder="新笔记标题" className="min-w-0 flex-1 rounded-xl bg-current/5 px-3 py-2 text-xs outline-none"/><button aria-label="创建笔记" onClick={() => void createNote()} className="rounded-xl p-2 hover:bg-current/5"><Plus size={14}/></button></div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">{filteredNotes.map(item => <button key={item.id} onClick={() => void loadNote(item.id)} className={`w-full rounded-2xl p-3 text-left ${note?.id === item.id ? 'bg-current/10' : panel}`}><div className="flex items-start gap-2"><p className="min-w-0 flex-1 truncate font-serif text-sm">{item.title}</p>{item.pinned && <Pin size={11} className="shrink-0 opacity-45"/>}</div><p className="mt-1 text-[9px] opacity-40">{shortDate(item.updated_at)}{item.open_question_count ? ` · ${item.open_question_count} 个待处理问题` : ''}</p></button>)}{!filteredNotes.length && <p className="py-12 text-center text-xs opacity-35">这个分区还没有笔记</p>}</div>
            <div className="mt-3 border-t border-current/10 pt-3 md:hidden"><p className="mb-2 text-[10px] opacity-40">切换分区</p><div className="flex flex-wrap gap-1">{fields.map(field => <button key={field.id} onClick={() => setFieldId(field.id)} className={`rounded-full px-3 py-1.5 text-xs ${field.id === fieldId ? 'bg-current/10' : 'border border-current/10'}`}>{field.name}</button>)}</div></div>
          </>}
        </aside>

        <main className={`${note ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col overflow-hidden`}>
          {note ? <>
            <div className="flex shrink-0 items-center gap-2 border-b border-current/10 px-4 py-2">
              <p className="min-w-0 flex-1 truncate text-[10px] opacity-45">{fieldName} / {note.title}</p>
              <span className={`text-[9px] ${saveState === 'error' ? 'text-red-500' : 'opacity-40'}`}>{saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : '已保存'}</span>
              <button aria-label="评论" onClick={() => setCommentsOpen(true)} className="rounded-full p-2 opacity-55"><MessageCircle size={15}/></button>
              <button aria-label="分享笔记到 Chat" onClick={shareNote} className="rounded-full p-2 opacity-55"><Share2 size={15}/></button>
              <button onClick={() => { if (editing) void save(); setEditing(value => !value) }} className="rounded-full px-3 py-1.5 text-xs hover:bg-current/5">{editing ? <><Check size={13} className="mr-1 inline"/>完成</> : <><Edit3 size={13} className="mr-1 inline"/>编辑</>}</button>
              <div className="relative"><button aria-label="笔记菜单" onClick={() => setNoteMenuOpen(value => !value)} className="rounded-full p-2 opacity-55"><MoreHorizontal size={16}/></button>{noteMenuOpen && <div className={`absolute right-0 top-10 z-20 w-36 rounded-2xl p-1 shadow-xl ${panel}`}><button onClick={() => { updateNote(current => ({ ...current, pinned: !current.pinned })); setNoteMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs hover:bg-current/5"><Pin size={13}/>{note.pinned ? '取消置顶' : '置顶'}</button><button onClick={() => { if (window.confirm('将这篇笔记移入归档吗？')) updateNote(current => ({ ...current, archived: true })); setNoteMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs hover:bg-current/5"><Archive size={13}/>归档</button></div>}</div>
            </div>
            {editing && <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-current/10 px-3 py-2">
              <button title="标题" onClick={() => applySyntax('\n## ', '\n', '小节标题')} className="rounded-lg px-2 py-1 text-xs hover:bg-current/5">H2</button>
              <button title="粗体" onClick={() => applySyntax('**', '**')} className="rounded-lg p-1.5 hover:bg-current/5"><Bold size={14}/></button>
              <button title="列表" onClick={() => applySyntax('\n- ', '', '列表项')} className="rounded-lg p-1.5 hover:bg-current/5"><List size={14}/></button>
              <button title="引用" onClick={() => applySyntax('\n> ', '', '引用')} className="rounded-lg p-1.5 hover:bg-current/5"><Quote size={14}/></button>
              <button title="公式" onClick={() => applySyntax('$', '$', 'f(x)=x^2')} className="rounded-lg p-1.5 hover:bg-current/5"><Sigma size={14}/></button>
              <button title="代码块" onClick={() => { const language = window.prompt('代码语言', 'python') || ''; applySyntax(`\n\`\`\`${language}\n`, '\n\`\`\`\n', '# code') }} className="rounded-lg p-1.5 hover:bg-current/5"><Code2 size={14}/></button>
              <button title="插入图片" onClick={() => imageInput.current?.click()} className="rounded-lg p-1.5 hover:bg-current/5"><ImageIcon size={14}/></button>
              <button title="插入提问" onClick={() => openQuestion(activeBlockId || undefined)} className="rounded-lg p-1.5 hover:bg-current/5"><MessageCircleQuestion size={14}/></button>
              <div className="relative"><button title="更多" onClick={() => setInsertMenuOpen(value => !value)} className="rounded-lg p-1.5 hover:bg-current/5"><Plus size={14}/></button>{insertMenuOpen && <div className={`absolute left-0 top-9 z-30 w-40 rounded-2xl p-1 shadow-xl ${panel}`}><button onClick={() => { setInkOpen(true); setInsertMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs hover:bg-current/5"><PenTool size={13}/>手写卡片</button><button onClick={() => { applySyntax('{', '|かな}', '漢字'); setInsertMenuOpen(false) }} className="w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-current/5">振假名</button><button onClick={() => { applySyntax('\n> [!定义]\n> ', '\n', '定义内容'); setInsertMenuOpen(false) }} className="w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-current/5">定义卡片</button></div>}</div>
              <input ref={imageInput} type="file" accept="image/*" hidden onChange={event => void uploadImage(event.target.files?.[0])}/>
            </div>}
            <article className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-7"><div className="mx-auto max-w-[820px]">
              {editing ? <input value={note.title} onChange={event => updateNote(current => ({ ...current, title: event.target.value }))} className="w-full bg-transparent font-serif text-3xl font-semibold outline-none"/> : <h2 className="font-serif text-3xl font-semibold">{note.title}</h2>}
              <div className="mt-3 flex flex-wrap gap-1">{editing ? <input value={note.tags.join(' ')} onChange={event => updateNote(current => ({ ...current, tags: event.target.value.split(/\s+/).filter(Boolean) }))} placeholder="标签用空格分开" className="w-full bg-transparent text-xs opacity-55 outline-none"/> : note.tags.map(tag => <span key={tag} className="rounded-full bg-current/5 px-2 py-1 text-[10px] opacity-55">#{tag}</span>)}</div>
              <div className="mt-7 space-y-5">{note.blocks.map(block => block.type === 'markdown' ? <section key={block.id} data-block-id={block.id}>{editing ? <textarea ref={element => { if (element) textareas.current.set(block.id, element); else textareas.current.delete(block.id) }} value={block.content} onFocus={() => setActiveBlockId(block.id)} onChange={event => replaceBlock(block.id, { content: event.target.value })} placeholder="从这里开始写…" className="min-h-40 w-full resize-y rounded-2xl border border-current/10 bg-transparent p-4 font-serif text-sm leading-7 outline-none focus:border-current/25"/> : <StudyMarkdown content={block.content}/>}</section> : block.type === 'question' ? <section key={block.id} data-question-id={block.id} className={`rounded-2xl border-l-2 p-4 ${block.status === 'resolved' ? 'border-current/15 bg-current/[.025]' : night ? 'border-night-amberDim bg-night-amber/5' : 'border-[#b78680] bg-[#fbf1ef]'}`}><div className="flex items-center gap-2 text-[9px] tracking-[.12em] opacity-50"><span>提问</span><span>·</span><span>{questionLabel[block.status]}</span><span className="flex-1"/>{editing && <button aria-label="删除提问块" onClick={() => removeBlock(block.id)}><X size={12}/></button>}</div>{block.quote && <blockquote className="mt-3 border-l border-current/20 pl-3 text-xs leading-5 opacity-55">{block.quote}</blockquote>}<p className="mt-3 font-serif text-base leading-7">{block.question}</p>{block.replies.map(reply => <div key={reply.id} className="mt-4 border-t border-current/10 pt-4"><p className="mb-2 text-[10px] opacity-45">{reply.author === 'star' ? '星星' : '小火'} · {shortDate(reply.created_at)}</p><StudyMarkdown content={reply.content}/></div>)}<div className="mt-4 flex flex-wrap gap-3 text-[10px] opacity-55"><button onClick={() => shareQuestion(block)} className="flex items-center gap-1"><Share2 size={11}/>{block.replies.length ? '分享' : '问星星'}</button>{block.replies.length > 0 && <button onClick={() => openQuestion(block.id, block.replies.at(-1)?.content.slice(0, 500))}>继续追问</button>}<button onClick={() => void setQuestionStatus(block, block.status === 'resolved' ? 'open' : 'resolved')}>{block.status === 'resolved' ? '重新打开' : '标记解决'}</button></div></section> : <figure key={block.id} className="group relative"><img src={`/api/study/assets/${encodeURIComponent(block.asset_id)}`} alt={block.caption || (block.type === 'ink' ? '手写卡片' : '学习笔记图片')} className="mx-auto max-h-[70dvh] max-w-full rounded-2xl object-contain"/>{editing ? <div className="mt-2 flex gap-2"><input value={block.caption} onChange={event => replaceBlock(block.id, { caption: event.target.value })} placeholder="图片说明（也会被搜索）" className="min-w-0 flex-1 bg-transparent text-center text-xs opacity-60 outline-none"/><button aria-label="移除图片块" onClick={() => removeBlock(block.id)} className="opacity-40"><X size={13}/></button></div> : block.caption && <figcaption className="mt-2 text-center text-xs opacity-50">{block.caption}</figcaption>}</figure>)}</div>
              {error && <p role="alert" className="mt-6 rounded-xl bg-red-500/10 p-3 text-xs text-red-500">{error}</p>}
            </div></article>
          </> : <div className="m-auto max-w-md p-8 text-center"><NotebookPen size={28} className="mx-auto opacity-25"/><p className="mt-4 font-serif text-xl">选一篇笔记，或新建一篇</p><p className="mt-2 text-xs opacity-40">数学公式、代码、日语振假名和提问都可以写在这里。</p></div>}
        </main>
      </div>
    </div>

    {searchOpen && <div className="fixed inset-0 z-[125] bg-black/45 p-4 backdrop-blur-sm"><div className={`mx-auto mt-[8dvh] max-h-[80dvh] max-w-2xl overflow-hidden rounded-[26px] ${panel}`}><div className="flex items-center gap-2 border-b border-current/10 p-4"><Search size={16}/><input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void search()} placeholder="搜索标题、正文、代码、公式、提问…" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/><button onClick={() => void search()} className="rounded-full px-3 py-1 text-xs">搜索</button><button aria-label="关闭搜索" onClick={() => setSearchOpen(false)}><X size={17}/></button></div><div className="max-h-[65dvh] space-y-2 overflow-y-auto p-4">{searchResults.map(item => <button key={item.id} onClick={() => { setSearchOpen(false); void loadNote(item.id) }} className="w-full rounded-2xl border border-current/10 p-4 text-left"><p className="font-serif text-base">{item.title}</p><p className="mt-1 text-[10px] opacity-45">{item.field_name} · {shortDate(item.updated_at)}</p><p className="mt-2 line-clamp-3 text-xs leading-5 opacity-65">{item.excerpt}</p></button>)}{searchQuery && !searchResults.length && <p className="py-12 text-center text-xs opacity-35">按回车开始搜索</p>}</div></div></div>}

    {questionsOpen && <Drawer title="提问箱" onClose={() => setQuestionsOpen(false)} night={night}><div className="mb-4 flex gap-1 overflow-x-auto">{[['', '全部'], ['open', '等待回答'], ['answered', '已回答'], ['resolved', '已解决']].map(([value, label]) => <button key={value} onClick={() => setQuestionFilter(value)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${questionFilter === value ? 'bg-current/10' : 'border border-current/10 opacity-55'}`}>{label}</button>)}</div><div className="space-y-2">{questions.map(item => <button key={item.question.id} onClick={() => { setQuestionsOpen(false); void loadNote(item.note_id, item.question.id) }} className="w-full rounded-2xl border border-current/10 p-4 text-left"><p className="text-[9px] opacity-45">{item.field_name} / {item.note_title}{item.section ? ` / ${item.section}` : ''}</p><p className="mt-2 font-serif text-sm leading-6">{item.question.question}</p><p className="mt-2 text-[9px] opacity-40">{questionLabel[item.question.status]} · {shortDate(item.question.updated_at)}</p></button>)}{!questions.length && <p className="py-12 text-center text-xs opacity-35">这里还没有问题</p>}</div></Drawer>}

    {activityOpen && <Drawer title="学习动态" onClose={() => setActivityOpen(false)} night={night}><ActivityGroup title="今天" items={activity.today} exact onOpen={id => { setActivityOpen(false); void loadNote(id) }}/><ActivityGroup title="昨天" items={activity.yesterday} onOpen={id => { setActivityOpen(false); void loadNote(id) }}/><ActivityGroup title="本周较早" items={activity.older} onOpen={id => { setActivityOpen(false); void loadNote(id) }}/></Drawer>}

    {commentsOpen && note && <Drawer title={`评论 · ${note.title}`} onClose={() => setCommentsOpen(false)} night={night}><div className="space-y-3">{note.comments.map(comment => <div key={comment.id} className="rounded-2xl border border-current/10 p-4"><p className="text-[9px] opacity-40">{comment.author === 'star' ? '星星' : '小火'} · {shortDate(comment.created_at)}</p>{comment.quote && <blockquote className="mt-2 border-l border-current/15 pl-2 text-xs opacity-45">{comment.quote}</blockquote>}<div className="mt-2 text-sm"><StudyMarkdown content={comment.content}/></div></div>)}{!note.comments.length && <p className="py-8 text-center text-xs opacity-35">还没有评论</p>}</div><div className="sticky bottom-0 mt-4 flex gap-2 bg-inherit py-2"><textarea value={commentDraft} onChange={event => setCommentDraft(event.target.value)} placeholder="留一条评论…" className="min-h-12 min-w-0 flex-1 rounded-2xl border border-current/10 bg-transparent p-3 text-xs outline-none"/><button disabled={!commentDraft.trim()} onClick={() => void addComment()} className="rounded-2xl border border-current/10 px-4 text-xs disabled:opacity-25">发送</button></div></Drawer>}

    {questionComposer && <div className="fixed inset-0 z-[135] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"><div className={`w-full max-w-lg rounded-[26px] p-5 ${panel}`}><div className="flex items-center"><h3 className="flex-1 font-serif text-lg">插入提问</h3><button aria-label="取消提问" onClick={() => setQuestionComposer(null)}><X size={17}/></button></div>{questionComposer.quote && <blockquote className="mt-4 line-clamp-4 border-l border-current/20 pl-3 text-xs opacity-55">{questionComposer.quote}</blockquote>}<textarea autoFocus value={questionDraft} onChange={event => setQuestionDraft(event.target.value)} placeholder="你想问星星什么？" className="mt-4 min-h-28 w-full rounded-2xl border border-current/10 bg-transparent p-4 text-sm outline-none"/><div className="mt-4 flex justify-end gap-2"><button onClick={() => setQuestionComposer(null)} className="rounded-full px-4 py-2 text-xs opacity-50">取消</button><button disabled={!questionDraft.trim()} onClick={addQuestion} className="rounded-full bg-[#d8b0aa] px-4 py-2 text-xs text-[#3f2c29] disabled:opacity-30">放进笔记</button></div></div></div>}
    {inkOpen && <InkCanvas onClose={() => setInkOpen(false)} onSave={(dataUrl, strokes) => uploadData('ink', dataUrl, strokes)}/>}
  </div>
}

function Drawer({ title, onClose, night, children }: { title: string; onClose: () => void; night: boolean; children: ReactNode }) {
  return <div className="fixed inset-0 z-[125] bg-black/35"><button aria-label="关闭" onClick={onClose} className="absolute inset-0"/><aside className={`absolute bottom-0 right-0 top-0 flex w-full max-w-md flex-col shadow-2xl ${night ? 'border-l border-night-border bg-night-surface text-night-text' : 'bg-[#fffaf6] text-[#3f2c29]'}`}><header className="flex items-center gap-3 border-b border-current/10 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]"><h2 className="flex-1 font-serif text-xl">{title}</h2><button aria-label="关闭" onClick={onClose}><X size={18}/></button></header><div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div></aside></div>
}

function ActivityGroup({ title, items, exact = false, onOpen }: { title: string; items: ActivityItem[]; exact?: boolean; onOpen: (id: string) => void }) {
  if (!items.length) return null
  const shown = exact ? items : Array.from(new Map(items.map(item => [`${item.note_id}:${item.section || ''}:${item.kind}`, item])).values())
  return <section className="mb-6"><h3 className="mb-2 text-[10px] font-semibold tracking-[.18em] opacity-45">{title}</h3><div className="space-y-1">{shown.map(item => <button key={item.id} onClick={() => onOpen(item.note_id)} className="flex w-full gap-3 rounded-xl px-2 py-2 text-left hover:bg-current/5">{exact && <span className="w-10 shrink-0 text-[10px] tabular-nums opacity-40">{timeOnly(item.at)}</span>}<span className="min-w-0 text-xs leading-5"><b className="font-medium">{item.note_title}</b>{item.section ? ` · ${item.section}` : ''}<span className="ml-2 opacity-40">{item.kind === 'question' ? '提出问题' : item.kind === 'answer' ? '收到回答' : item.kind === 'create' ? '新建' : item.kind === 'image' ? '插入图片' : item.kind === 'ink' ? '添加手写' : '编辑'}</span></span></button>)}</div></section>
}
