'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity, Archive, ArrowDown, ArrowUp, Bold, Check, ChevronLeft, Code2, Edit3, FileText, Folder, Image as ImageIcon, List,
  FolderInput, MessageCircle, MessageCircleQuestion, MoreHorizontal, NotebookPen, PenTool, Pin, Plus, Quote,
  Search, Share2, Sigma, StickyNote, Trash2, X,
} from 'lucide-react'
import { study as api } from '@/lib/api'
import { compressImage } from '@/lib/image'
import { shareToChat } from '@/lib/share'
import { useTheme } from '@/lib/theme'
import { StudyMarkdown } from './StudyMarkdown'
import { InkCanvas } from './InkCanvas'

type Field = { id: string; name: string; mark?: string; archived: boolean }
type Section = { id: string; field_id: string; name: string; archived: boolean }
type NoteSummary = { id: string; field_id: string; section_id?: string; title: string; tags: string[]; pinned: boolean; updated_at: string; question_count: number; open_question_count: number }
type Reply = { id: string; author: 'fire' | 'star'; content: string; created_at: string }
type MarkdownBlock = { id: string; type: 'markdown'; content: string }
type QuestionBlock = { id: string; type: 'question'; question: string; quote?: string; status: 'open' | 'answered' | 'resolved'; replies: Reply[]; created_at: string; updated_at: string }
type AssetBlock = { id: string; type: 'image' | 'ink'; asset_id: string; caption: string }
type Block = MarkdownBlock | QuestionBlock | AssetBlock
type Comment = { id: string; author: 'fire' | 'star'; content: string; block_id?: string; quote?: string; created_at: string }
type Note = { id: string; field_id: string; section_id?: string; title: string; tags: string[]; pinned: boolean; archived: boolean; blocks: Block[]; comments: Comment[]; created_at: string; updated_at: string }
type QuestionItem = { note_id: string; note_title: string; field_id: string; field_name: string; page_name: string; section?: string; question: QuestionBlock }
type ActivityItem = { id: string; at: string; kind: string; field_name: string; note_id: string; note_title: string; section?: string }

const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
const shortDate = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const timeOnly = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
const questionLabel = { open: '等待回答', answered: '已回答', resolved: '已解决' } as const
const FIELD_MARKS = ['∑', '</>', 'あ', '✦', '○', '△', '◇', '∞', '⌁', '✎', '☾', '♫']
const fitTextarea = (element: HTMLTextAreaElement) => { element.style.height = '0'; element.style.height = `${Math.max(192, element.scrollHeight)}px` }

