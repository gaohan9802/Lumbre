'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Send, Trash2, X } from 'lucide-react'
import { notes as notesApi } from '@/lib/api'

interface Note {
  id: string
  author: string
  content: string
  tags?: string[]
  replies?: { author: string; content: string; time?: string; timestamp?: string }[]
  created_at: string
}

// Sticky note color palettes
const dayColors = [
  { bg: '#FEDAB8', border: '#F3C896' },  // Banana
  { bg: '#F3A4AC', border: '#E8909A' },  // Girl's Dream
  { bg: '#B8E0E8', border: '#84BECA' },  // Diamond light
  { bg: '#FFF5F0', border: '#F3A4AC' },  // Warm white
  { bg: '#FFE5E5', border: '#EF4067' },  // Heartbeat light
]
const nightColors = [
  { bg: '#2A2E37', border: '#D4A574' },
  { bg: '#2E2A27', border: '#8B7355' },
  { bg: '#252830', border: '#4A5568' },
]

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

  const isNight = theme === 'night'

  useEffect(() => { loadNotes() }, [])

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
    loadNotes()
  }

  const handleReply = async (noteId: string) => {
    if (!replyContent.trim()) return
    await notesApi.reply(noteId, currentUser, replyContent)
    setReplyContent('')
    setReplyingTo(null)
    loadNotes()
  }

  const handleDelete = async (noteId: string) => {
    if (!confirm('撕掉这张纸条？')) return
    await notesApi.delete(noteId, currentUser)
    loadNotes()
  }

  const rotations = [-2.5, 1.8, -1.2, 2.3, -0.8, 1.5, -1.8, 0.6, -2, 1.2]
  const colors = isNight ? nightColors : dayColors

  const formatTime = (t: string) => {
    if (!t) return ''
    const d = new Date(t)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${h}:${m}`
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between flex-shrink-0">
        <h2 className="text-lg font-medium">
          📌 留言板
          <span className={`ml-2 text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
            {notesList.length} 张纸条
          </span>
        </h2>
        <button
          onClick={() => setIsWriting(true)}
          className={`p-2.5 rounded-xl transition ${
            isNight ? 'hover:bg-night-surface text-night-amber' : 'hover:bg-day-lemon text-day-pink'
          }`}
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Fridge door surface */}
      <div className={`flex-1 overflow-y-auto px-4 pb-6 ${
        isNight ? '' : 'bg-gradient-to-b from-day-bg to-[#F5EDE6]'
      }`}>
        {/* Write new note - floating card */}
        <AnimatePresence>
          {isWriting && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0, rotate: -3 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.8, opacity: 0, rotate: 3 }}
              className="mb-4 p-5 rounded-2xl shadow-lg relative"
              style={{
                backgroundColor: isNight ? '#2A2E37' : '#FEDAB8',
                borderLeft: `3px solid ${isNight ? '#D4A574' : '#EF4067'}`,
              }}
            >
              <button
                onClick={() => { setIsWriting(false); setNewNote('') }}
                className="absolute top-3 right-3 opacity-40 hover:opacity-100"
              >
                <X size={14} />
              </button>
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="写点什么贴上去..."
                rows={4}
                autoFocus
                className="w-full bg-transparent outline-none text-sm resize-none leading-relaxed"
                style={{ color: isNight ? '#E8E0D8' : '#5C4B51' }}
              />
              <div className="flex justify-end mt-3">
                <button
                  onClick={handlePost}
                  disabled={!newNote.trim()}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition disabled:opacity-30 ${
                    isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                  }`}
                >
                  📌 贴！
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="text-center py-16 opacity-30 text-sm">加载中...</div>
        ) : notesList.length === 0 ? (
          <div className="text-center py-16 opacity-30 space-y-3">
            <span className="text-4xl">🧲</span>
            <p className="text-sm">冰箱门还是空的</p>
            <p className="text-xs">贴一张纸条吧</p>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 gap-3 space-y-3">
            {notesList.map((note, i) => {
              const color = colors[i % colors.length]
              const rot = rotations[i % rotations.length]
              const isExpanded = expandedNote === note.id
              const hasReplies = note.replies && note.replies.length > 0
              const canDelete = note.author === currentUser

              return (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 15, rotate: rot }}
                  animate={{ opacity: 1, y: 0, rotate: isExpanded ? 0 : rot }}
                  whileHover={{ rotate: 0, scale: 1.02 }}
                  transition={{ delay: i * 0.04 }}
                  className="break-inside-avoid p-4 rounded-xl cursor-pointer relative group"
                  style={{
                    backgroundColor: color.bg,
                    borderLeft: `3px solid ${color.border}`,
                    boxShadow: isNight
                      ? '2px 3px 8px rgba(0,0,0,0.3)'
                      : '2px 3px 12px rgba(0,0,0,0.08)',
                  }}
                  onClick={() => setExpandedNote(isExpanded ? null : note.id)}
                >
                  {/* Pin icon */}
                  <div className="absolute -top-1.5 left-4 text-sm">📌</div>

                  {/* Author + time */}
                  <div className="flex items-center justify-between mb-2 mt-1">
                    <span className="text-xs font-medium" style={{ color: isNight ? '#D4A574' : '#5C4B51' }}>
                      {note.author === 'star' ? '⭐ 星星' : '🔥 小火'}
                    </span>
                    <span className="text-[10px] opacity-40">
                      {formatTime(note.created_at)}
                    </span>
                  </div>

                  {/* Content */}
                  <p
                    className={`text-sm leading-relaxed ${isExpanded ? '' : 'line-clamp-4'}`}
                    style={{ color: isNight ? '#E8E0D8' : '#4A3728' }}
                  >
                    {note.content}
                  </p>

                  {/* Tags */}
                  {note.tags && note.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {note.tags.map((tag, j) => (
                        <span
                          key={j}
                          className="text-[10px] px-1.5 py-0.5 rounded-full opacity-60"
                          style={{
                            backgroundColor: isNight ? 'rgba(212,165,116,0.2)' : 'rgba(239,64,103,0.15)',
                            color: isNight ? '#D4A574' : '#EF4067',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Replies */}
                  {hasReplies && (
                    <div className="mt-3 pt-2 space-y-2" style={{
                      borderTop: `1px dashed ${isNight ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                    }}>
                      {note.replies!.map((reply, j) => (
                        <div key={j} className="flex gap-2 items-start">
                          <span className="text-xs flex-shrink-0">
                            {reply.author === 'star' ? '⭐' : '🔥'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs leading-relaxed" style={{ color: isNight ? '#C0B8B0' : '#5C4B51' }}>
                              {reply.content}
                            </p>
                            <span className="text-[9px] opacity-30">
                              {formatTime(reply.time || reply.timestamp || '')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions - show on expand */}
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-3 pt-2 space-y-2"
                      style={{
                        borderTop: hasReplies ? 'none' : `1px dashed ${isNight ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Reply input */}
                      {replyingTo === note.id ? (
                        <div className="flex gap-2 items-center">
                          <input
                            value={replyContent}
                            onChange={(e) => setReplyContent(e.target.value)}
                            placeholder="回一句..."
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleReply(note.id)}
                            className="flex-1 text-xs bg-transparent outline-none py-1"
                            style={{
                              borderBottom: `1px solid ${isNight ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
                              color: isNight ? '#E8E0D8' : '#4A3728',
                            }}
                          />
                          <button
                            onClick={() => handleReply(note.id)}
                            className="p-1 opacity-60 hover:opacity-100"
                          >
                            <Send size={12} />
                          </button>
                          <button
                            onClick={() => { setReplyingTo(null); setReplyContent('') }}
                            className="p-1 opacity-30 hover:opacity-60"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-3 items-center">
                          <button
                            onClick={() => setReplyingTo(note.id)}
                            className="text-[11px] opacity-40 hover:opacity-80 transition"
                          >
                            💬 回复
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(note.id)}
                              className="text-[11px] opacity-30 hover:opacity-60 transition flex items-center gap-0.5"
                            >
                              <Trash2 size={10} /> 撕掉
                            </button>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Reply count hint when collapsed */}
                  {!isExpanded && hasReplies && (
                    <div className="mt-2 text-[10px] opacity-40">
                      💬 {note.replies!.length} 条回复
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
