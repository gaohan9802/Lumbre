'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Send } from 'lucide-react'

interface Note {
  id: string
  author: string
  content: string
  tags?: string
  replies?: { author: string; content: string; timestamp: string }[]
  created_at: string
}

export function NotesView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()
  const [notes, setNotes] = useState<Note[]>([])
  const [isWriting, setIsWriting] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [loading, setLoading] = useState(true)

  const isNight = theme === 'night'

  useEffect(() => {
    loadNotes()
  }, [])

  const loadNotes = async () => {
    try {
      const res = await fetch('/api/notes/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.notes) setNotes(data.notes)
    } catch (err) {
      console.error('Failed to load notes', err)
    } finally {
      setLoading(false)
    }
  }

  const handlePost = async () => {
    if (!newNote.trim()) return
    try {
      await fetch('/api/notes/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: currentUser, content: newNote }),
      })
      setNewNote('')
      setIsWriting(false)
      loadNotes()
    } catch (err) {
      console.error('Failed to post note', err)
    }
  }

  const handleReply = async (noteId: string) => {
    if (!replyContent.trim()) return
    try {
      await fetch('/api/notes/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: noteId, author: currentUser, content: replyContent }),
      })
      setReplyContent('')
      setReplyingTo(null)
      loadNotes()
    } catch (err) {
      console.error('Failed to reply', err)
    }
  }

  // Random rotations for sticky note effect
  const rotations = [-2, 1, -1, 2, -1.5, 0.5, -0.5, 1.5]

  const noteColors = isNight
    ? ['bg-night-surface', 'bg-night-amber/10', 'bg-night-card']
    : ['bg-day-lemon/40', 'bg-day-pink/15', 'bg-day-sky/20', 'bg-white']

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">📌 留言板</h2>
        <button
          onClick={() => setIsWriting(true)}
          className={`p-2 rounded-xl transition ${
            isNight ? 'hover:bg-night-surface text-night-amber' : 'hover:bg-day-pink/10 text-day-heart'
          }`}
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {/* Writing new note */}
        <AnimatePresence>
          {isWriting && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`mb-4 p-4 rounded-2xl ${
                isNight ? 'bg-night-amber/10' : 'bg-day-lemon/50'
              }`}
            >
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="贴一张纸条..."
                rows={3}
                autoFocus
                className={`w-full bg-transparent outline-none text-sm resize-none ${
                  isNight ? 'placeholder:text-night-muted' : 'placeholder:text-day-muted'
                }`}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => { setIsWriting(false); setNewNote('') }}
                  className="text-xs opacity-50 hover:opacity-100"
                >
                  算了
                </button>
                <button
                  onClick={handlePost}
                  className={`px-3 py-1 rounded-lg text-xs ${
                    isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                  }`}
                >
                  贴！
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Notes grid */}
        {loading ? (
          <div className="text-center py-12 opacity-30">加载中...</div>
        ) : notes.length === 0 ? (
          <div className="text-center py-12 opacity-30 space-y-2">
            <span className="text-3xl">📌</span>
            <p className="text-sm">冰箱门还是空的</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {notes.map((note, i) => (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                style={{ rotate: rotations[i % rotations.length] }}
                className={`
                  p-4 rounded-2xl
                  ${noteColors[i % noteColors.length]}
                  hover:rotate-0 transition-transform duration-200
                `}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-xs opacity-50">
                    {note.author === 'star' ? '⭐' : '🔥'}
                  </span>
                  <span className="text-[10px] opacity-30">{note.created_at?.slice(0, 10)}</span>
                </div>
                <p className="text-sm leading-relaxed">{note.content}</p>
                
                {/* Replies */}
                {note.replies && note.replies.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-black/5 dark:border-white/5 pt-2">
                    {note.replies.map((reply, j) => (
                      <div key={j} className="text-xs opacity-70">
                        <span>{reply.author === 'star' ? '⭐' : '🔥'}</span> {reply.content}
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply input */}
                {replyingTo === note.id ? (
                  <div className="mt-2 flex gap-1">
                    <input
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder="回复..."
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleReply(note.id)}
                      className="flex-1 text-xs bg-transparent border-b border-current/20 outline-none py-1"
                    />
                    <button onClick={() => handleReply(note.id)} className="p-1">
                      <Send size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setReplyingTo(note.id)}
                    className="mt-2 text-[10px] opacity-30 hover:opacity-60"
                  >
                    回复
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