function sectionBefore(blocks: Block[], target: string) {
  let heading = ''
  for (const block of blocks) {
    if (block.type === 'markdown') heading = Array.from(block.content.matchAll(/^#{1,6}\s+(.+)$/gm)).at(-1)?.[1]?.trim() || heading
    if (block.id === target) return heading
  }
  return heading
}

function fieldMark(field: Field) {
  if (field.mark) return field.mark
  if (/数学/.test(field.name)) return '∑'
  if (/编程|代码|Python|HTML/i.test(field.name)) return '</>'
  if (/日语|日本语/.test(field.name)) return 'あ'
  return '✦'
}

export function StudyView({ onClose }: { onClose?: () => void }) {
  const night = useTheme(state => state.theme === 'night')
  const [fields, setFields] = useState<Field[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirtyState] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [newField, setNewField] = useState('')
  const [newSection, setNewSection] = useState('')
  const [newNote, setNewNote] = useState('')
  const [rootCreateKind, setRootCreateKind] = useState<'section' | 'note'>('section')
  const [fieldSettings, setFieldSettings] = useState<Field | null>(null)
  const [fieldNameDraft, setFieldNameDraft] = useState('')
  const [fieldMarkDraft, setFieldMarkDraft] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickNote, setQuickNote] = useState<{ content: string; updated_at: string } | null>(null)
  const [quickDraft, setQuickDraft] = useState('')
  const [quickSaveState, setQuickSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchRan, setSearchRan] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [questions, setQuestions] = useState<QuestionItem[]>([])
  const [questionFilter, setQuestionFilter] = useState('')
  const [activityOpen, setActivityOpen] = useState(false)
  const [activity, setActivity] = useState<{ today: ActivityItem[]; yesterday: ActivityItem[]; older: ActivityItem[] }>({ today: [], yesterday: [], older: [] })
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [questionComposer, setQuestionComposer] = useState<{ afterId?: string; quote?: string; threadId?: string } | null>(null)
  const [questionDraft, setQuestionDraft] = useState('')
  const [inkOpen, setInkOpen] = useState(false)
  const [noteMenuOpen, setNoteMenuOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveFieldId, setMoveFieldId] = useState('')
  const [moveSectionId, setMoveSectionId] = useState('')
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const [mobileFieldsOpen, setMobileFieldsOpen] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const textareas = useRef(new Map<string, HTMLTextAreaElement>())
  const noteRef = useRef<Note | null>(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)
  const revisionRef = useRef(0)
  const quickSavingRef = useRef(false)

  const setDirty = (value: boolean) => { dirtyRef.current = value; setDirtyState(value) }
  useEffect(() => { noteRef.current = note }, [note])

  const loadOverview = useCallback(async () => {
    const data = await api.overview()
    setFields(data.fields || []); setSections(data.sections || []); setNotes(data.notes || [])
    setFieldId(current => current && data.fields?.some((field: Field) => field.id === current) ? current : data.fields?.[0]?.id || null)
  }, [])
  useEffect(() => { void loadOverview().catch(cause => setError(cause?.message || '小书桌加载失败')) }, [loadOverview])

  const loadNote = useCallback(async (id: string, questionId?: string) => {
    if (dirtyRef.current && !window.confirm('还有未保存的修改，要放弃并打开其他笔记吗？')) return
    const data = await api.note(id)
    setNote(data.note); noteRef.current = data.note; setFieldId(data.note.field_id); setSectionId(data.note.section_id || null); setDirty(false); setSaveState('saved'); setEditing(false); setError('')
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
    const data = await api.act('create_field', { name: name.trim() }); setNewField(''); await loadOverview(); setFieldId(data.field.id); setSectionId(null); setNote(null)
  }
  const createSection = async () => {
    if (!fieldId || !newSection.trim()) return
    const data = await api.act('create_section', { field_id: fieldId, name: newSection.trim() })
    setNewSection(''); await loadOverview(); setSectionId(data.section.id)
  }
  const createNote = async (title = newNote, targetSectionId: string | null = sectionId) => {
    if (!fieldId || !title.trim()) return
    const data = await api.act('create_note', { field_id: fieldId, ...(targetSectionId ? { section_id: targetSectionId } : {}), title: title.trim() }); setNewNote(''); await loadOverview(); await loadNote(data.note.id); setEditing(true)
  }
  const selectField = (id: string) => {
    if (dirtyRef.current && !window.confirm('还有未保存的修改，要放弃并切换分区吗？')) return
    setFieldId(id); setSectionId(null); setNote(null); noteRef.current = null; setEditing(false)
  }
  const archiveField = async (id: string) => {
    if (!window.confirm('删除这个分区吗？里面的子页和笔记会一起从小书桌隐藏，数据会保留。')) return
    await api.act('update_field', { id, patch: { archived: true } }); setFieldSettings(null); setSectionId(null); setNote(null); await loadOverview()
  }
  const archiveSection = async (id: string) => {
    if (!window.confirm('删除这个子页吗？里面的笔记会从小书桌隐藏，数据会保留。')) return
    await api.act('update_section', { id, patch: { archived: true } }); setSectionId(null); setNote(null); await loadOverview()
  }
  const renameSection = async (section: Section) => {
    const name = window.prompt('修改子页名称', section.name)?.trim()
    if (!name || name === section.name) return
    try { await api.act('update_section', { id: section.id, patch: { name } }); await loadOverview(); setError('') }
    catch (cause: any) { setError(cause?.message || '子页改名失败') }
  }
  const openFieldSettings = (field: Field) => {
    setFieldSettings(field); setFieldNameDraft(field.name); setFieldMarkDraft(field.mark || fieldMark(field))
  }
  const saveFieldSettings = async () => {
    if (!fieldSettings || !fieldNameDraft.trim()) return
    try {
      await api.act('update_field', { id: fieldSettings.id, patch: { name: fieldNameDraft.trim(), mark: fieldMarkDraft } })
      await loadOverview(); setFieldSettings(null); setError('')
    } catch (cause: any) { setError(cause?.message || '分区设置保存失败') }
  }
  const moveFieldOrder = async (direction: 'up' | 'down') => {
    if (!fieldSettings) return
    try { await api.act('move_field', { id: fieldSettings.id, direction }); await loadOverview(); setError('') }
    catch (cause: any) { setError(cause?.message || '分区移动失败') }
  }
  const openQuickNote = async () => {
    try {
      const data = await api.quickNote(); setQuickNote(data.note); setQuickDraft(data.note.content); setQuickSaveState('saved'); setQuickOpen(true)
    } catch (cause: any) { setError(cause?.message || '随手记加载失败') }
  }
  useEffect(() => {
    if (!quickOpen || !quickNote || quickDraft === quickNote.content) return
    const timer = window.setTimeout(async () => {
      if (quickSavingRef.current) return
      quickSavingRef.current = true; setQuickSaveState('saving')
      try {
        const data = await api.act('save_quick_note', { content: quickDraft, expected_updated_at: quickNote.updated_at })
        setQuickNote(data.note); setQuickSaveState('saved')
      } catch { setQuickSaveState('error') }
      finally { quickSavingRef.current = false }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [quickDraft, quickNote, quickOpen])
  const closeQuickNote = async () => {
    if (!quickNote || quickDraft === quickNote.content) { setQuickOpen(false); return }
    if (quickSavingRef.current) return
    quickSavingRef.current = true; setQuickSaveState('saving')
    try {
      const data = await api.act('save_quick_note', { content: quickDraft, expected_updated_at: quickNote.updated_at })
      setQuickNote(data.note); setQuickSaveState('saved'); setQuickOpen(false)
    } catch {
      setQuickSaveState('error')
      if (window.confirm('随手记还没有保存，仍然关闭吗？')) setQuickOpen(false)
    } finally { quickSavingRef.current = false }
  }
  const openMove = () => {
    if (!note) return
    setMoveFieldId(note.field_id); setMoveSectionId(note.section_id || ''); setMoveOpen(true); setNoteMenuOpen(false)
  }
  const moveNote = async () => {
    const current = noteRef.current
    if (!current || !moveFieldId) return
    if (dirtyRef.current) { await save(); if (dirtyRef.current) return }
    try {
      const data = await api.act('move_note', { id: current.id, expected_updated_at: noteRef.current?.updated_at, field_id: moveFieldId, section_id: moveSectionId || null })
      await loadOverview(); setNote(data.note); noteRef.current = data.note; setFieldId(data.note.field_id); setSectionId(data.note.section_id || null); setMoveOpen(false); setError('')
    } catch (cause: any) { setError(cause?.message || '笔记移动失败') }
  }
  const fieldSections = sections.filter(item => item.field_id === fieldId)
  const unsortedNotes = notes.filter(item => item.field_id === fieldId && !item.section_id)
  const filteredNotes = notes.filter(item => item.field_id === fieldId && item.section_id === sectionId)

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

  const openQuestion = (afterId?: string, quote?: string, threadId?: string) => { setQuestionComposer({ afterId, quote, threadId }); setQuestionDraft('') }
  const addQuestion = async () => {
    if (!note || !questionDraft.trim()) return
    if (questionComposer?.threadId) {
      try {
        if (dirtyRef.current) { await save(); if (dirtyRef.current) return }
        await api.act('question_reply', { note_id: note.id, question_id: questionComposer.threadId, content: questionDraft.trim() })
        const data = await api.note(note.id)
        setNote(data.note); noteRef.current = data.note; setQuestionComposer(null); setQuestionDraft(''); await loadOverview()
      } catch (cause: any) { setError(cause?.message || '追问保存失败') }
      return
    }
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
    const page = note.section_id ? sections.find(section => section.id === note.section_id)?.name : '未分类'
    shareToChat({ kind: 'study-note', title: `学习笔记 · ${note.title}`, subtitle: `${fields.find(field => field.id === note.field_id)?.name || '小书桌'} / ${page || '未分类'}${note.tags.length ? ` · ${note.tags.map(tag => `#${tag}`).join(' ')}` : ''}`, body: headings.length ? `包含：${headings.join('、')}` : '一篇正在生长的学习笔记。', metadata: { note_id: note.id } })
  }
  const shareQuestion = (block: QuestionBlock) => {
    if (!note) return
    shareToChat({ kind: 'study-question', title: '学习提问', subtitle: `${fields.find(field => field.id === note.field_id)?.name || '小书桌'} / ${note.title}${sectionBefore(note.blocks, block.id) ? ` / ${sectionBefore(note.blocks, block.id)}` : ''}`, body: block.question, metadata: { note_id: note.id, question_id: block.id } })
  }

  const openQuestions = async () => { const data = await api.questions(questionFilter); setQuestions(data.questions || []); setQuestionsOpen(true) }
  useEffect(() => { if (questionsOpen) void api.questions(questionFilter).then(data => setQuestions(data.questions || [])) }, [questionFilter, questionsOpen])
  const openActivity = async () => { setActivity(await api.activity()); setActivityOpen(true) }
  const search = async () => {
    if (!searchQuery.trim()) { setSearchResults([]); setSearchRan(false); return }
    const data = await api.search(searchQuery); setSearchResults(data.results || []); setSearchRan(true)
  }
  const setQuestionStatus = async (block: QuestionBlock, status: 'open' | 'resolved') => {
    if (!note) return
    if (dirtyRef.current) { await save(); if (dirtyRef.current) return }
    const data = await api.act('question_status', { note_id: note.id, question_id: block.id, status }); setNote(data.note); noteRef.current = data.note; await loadOverview()
  }

  const panel = night ? 'border border-night-border bg-night-surface' : 'chat-theme-panel chat-theme-border border'
  const fieldName = fields.find(field => field.id === note?.field_id)?.name || '小书桌'
  const sectionName = note?.section_id ? sections.find(section => section.id === note.section_id)?.name : '未分类'
  const outline = note?.blocks.flatMap(block => block.type === 'markdown'
    ? Array.from(block.content.matchAll(/^(#{1,6})\s+(.+)$/gm)).map((match, index) => ({ id: `study-heading-${block.id}-${index}`, level: match[1].length, title: match[2].trim() }))
    : []) || []
  const jumpToBlock = (blockId?: string) => {
    if (!blockId) return
    setCommentsOpen(false)
    requestAnimationFrame(() => document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  const toggleEditing = () => {
    if (editing) void save()
    else setActiveBlockId(note?.blocks.find(block => block.type === 'markdown')?.id || null)
    setEditing(value => !value)
  }

  return <div className="chat-theme chat-page-shell study-shell relative h-full min-h-0 overflow-hidden">
    <div className="flex h-full min-h-0 flex-col">
      <header className="chat-room-header flex shrink-0 items-center gap-2 px-3 py-2.5 sm:px-5">
        {note && <button aria-label="返回笔记列表" onClick={leaveNote} className="chat-theme-icon rounded-full p-2 md:hidden"><ChevronLeft size={18}/></button>}
        <NotebookPen size={17} className={`chat-theme-accent shrink-0 ${note ? 'hidden sm:block' : ''}`}/>
        <div className="min-w-0"><h1 className="chat-session-title text-lg font-bold">小书桌</h1><p className="truncate text-[9px] opacity-40"><span className="sm:hidden">{note ? `${sectionName} · ${note.title}` : '在这里慢慢学习'}</span><span className="hidden sm:inline">{note ? `${fieldName} / ${sectionName} / ${note.title}` : '在这里慢慢学习'}</span></p></div>
        <div className="flex-1"/>
        <button aria-label="打开随手记" onClick={() => void openQuickNote()} className="chat-theme-icon rounded-full p-2 opacity-65"><StickyNote size={16}/></button>
        <button aria-label="搜索笔记" onClick={() => setSearchOpen(true)} className="chat-theme-icon rounded-full p-2 opacity-65"><Search size={16}/></button>
        <button aria-label="提问箱" onClick={() => void openQuestions()} className="chat-theme-icon relative rounded-full p-2 opacity-65"><MessageCircleQuestion size={17}/>{notes.reduce((sum, item) => sum + item.open_question_count, 0) > 0 && <span className="chat-theme-accent-bg absolute right-0 top-0 min-w-4 rounded-full px-1 text-center text-[8px] leading-4">{Math.min(99, notes.reduce((sum, item) => sum + item.open_question_count, 0))}</span>}</button>
        <button aria-label="学习动态" onClick={() => void openActivity()} className="chat-theme-icon rounded-full p-2 opacity-65"><Activity size={17}/></button>
        {onClose && <button aria-label="关闭小书桌" onClick={onClose} className="chat-theme-icon rounded-full p-2 opacity-55"><X size={18}/></button>}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="study-nav chat-theme-sidebar chat-theme-border hidden w-[150px] shrink-0 flex-col border-r p-3 md:flex xl:w-[180px]">
          <p className="chat-session-mono px-2 py-2 text-[9px] tracking-[.18em] opacity-40">学习分区</p>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">{fields.map(field => <div key={field.id} className={`study-field-tab group flex items-center ${fieldId === field.id ? 'is-active' : ''}`}><button onClick={() => selectField(field.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2.5 text-left"><span className="chat-session-mono w-7 shrink-0 text-center text-[11px] opacity-55">{fieldMark(field)}</span><span className="min-w-0 flex-1 truncate text-xs">{field.name}</span><span className="text-[8px] opacity-30">{notes.filter(item => item.field_id === field.id).length}</span></button>{fieldId === field.id && <button aria-label={`分区设置 ${field.name}`} onClick={() => openFieldSettings(field)} className="mr-1 rounded-full p-1 opacity-40 hover:opacity-80"><MoreHorizontal size={12}/></button>}</div>)}</div>
          <div className="mt-2 flex gap-1"><input value={newField} onChange={event => setNewField(event.target.value)} onKeyDown={event => event.key === 'Enter' && void createField()} placeholder="新分区" className="chat-theme-placeholder min-w-0 flex-1 border-b border-current/15 bg-transparent px-1 py-2 text-xs outline-none"/><button aria-label="添加分区" onClick={() => void createField()} className="chat-theme-icon rounded-full p-2"><Plus size={14}/></button></div>
        </aside>

        <aside className={`${note ? 'hidden md:flex' : 'flex'} study-nav chat-theme-sidebar chat-theme-border w-full shrink-0 flex-col border-r p-3 md:w-[220px] xl:w-[260px]`}>
          {!fields.length ? <div className="m-auto w-full max-w-xs p-4 text-center"><p className="font-serif text-xl">从今天开始学一点什么</p><p className="mt-2 text-xs opacity-50">先建一个学习分区。</p><div className="mt-5 grid grid-cols-3 gap-2">{[['∑', '数学'], ['</>', '编程'], ['あ', '日语']].map(([mark, name]) => <button key={name} onClick={() => void createField(name)} className="chat-session-receipt px-3 py-4"><span className="chat-session-mono block text-lg">{mark}</span><span className="mt-2 block text-xs">{name}</span></button>)}</div><div className="mt-4 flex gap-2"><input value={newField} onChange={event => setNewField(event.target.value)} placeholder="其他分区" className="chat-theme-input min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none"/><button onClick={() => void createField()} className="chat-theme-accent-bg rounded-xl px-3 text-xs">创建</button></div></div> : <>
            <div className="mb-2 flex items-center gap-1 px-1">{sectionId && <button aria-label="返回分区" onClick={() => { setSectionId(null); setNote(null) }} className="chat-theme-icon rounded-full p-1"><ChevronLeft size={15}/></button>}<button onClick={() => setMobileFieldsOpen(value => !value)} className="flex min-w-0 flex-1 items-center gap-2 text-left md:pointer-events-none"><span className="min-w-0 flex-1 truncate font-medium">{sectionId ? sections.find(item => item.id === sectionId)?.name : fields.find(field => field.id === fieldId)?.name || '小书桌'}</span><span className="text-[9px] opacity-40">{sectionId ? `${filteredNotes.length} 篇` : `${fieldSections.length} 个子页 · ${unsortedNotes.length} 篇`}</span><MoreHorizontal size={15} className="opacity-45 md:hidden"/></button>{sectionId ? <><button aria-label="修改子页名称" onClick={() => { const section = sections.find(item => item.id === sectionId); if (section) void renameSection(section) }} className="chat-theme-icon rounded-full p-1.5 opacity-45"><Edit3 size={13}/></button><button aria-label="删除子页" onClick={() => void archiveSection(sectionId)} className="chat-theme-icon rounded-full p-1.5 opacity-45"><Trash2 size={13}/></button></> : fieldId ? <button aria-label="分区设置" onClick={() => { const field = fields.find(item => item.id === fieldId); if (field) openFieldSettings(field) }} className="chat-theme-icon rounded-full p-1.5 opacity-45"><MoreHorizontal size={14}/></button> : null}</div>
            {mobileFieldsOpen && <div className="chat-theme-panel chat-theme-border mb-3 grid grid-cols-2 gap-1 rounded-2xl border p-2 md:hidden">{fields.map(field => <button key={field.id} onClick={() => { selectField(field.id); setMobileFieldsOpen(false) }} className={`flex items-center gap-2 rounded-xl px-2 py-2 text-left text-xs ${field.id === fieldId ? 'chat-theme-accent-soft' : ''}`}><span className="chat-session-mono w-6 text-center text-[11px] opacity-55">{fieldMark(field)}</span><span className="truncate">{field.name}</span></button>)}</div>}
            {!sectionId ? <>
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-current/[.035] p-1 text-[10px]"><button onClick={() => setRootCreateKind('section')} className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 ${rootCreateKind === 'section' ? 'chat-theme-surface shadow-sm' : 'opacity-45'}`}><Folder size={12}/>子页</button><button onClick={() => setRootCreateKind('note')} className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 ${rootCreateKind === 'note' ? 'chat-theme-surface shadow-sm' : 'opacity-45'}`}><FileText size={12}/>笔记</button></div>
              <div className="chat-theme-input mb-3 flex rounded-2xl border px-2"><input value={rootCreateKind === 'section' ? newSection : newNote} onChange={event => rootCreateKind === 'section' ? setNewSection(event.target.value) : setNewNote(event.target.value)} onKeyDown={event => event.key === 'Enter' && void (rootCreateKind === 'section' ? createSection() : createNote(newNote, null))} placeholder={rootCreateKind === 'section' ? '新子页名称' : '新笔记标题'} className="chat-theme-placeholder min-w-0 flex-1 bg-transparent px-2 py-2.5 text-xs outline-none"/><button aria-label={rootCreateKind === 'section' ? '创建子页' : '创建一级笔记'} onClick={() => void (rootCreateKind === 'section' ? createSection() : createNote(newNote, null))} className="chat-theme-icon rounded-full p-2"><Plus size={14}/></button></div>
              <div className="min-h-0 flex-1 overflow-y-auto">{fieldSections.map(item => <button key={item.id} onClick={() => setSectionId(item.id)} className="study-note-slip flex w-full items-start gap-2 px-3 py-3 text-left"><Folder size={14} className="mt-0.5 shrink-0 opacity-40"/><span className="min-w-0 flex-1"><span className="block truncate font-serif text-sm">{item.name}</span><span className="chat-session-mono mt-1 block text-[8px] opacity-40">{notes.filter(noteItem => noteItem.section_id === item.id).length} 篇笔记</span></span></button>)}{unsortedNotes.map(item => <button key={item.id} onClick={() => void loadNote(item.id)} className={`study-note-slip flex w-full items-start gap-2 px-3 py-3 text-left ${note?.id === item.id ? 'is-active' : ''}`}><FileText size={14} className="mt-0.5 shrink-0 opacity-40"/><span className="min-w-0 flex-1"><span className="flex items-start gap-2"><span className="min-w-0 flex-1 truncate font-serif text-sm">{item.title}</span>{item.pinned && <Pin size={11} className="chat-theme-accent shrink-0"/>}</span><span className="chat-session-mono mt-1 block text-[8px] opacity-40">{shortDate(item.updated_at)}{item.open_question_count ? ` · ${item.open_question_count} 待答` : ''}</span></span></button>)}{!fieldSections.length && !unsortedNotes.length && <p className="py-12 text-center text-xs opacity-35">新建一个子页，或直接写一篇笔记</p>}</div>
            </> : <><div className="chat-theme-input mb-3 flex rounded-2xl border px-2"><input value={newNote} onChange={event => setNewNote(event.target.value)} onKeyDown={event => event.key === 'Enter' && void createNote()} placeholder="新笔记标题" className="chat-theme-placeholder min-w-0 flex-1 bg-transparent px-2 py-2.5 text-xs outline-none"/><button aria-label="创建笔记" onClick={() => void createNote()} className="chat-theme-icon rounded-full p-2"><Plus size={14}/></button></div><div className="min-h-0 flex-1 overflow-y-auto">{filteredNotes.map(item => <button key={item.id} onClick={() => void loadNote(item.id)} className={`study-note-slip w-full px-3 py-3 text-left ${note?.id === item.id ? 'is-active' : ''}`}><div className="flex items-start gap-2"><p className="min-w-0 flex-1 truncate font-serif text-sm">{item.title}</p>{item.pinned && <Pin size={11} className="chat-theme-accent shrink-0"/>}</div><p className="chat-session-mono mt-1 text-[8px] opacity-40">{shortDate(item.updated_at)}{item.open_question_count ? ` · ${item.open_question_count} 待答` : ''}</p></button>)}{!filteredNotes.length && <p className="py-12 text-center text-xs opacity-35">这个子页还没有笔记</p>}</div></>}
          </>}
        </aside>

        <main className={`${note ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col overflow-hidden`}>
          {note ? <>
            <div className="chat-theme-surface chat-theme-border flex shrink-0 items-center gap-1 border-b px-3 py-2">
              <button disabled={saveState !== 'error'} onClick={() => void save()} className={`mr-auto text-left text-[9px] ${saveState === 'error' ? 'text-red-500 underline underline-offset-2' : 'opacity-40'}`}>{saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败 · 点此重试' : `已保存 · ${shortDate(note.updated_at)}`}</button>
              {!!outline.length && <button aria-label="笔记目录" onClick={() => setOutlineOpen(true)} className="chat-theme-icon rounded-full p-2 opacity-55"><List size={15}/></button>}
              <button aria-label="星星的批注" onClick={() => setCommentsOpen(true)} className="chat-theme-icon relative rounded-full p-2 opacity-55"><MessageCircle size={15}/>{note.comments.length > 0 && <span className="chat-theme-accent-bg absolute right-0 top-0 h-2 w-2 rounded-full"/>}</button>
              <button aria-label="分享笔记到 Chat" onClick={shareNote} className="chat-theme-icon rounded-full p-2 opacity-55"><Share2 size={15}/></button>
              <button onClick={toggleEditing} className="chat-theme-accent-soft chat-theme-accent rounded-full px-3 py-1.5 text-xs">{editing ? <><Check size={13} className="mr-1 inline"/>完成</> : <><Edit3 size={13} className="mr-1 inline"/>编辑</>}</button>
              <div className="relative"><button aria-label="笔记菜单" onClick={() => setNoteMenuOpen(value => !value)} className="chat-theme-icon rounded-full p-2 opacity-55"><MoreHorizontal size={16}/></button>{noteMenuOpen && <div className={`absolute right-0 top-10 z-30 w-36 rounded-2xl p-1 shadow-xl ${panel}`}><button onClick={() => { updateNote(current => ({ ...current, pinned: !current.pinned })); setNoteMenuOpen(false) }} className="chat-theme-hover flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs"><Pin size={13}/>{note.pinned ? '取消置顶' : '置顶'}</button><button onClick={openMove} className="chat-theme-hover flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs"><FolderInput size={13}/>移动到…</button><button onClick={() => { if (window.confirm('将这篇笔记移入归档吗？')) updateNote(current => ({ ...current, archived: true })); setNoteMenuOpen(false) }} className="chat-theme-hover flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs"><Archive size={13}/>归档</button></div>}</div>
            </div>
            {editing && <div className="study-editor-toolbar chat-theme-input flex shrink-0 items-center gap-1 overflow-x-auto border px-3 py-2 md:rounded-none md:border-x-0 md:border-t-0">
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
            <article className={`study-paper-desk min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6 ${editing ? 'pb-24 md:pb-6' : ''}`}><div className="study-paper-sheet mx-auto min-h-full max-w-[820px] px-5 py-7 sm:px-9 sm:py-9">
              {editing ? <input value={note.title} onChange={event => updateNote(current => ({ ...current, title: event.target.value }))} className="w-full bg-transparent font-serif text-3xl font-semibold outline-none"/> : <h2 className="font-serif text-3xl font-semibold">{note.title}</h2>}
              <div className="mt-3 flex flex-wrap gap-1">{editing ? <input value={note.tags.join(' ')} onChange={event => updateNote(current => ({ ...current, tags: event.target.value.split(/\s+/).filter(Boolean) }))} placeholder="标签用空格分开" className="w-full bg-transparent text-xs opacity-55 outline-none"/> : note.tags.map(tag => <span key={tag} className="rounded-full bg-current/5 px-2 py-1 text-[10px] opacity-55">#{tag}</span>)}</div>
              <div className="mt-7 space-y-5">{note.blocks.map(block => block.type === 'markdown' ? <section key={block.id} data-block-id={block.id} className="relative">{editing ? <textarea ref={element => { if (element) { textareas.current.set(block.id, element); fitTextarea(element) } else textareas.current.delete(block.id) }} value={block.content} onFocus={() => setActiveBlockId(block.id)} onChange={event => { fitTextarea(event.currentTarget); replaceBlock(block.id, { content: event.target.value }) }} placeholder="从这里开始写…" className="min-h-48 w-full resize-none overflow-hidden bg-transparent font-serif text-sm leading-7 outline-none"/> : <StudyMarkdown content={block.content} idPrefix={block.id}/>}</section> : block.type === 'question' ? <section key={block.id} data-block-id={block.id} data-question-id={block.id} className={`study-question-card rounded-2xl border-l-2 p-4 ${block.status === 'resolved' ? 'is-resolved' : ''}`}><div className="flex items-center gap-2 text-[9px] tracking-[.12em] opacity-50"><span>提问</span><span>·</span><span>{questionLabel[block.status]}</span><span className="flex-1"/>{editing && <button aria-label="删除提问块" onClick={() => removeBlock(block.id)}><X size={12}/></button>}</div>{block.quote && <blockquote className="mt-3 border-l border-current/20 pl-3 text-xs leading-5 opacity-55">{block.quote}</blockquote>}<p className="mt-3 font-serif text-base leading-7">{block.question}</p>{block.replies.map(reply => <div key={reply.id} className="mt-4 border-t border-current/10 pt-4"><p className="mb-2 text-[10px] opacity-45">{reply.author === 'star' ? '星星' : '小火'} · {shortDate(reply.created_at)}</p><StudyMarkdown content={reply.content}/></div>)}<div className="mt-4 flex flex-wrap gap-3 text-[10px] opacity-55"><button onClick={() => shareQuestion(block)} className="flex items-center gap-1"><Share2 size={11}/>{block.replies.length ? '分享' : '问星星'}</button>{block.replies.length > 0 && <button onClick={() => openQuestion(undefined, block.replies.at(-1)?.content.slice(0, 500), block.id)}>继续追问</button>}<button onClick={() => void setQuestionStatus(block, block.status === 'resolved' ? 'open' : 'resolved')}>{block.status === 'resolved' ? '重新打开' : '标记解决'}</button></div></section> : <figure key={block.id} data-block-id={block.id} className="group relative"><img src={`/api/study/assets/${encodeURIComponent(block.asset_id)}`} alt={block.caption || (block.type === 'ink' ? '手写卡片' : '学习笔记图片')} className="mx-auto max-h-[70dvh] max-w-full rounded-2xl object-contain"/>{editing ? <div className="mt-2 flex gap-2"><input value={block.caption} onChange={event => replaceBlock(block.id, { caption: event.target.value })} placeholder="图片说明（也会被搜索）" className="min-w-0 flex-1 bg-transparent text-center text-xs opacity-60 outline-none"/><button aria-label="移除图片块" onClick={() => removeBlock(block.id)} className="opacity-40"><X size={13}/></button></div> : block.caption && <figcaption className="mt-2 text-center text-xs opacity-50">{block.caption}</figcaption>}</figure>)}</div>
              {error && <p role="alert" className="mt-6 rounded-xl bg-red-500/10 p-3 text-xs text-red-500">{error}</p>}
            </div></article>
          </> : <div className="m-auto max-w-md p-8 text-center"><NotebookPen size={28} className="mx-auto opacity-25"/><p className="mt-4 font-serif text-xl">选一篇笔记，或新建一篇</p><p className="mt-2 text-xs opacity-40">数学公式、代码、日语振假名和提问都可以写在这里。</p></div>}
        </main>
      </div>
    </div>

    {searchOpen && <div className="fixed inset-0 z-[125] bg-black/45 p-4 backdrop-blur-sm"><div className={`mx-auto mt-[8dvh] max-h-[80dvh] max-w-2xl overflow-hidden rounded-[26px] ${panel}`}><div className="flex items-center gap-2 border-b border-current/10 p-4"><Search size={16}/><input autoFocus value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setSearchRan(false) }} onKeyDown={event => event.key === 'Enter' && void search()} placeholder="搜索标题、正文、代码、公式、提问…" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/><button onClick={() => void search()} className="rounded-full px-3 py-1 text-xs">搜索</button><button aria-label="关闭搜索" onClick={() => setSearchOpen(false)}><X size={17}/></button></div><div className="max-h-[65dvh] space-y-2 overflow-y-auto p-4">{searchResults.map(item => <button key={item.id} onClick={() => { setSearchOpen(false); void loadNote(item.id) }} className="w-full rounded-2xl border border-current/10 p-4 text-left"><p className="font-serif text-base">{item.title}</p><p className="mt-1 text-[10px] opacity-45">{item.field_name} / {item.page_name || '未分类'} · {shortDate(item.updated_at)}</p><p className="mt-2 line-clamp-3 text-xs leading-5 opacity-65">{item.excerpt}</p></button>)}{searchQuery && !searchResults.length && <p className="py-12 text-center text-xs opacity-35">{searchRan ? '没有找到相关笔记' : '按回车开始搜索'}</p>}</div></div></div>}

    {questionsOpen && <Drawer title="提问箱" onClose={() => setQuestionsOpen(false)} night={night}><div className="mb-4 flex gap-1 overflow-x-auto">{[['', '全部'], ['open', '等待回答'], ['answered', '已回答'], ['resolved', '已解决']].map(([value, label]) => <button key={value} onClick={() => setQuestionFilter(value)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${questionFilter === value ? 'bg-current/10' : 'border border-current/10 opacity-55'}`}>{label}</button>)}</div><div className="space-y-2">{questions.map(item => <button key={item.question.id} onClick={() => { setQuestionsOpen(false); void loadNote(item.note_id, item.question.id) }} className="w-full rounded-2xl border border-current/10 p-4 text-left"><p className="text-[9px] opacity-45">{item.field_name} / {item.page_name} / {item.note_title}{item.section ? ` / ${item.section}` : ''}</p><p className="mt-2 font-serif text-sm leading-6">{item.question.question}</p><p className="mt-2 text-[9px] opacity-40">{questionLabel[item.question.status]} · {shortDate(item.question.updated_at)}</p></button>)}{!questions.length && <p className="py-12 text-center text-xs opacity-35">这里还没有问题</p>}</div></Drawer>}

    {activityOpen && <Drawer title="学习动态" onClose={() => setActivityOpen(false)} night={night}><ActivityGroup title="今天" items={activity.today} exact onOpen={id => { setActivityOpen(false); void loadNote(id) }}/><ActivityGroup title="昨天" items={activity.yesterday} onOpen={id => { setActivityOpen(false); void loadNote(id) }}/><ActivityGroup title="本周较早" items={activity.older} onOpen={id => { setActivityOpen(false); void loadNote(id) }}/></Drawer>}

    {outlineOpen && <Drawer title="这篇笔记" onClose={() => setOutlineOpen(false)} night={night}><nav className="space-y-1">{outline.map(item => <button key={item.id} onClick={() => { setOutlineOpen(false); requestAnimationFrame(() => document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }} className="chat-theme-hover block w-full rounded-xl px-3 py-2 text-left text-sm" style={{ paddingLeft: `${Math.min(4, item.level) * .65}rem` }}>{item.title}</button>)}</nav></Drawer>}

    {commentsOpen && note && <Drawer title={`星星的批注 · ${note.title}`} onClose={() => setCommentsOpen(false)} night={night}><div className="space-y-3">{note.comments.map(comment => <button key={comment.id} disabled={!comment.block_id} onClick={() => jumpToBlock(comment.block_id)} className="chat-theme-panel chat-theme-border w-full rounded-2xl border p-4 text-left disabled:cursor-default"><p className="text-[9px] opacity-40">{comment.author === 'star' ? '星星' : '小火'} · {shortDate(comment.created_at)}{comment.block_id ? ' · 跳到原文' : ''}</p>{comment.quote && <blockquote className="mt-2 border-l border-current/15 pl-2 text-xs opacity-45">{comment.quote}</blockquote>}<div className="mt-2 text-sm"><StudyMarkdown content={comment.content}/></div></button>)}{!note.comments.length && <p className="py-8 text-center text-xs opacity-35">星星还没有留下批注</p>}</div></Drawer>}

    {quickOpen && <div className="fixed inset-0 z-[135] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"><div className={`study-quick-note w-full max-w-lg rounded-[28px] p-5 ${panel}`}><div className="flex items-center gap-2"><StickyNote size={17} className="chat-theme-accent"/><h3 className="flex-1 font-serif text-lg">随手记</h3><span className={`text-[9px] ${quickSaveState === 'error' ? 'text-red-500' : 'opacity-40'}`}>{quickSaveState === 'saving' ? '保存中' : quickSaveState === 'error' ? '保存失败' : '已保存'}</span><button aria-label="关闭随手记" onClick={() => void closeQuickNote()}><X size={17}/></button></div><textarea autoFocus value={quickDraft} onChange={event => setQuickDraft(event.target.value)} placeholder="还没想好放在哪里的东西，先写在这里……" className="mt-4 min-h-[48dvh] w-full resize-none bg-transparent p-1 font-serif text-base leading-8 outline-none"/></div></div>}
    {fieldSettings && <div className="fixed inset-0 z-[135] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"><div className={`w-full max-w-sm rounded-[28px] p-5 ${panel}`}><div className="flex items-center"><h3 className="flex-1 font-serif text-lg">分区设置</h3><button aria-label="关闭分区设置" onClick={() => setFieldSettings(null)}><X size={17}/></button></div><label className="mt-5 block text-[10px] opacity-45">名称</label><input autoFocus value={fieldNameDraft} onChange={event => setFieldNameDraft(event.target.value)} className="chat-theme-input mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"/><label className="mt-4 block text-[10px] opacity-45">小符号</label><div className="mt-2 grid grid-cols-6 gap-2">{FIELD_MARKS.map(mark => <button key={mark} aria-label={`使用符号 ${mark}`} onClick={() => setFieldMarkDraft(mark)} className={`chat-session-mono grid aspect-square place-items-center rounded-xl border text-sm ${fieldMarkDraft === mark ? 'chat-theme-accent-soft chat-theme-border' : 'border-current/10 opacity-55'}`}>{mark}</button>)}</div><div className="mt-5 grid grid-cols-2 gap-2"><button disabled={fields.findIndex(field => field.id === fieldSettings.id) <= 0} onClick={() => void moveFieldOrder('up')} className="chat-theme-hover flex items-center justify-center gap-2 rounded-xl border border-current/10 px-3 py-2 text-xs disabled:opacity-25"><ArrowUp size={13}/>上移</button><button disabled={fields.findIndex(field => field.id === fieldSettings.id) >= fields.length - 1} onClick={() => void moveFieldOrder('down')} className="chat-theme-hover flex items-center justify-center gap-2 rounded-xl border border-current/10 px-3 py-2 text-xs disabled:opacity-25"><ArrowDown size={13}/>下移</button></div><div className="mt-5 flex items-center justify-between"><button onClick={() => void archiveField(fieldSettings.id)} className="flex items-center gap-1 px-2 py-2 text-xs text-red-500/70"><Trash2 size={13}/>删除分区</button><div className="flex gap-2"><button onClick={() => setFieldSettings(null)} className="rounded-full px-4 py-2 text-xs opacity-50">取消</button><button disabled={!fieldNameDraft.trim()} onClick={() => void saveFieldSettings()} className="chat-theme-accent-bg rounded-full px-4 py-2 text-xs disabled:opacity-30">保存</button></div></div></div></div>}
    {questionComposer && <div className="fixed inset-0 z-[135] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"><div className={`w-full max-w-lg rounded-[26px] p-5 ${panel}`}><div className="flex items-center"><h3 className="flex-1 font-serif text-lg">{questionComposer.threadId ? '继续追问' : '插入提问'}</h3><button aria-label="取消提问" onClick={() => setQuestionComposer(null)}><X size={17}/></button></div>{questionComposer.quote && <blockquote className="mt-4 line-clamp-4 border-l border-current/20 pl-3 text-xs opacity-55">{questionComposer.quote}</blockquote>}<textarea autoFocus value={questionDraft} onChange={event => setQuestionDraft(event.target.value)} placeholder="你想问星星什么？" className="chat-theme-input mt-4 min-h-28 w-full rounded-2xl border p-4 text-sm outline-none"/><div className="mt-4 flex justify-end gap-2"><button onClick={() => setQuestionComposer(null)} className="rounded-full px-4 py-2 text-xs opacity-50">取消</button><button disabled={!questionDraft.trim()} onClick={() => void addQuestion()} className="chat-theme-accent-bg rounded-full px-4 py-2 text-xs disabled:opacity-30">{questionComposer.threadId ? '接着问' : '放进笔记'}</button></div></div></div>}
    {moveOpen && note && <div className="fixed inset-0 z-[135] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"><div className={`w-full max-w-sm rounded-[26px] p-5 ${panel}`}><div className="flex items-center"><h3 className="flex-1 font-serif text-lg">移动笔记</h3><button aria-label="取消移动" onClick={() => setMoveOpen(false)}><X size={17}/></button></div><label className="mt-5 block text-[10px] opacity-45">学习分区</label><select value={moveFieldId} onChange={event => { setMoveFieldId(event.target.value); setMoveSectionId('') }} className="chat-theme-input mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none">{fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><label className="mt-4 block text-[10px] opacity-45">子页</label><select value={moveSectionId} onChange={event => setMoveSectionId(event.target.value)} className="chat-theme-input mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"><option value="">未分类</option>{sections.filter(section => section.field_id === moveFieldId).map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select><div className="mt-5 flex justify-end gap-2"><button onClick={() => setMoveOpen(false)} className="rounded-full px-4 py-2 text-xs opacity-50">取消</button><button onClick={() => void moveNote()} className="chat-theme-accent-bg rounded-full px-4 py-2 text-xs">移动</button></div></div></div>}
    {inkOpen && <InkCanvas onClose={() => setInkOpen(false)} onSave={(dataUrl, strokes) => uploadData('ink', dataUrl, strokes)}/>}
  </div>
}

function Drawer({ title, onClose, night, children }: { title: string; onClose: () => void; night: boolean; children: ReactNode }) {
  return <div className="fixed inset-0 z-[125] bg-black/35"><button aria-label="关闭" onClick={onClose} className="absolute inset-0"/><aside className={`chat-theme-surface chat-theme-border absolute bottom-0 right-0 top-0 flex w-full max-w-md flex-col border-l shadow-2xl ${night ? 'text-night-text' : ''}`}><header className="chat-room-header flex items-center gap-3 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]"><h2 className="chat-session-title flex-1 text-xl font-bold">{title}</h2><button aria-label="关闭" onClick={onClose}><X size={18}/></button></header><div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div></aside></div>
}

function ActivityGroup({ title, items, exact = false, onOpen }: { title: string; items: ActivityItem[]; exact?: boolean; onOpen: (id: string) => void }) {
  if (!items.length) return null
  const shown = exact ? items : Array.from(new Map(items.map(item => [`${item.note_id}:${item.section || ''}:${item.kind}`, item])).values())
  return <section className="mb-6"><h3 className="mb-2 text-[10px] font-semibold tracking-[.18em] opacity-45">{title}</h3><div className="space-y-1">{shown.map(item => <button key={item.id} onClick={() => onOpen(item.note_id)} className="flex w-full gap-3 rounded-xl px-2 py-2 text-left hover:bg-current/5">{exact && <span className="w-10 shrink-0 text-[10px] tabular-nums opacity-40">{timeOnly(item.at)}</span>}<span className="min-w-0 text-xs leading-5"><b className="font-medium">{item.note_title}</b>{item.section ? ` · ${item.section}` : ''}<span className="ml-2 opacity-40">{item.kind === 'question' ? '提出问题' : item.kind === 'answer' ? '收到回答' : item.kind === 'create' ? '新建' : item.kind === 'image' ? '插入图片' : item.kind === 'ink' ? '添加手写' : '编辑'}</span></span></button>)}</div></section>
}
