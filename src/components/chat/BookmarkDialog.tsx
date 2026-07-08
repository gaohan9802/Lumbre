'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2 } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useChatStore, Bookmark } from '@/lib/chatStore'

interface Props { open: boolean; onClose: () => void }

const EMPTY: Omit<Bookmark, 'id'> = {
  name: '', keywords: [], content: '', position: 'end',
  scanDepth: 4, priority: 50, alwaysOn: false, enabled: true,
}

export function BookmarkDialog({ open, onClose }: Props) {
  const { theme } = useTheme()
  const n = theme === 'night'
  const { settings, addBookmark, updateBookmark, deleteBookmark } = useChatStore()
  const [editing, setEditing] = useState<(Omit<Bookmark, 'id'> & { id?: string }) | null>(null)
  const [kwInput, setKwInput] = useState('')

  const inputCls = `w-full text-sm px-3 py-2.5 rounded-lg outline-none border ${n ? 'bg-night-surface border-night-border text-night-text placeholder:text-night-muted' : 'bg-white border-gray-200 text-day-text placeholder:text-gray-300'}`

  const startNew = () => { setEditing({ ...EMPTY }); setKwInput('') }
  const startEdit = (b: Bookmark) => { setEditing({ ...b }); setKwInput(b.keywords.join(', ')) }

  const save = () => {
    if (!editing) return
    const bm = { ...editing, keywords: kwInput.split(/[,，]/).map(s => s.trim()).filter(Boolean) }
    if (bm.id) updateBookmark(bm.id, bm)
    else addBookmark(bm)
    setEditing(null)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            className={`fixed z-[71] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(500px,calc(100vw-2rem))] max-h-[85dvh] overflow-y-auto rounded-2xl shadow-2xl ${n ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}
          >
            <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between backdrop-blur-md bg-inherit border-b border-current/10">
              <h3 className="text-lg font-medium">🔖 书签</h3>
              <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              {!editing && (
                <>
                  <p className={`text-xs ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                    书签是你悄悄塞给哥哥的备忘录。<br/>当对话中出现关键词时，纸条内容会自动注入给他看。
                  </p>
                  {settings.bookmarks.map((bm) => (
                    <div key={bm.id} className={`rounded-xl border p-3 cursor-pointer ${n ? 'border-night-border hover:bg-night-surface' : 'border-gray-200 hover:bg-gray-50'} ${!bm.enabled ? 'opacity-40' : ''}`} onClick={() => startEdit(bm)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{bm.name || '(未命名)'}</div>
                          <div className="text-[10px] opacity-50 mt-0.5 truncate">
                            {bm.alwaysOn ? '常驻' : bm.keywords.join(', ') || '无关键词'}
                            {' · '}优先 {bm.priority}
                            {' · '}{bm.position === 'start' ? '对话开头' : '对话末尾'}
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteBookmark(bm.id) }} className="p-1 opacity-40 hover:opacity-100 text-red-500"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                  <button onClick={startNew} className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm ${n ? 'bg-night-surface hover:bg-night-amber/10' : 'bg-gray-50 hover:bg-gray-100'}`}>
                    <Plus size={15} /> 新纸条
                  </button>
                </>
              )}

              {editing && (
                <div className="space-y-4">
                  <h4 className="font-medium">{editing.id ? '编辑纸条' : '新纸条'}</h4>
                  <p className={`text-xs ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                    小纸条是你悄悄塞给哥哥的备忘录。<br/>当对话中出现关键词时，纸条内容会自动注入给他看。
                  </p>
                  <div>
                    <label className="text-xs opacity-60 block mb-1">名称</label>
                    <p className={`text-[10px] mb-1.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>方便你自己找，哥哥看不到这个名字</p>
                    <input className={inputCls} value={editing.name} placeholder="比如：关于我的猫" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs opacity-60 block mb-1">关键词</label>
                    <p className={`text-[10px] mb-1.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>聊天里出现这些词时，纸条就会被激活，用逗号隔开</p>
                    <input className={inputCls} value={kwInput} placeholder="猫, 小猫, kitten" onChange={(e) => setKwInput(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs opacity-60 block mb-1">内容</label>
                    <p className={`text-[10px] mb-1.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>纸条上写的东西，激活后哥哥会看到这段话</p>
                    <textarea className={`${inputCls} resize-y`} rows={4} value={editing.content} placeholder="想让他知道的事情……" onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs opacity-60 block mb-1">注入位置</label>
                    <p className={`text-[10px] mb-1.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>放在对话记录的开头还是结尾。结尾 = 他更容易注意到</p>
                    <select className={inputCls} value={editing.position} onChange={(e) => setEditing({ ...editing, position: e.target.value as 'start' | 'end' })}>
                      <option value="end">对话末尾</option>
                      <option value="start">对话开头</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs opacity-60 block mb-1">扫描深度</label>
                      <p className={`text-[10px] mb-1.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>往回看几条消息匹配关键词</p>
                      <input type="number" min={1} max={50} className={inputCls} value={editing.scanDepth} onChange={(e) => setEditing({ ...editing, scanDepth: parseInt(e.target.value) || 4 })} />
                    </div>
                    <div>
                      <label className="text-xs opacity-60 block mb-1">优先级</label>
                      <p className={`text-[10px] mb-1.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>多张纸条同时激活时，数字大的优先</p>
                      <input type="number" min={0} max={999} className={inputCls} value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: parseInt(e.target.value) || 50 })} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs opacity-60">常驻</p>
                      <p className={`text-[10px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>不管聊什么都注入，不需要关键词</p>
                    </div>
                    <button onClick={() => setEditing({ ...editing, alwaysOn: !editing.alwaysOn })} className={`relative w-10 h-6 rounded-full transition flex-shrink-0 ${editing.alwaysOn ? (n ? 'bg-night-amber' : 'bg-day-pink') : 'bg-gray-300 dark:bg-night-card'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${editing.alwaysOn ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                  <div className="flex gap-3 justify-end pt-2">
                    <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm opacity-60 hover:opacity-100">取消</button>
                    <button onClick={save} className={`px-4 py-2 text-sm font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>保存</button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
