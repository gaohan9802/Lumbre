'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, MessageSquareWarning, Pin, Plus, Send, Share2, Trash2, X } from 'lucide-react'
import { PaperActionDialog } from '@/components/PaperActionDialog'
import { notes as notesApi } from '@/lib/api'
import { formatMadridShort } from '@/lib/madrid-time'
import { shareToChat } from '@/lib/share'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { GuestbookBoard } from './GuestbookBoard'

interface Note {
  id: string
  author: string
  content: string
  tags?: string[]
  replies?: { author: string; content: string; time?: string; timestamp?: string }[]
  created_at: string
}

export function NotesView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()
  const [notesList, setNotesList] = useState<Note[]>([])
  const [isWriting, setIsWriting] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedNote, setExpandedNote] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [section, setSection] = useState<'notes' | 'guestbook'>('notes')
  const isNight = theme === 'night'

  useEffect(() => { void loadNotes() }, [])

  const loadNotes = async () => {
    try {
      const data = await notesApi.read()
      if (data.notes) setNotesList(data.notes)
    } catch (err) {
      console.error('Failed to load notes', err)
    } finally {
      setLoading(false)
    }
  }

  const handlePost = async () => {
    if (!newNote.trim()) return
    await notesApi.write(currentUser, newNote)
    setNewNote('')
    setIsWriting(false)
    void loadNotes()
  }

  const handleReply = async (noteId: string) => {
    if (!replyContent.trim()) return
    await notesApi.reply(noteId, currentUser, replyContent)
    setReplyContent('')
    setReplyingTo(null)
    void loadNotes()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await notesApi.delete(deleteTarget, currentUser)
    setDeleteTarget(null)
    void loadNotes()
  }

  const formatTime = (value: string) => value ? formatMadridShort(value) : ''

  return (
    <div className={`flex h-full flex-col ${isNight ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
      <div className={`flex flex-shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6 ${isNight ? 'border-night-border' : 'chat-dialog-line'}`}>
        <div role="tablist" aria-label="留言板分类" className="flex items-center gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/5">
          <button role="tab" aria-selected={section === 'notes'} onClick={() => setSection('notes')} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${section === 'notes' ? (isNight ? 'bg-night-surface text-night-amber' : 'bg-white text-[#765953] shadow-sm') : 'opacity-45'}`}>
            <Pin size={14}/><span>小纸条</span>
          </button>
          <button role="tab" aria-selected={section === 'guestbook'} onClick={() => setSection('guestbook')} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${section === 'guestbook' ? (isNight ? 'bg-night-surface text-night-amber' : 'bg-white text-[#765953] shadow-sm') : 'opacity-45'}`}>
            <MessageSquareWarning size={14}/><span>告状簿</span>
          </button>
        </div>
        {section === 'notes' && <button onClick={() => setIsWriting(true)} aria-label="贴一张小纸条" className={`rounded-full border p-2 transition ${isNight ? 'border-night-border text-night-amber hover:bg-night-surface' : 'chat-dialog-line hover:bg-[#DBB9B3]/18'}`}><Plus size={17}/></button>}
      </div>

      {section === 'guestbook' ? (
        <div className="min-h-0 flex-1"><GuestbookBoard actor="fire" endpoint="/api/guestbook?mark_read=1" onLoaded={() => window.dispatchEvent(new CustomEvent('lumbre-guestbook-read'))}/></div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
            <div className="mx-auto max-w-3xl">
              <AnimatePresence>
                {isWriting && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={`relative mb-4 rounded-2xl border p-4 ${isNight ? 'border-night-border bg-night-card' : 'chat-dialog-card'}`}>
                    <button onClick={() => { setIsWriting(false); setNewNote('') }} aria-label="取消写纸条" className="absolute right-3 top-3 opacity-40 hover:opacity-100"><X size={14}/></button>
                    <textarea value={newNote} onChange={event => setNewNote(event.target.value)} placeholder="留一句话给家里……" rows={3} autoFocus className="w-full resize-none bg-transparent pr-6 text-sm leading-relaxed outline-none"/>
                    <div className="mt-3 flex justify-end"><button onClick={handlePost} disabled={!newNote.trim()} className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-30 ${isNight ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>贴上去</button></div>
                  </motion.div>
                )}
              </AnimatePresence>

              {loading ? (
                <div className="py-16 text-center text-sm opacity-30">加载中…</div>
              ) : notesList.length === 0 ? (
                <div className="grid min-h-56 place-items-center text-center">
                  <div>
                    <Pin className="mx-auto opacity-20" size={28}/>
                    <p className="mt-3 text-sm opacity-45">冰箱门上还没有小纸条</p>
                    <button onClick={() => setIsWriting(true)} className={`mt-4 rounded-full px-4 py-2 text-xs ${isNight ? 'bg-night-card text-night-amber' : 'chat-dialog-card'}`}>贴第一张</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {notesList.map((note, index) => {
                    const isExpanded = expandedNote === note.id
                    const hasReplies = !!note.replies?.length
                    const canDelete = note.author === currentUser
                    const shareNote = () => shareToChat({ kind: 'note', title: '📌 小纸条', subtitle: `${note.author === 'star' ? '🐆' : '🦦'} · ${note.created_at}`, body: note.content, metadata: { ...note } })
                    return (
                      <motion.article key={note.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 5) * 0.03 }} className={`overflow-hidden rounded-2xl border ${isNight ? 'border-night-border bg-night-card/70' : 'chat-dialog-card'}`}>
                        <button type="button" onClick={() => setExpandedNote(isExpanded ? null : note.id)} aria-expanded={isExpanded} className="w-full px-4 py-4 text-left">
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className={`h-1.5 w-1.5 rounded-full ${note.author === 'star' ? 'bg-[#c89f99]' : 'bg-[#9caaa2]'}`}/>
                            <span className="font-medium opacity-75">{note.author === 'star' ? '🐆 星星' : '🦦 小火'}</span>
                            <span className="opacity-25">·</span>
                            <time className="opacity-40">{formatTime(note.created_at)}</time>
                            <span className="ml-auto flex items-center gap-2 opacity-35">{hasReplies && <span>回复 {note.replies!.length}</span>}<ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}/></span>
                          </div>
                          <p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${isExpanded ? '' : 'line-clamp-3'}`}>{note.content}</p>
                        </button>

                        {isExpanded && hasReplies && (
                          <div className={`mx-4 space-y-2 border-t pt-3 ${isNight ? 'border-night-border' : 'chat-dialog-line'}`}>
                            {note.replies!.map((reply, replyIndex) => (
                              <div key={replyIndex} className={`flex items-start gap-2 rounded-xl px-3 py-2 ${isNight ? 'bg-night-bg/45' : 'bg-[#DBB9B3]/10'}`}>
                                <span className="flex-shrink-0 text-xs">{reply.author === 'star' ? '🐆' : '🦦'}</span>
                                <div className="min-w-0 flex-1"><p className={`text-xs leading-relaxed ${isNight ? 'text-[#AEB8BF]' : 'text-[#8a6f69]'}`}>{reply.content}</p><span className="text-[9px] opacity-30">{formatTime(reply.time || reply.timestamp || '')}</span></div>
                              </div>
                            ))}
                          </div>
                        )}

                        {isExpanded && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className={`mx-4 mb-3 mt-3 space-y-2 border-t pt-3 ${isNight ? 'border-night-border' : 'chat-dialog-line'}`}>
                            {replyingTo === note.id ? (
                              <div className="flex items-center gap-2">
                                <input value={replyContent} onChange={event => setReplyContent(event.target.value)} placeholder="回一句…" autoFocus onKeyDown={event => event.key === 'Enter' && void handleReply(note.id)} className={`min-w-0 flex-1 border-b bg-transparent py-1 text-xs outline-none ${isNight ? 'border-night-border' : 'chat-dialog-line'}`}/>
                                <button onClick={() => void handleReply(note.id)} aria-label="发送回复" className="p-1 opacity-60 hover:opacity-100"><Send size={12}/></button>
                                <button onClick={() => { setReplyingTo(null); setReplyContent('') }} aria-label="取消回复" className="p-1 opacity-30 hover:opacity-60"><X size={12}/></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <button onClick={shareNote} aria-label="分享到 Chat" title="分享到 Chat" className="opacity-40 hover:opacity-100"><Share2 size={12}/></button>
                                <button onClick={() => setReplyingTo(note.id)} className="text-[11px] opacity-45 transition hover:opacity-80">回复</button>
                                {canDelete && <button onClick={() => setDeleteTarget(note.id)} className="flex items-center gap-0.5 text-[11px] opacity-35 transition hover:opacity-70"><Trash2 size={10}/>撕掉</button>}
                              </div>
                            )}
                          </motion.div>
                        )}
                      </motion.article>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <PaperActionDialog open={!!deleteTarget} title="撕掉这张纸条？" confirmLabel="撕掉" danger onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}/>
        </>
      )}
    </div>
  )
}
