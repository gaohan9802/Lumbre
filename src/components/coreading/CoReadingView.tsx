'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, ArrowLeft, ChevronLeft, ChevronRight, Send, Plus, Trash2, MessageSquare, BookMarked, Upload, FileText } from 'lucide-react'

// ── Types ──
interface Book {
  id: string; title: string; author: string
  lastChapter: number; lastReadAt: string; createdAt: string
}
interface ChapterListItem { chapterNum: number; title: string; hasDigest: boolean }
interface ChapterData {
  chapterNum: number; title: string; content: string; digest: string
}
interface Annotation {
  id: string; bookId: string; chapterNum: number
  originalText: string; annotation: string
  annotator: 'user' | 'ai'; createdAt: string
}
interface ChatMsg { who: 'user' | 'ai'; text: string; cnum: number; createdAt: string }

// ── Views ──
type View = 'shelf' | 'toc' | 'reading'

export function CoReadingView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const [view, setView] = useState<View>('shelf')
  const [books, setBooks] = useState<Book[]>([])
  const [currentBook, setCurrentBook] = useState<Book | null>(null)
  const [chapters, setChapters] = useState<ChapterListItem[]>([])
  const [chapter, setChapter] = useState<ChapterData | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [selection, setSelection] = useState('')
  const [showChat, setShowChat] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // ── Load books ──
  const loadBooks = useCallback(async () => {
    const res = await fetch('/api/coread/books')
    const data = await res.json()
    if (data.books) setBooks(data.books)
  }, [])

  useEffect(() => { loadBooks() }, [loadBooks])

  // ── Open book (TOC) ──
  const openBook = async (book: Book) => {
    setCurrentBook(book)
    const res = await fetch('/api/coread/books', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: book.id })
    })
    const data = await res.json()
    if (data.chapters) setChapters(data.chapters)
    setView('toc')
  }

  // ── Open chapter ──
  const openChapter = async (cnum: number) => {
    if (!currentBook) return
    const res = await fetch('/api/coread/chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: currentBook.id, chapterNum: cnum })
    })
    const data = await res.json()
    if (data.chapter) {
      setChapter(data.chapter)
      setAnnotations(data.annotations || [])
      setView('reading')
      setShowChat(false)
      // Load chat history
      loadChatHistory()
    }
  }

  // ── Load chat history ──
  const loadChatHistory = async () => {
    if (!currentBook) return
    const res = await fetch(`/api/coread/chat?bookId=${currentBook.id}`)
    const data = await res.json()
    if (data.items) setChatMsgs(data.items)
  }

  // ── Text selection ──
  const handleTextSelect = () => {
    const sel = window.getSelection()?.toString().trim() || ''
    setSelection(sel.slice(0, 500))
  }

  // ── Send chat message (SSE) ──
  const sendChat = async () => {
    if (!chatInput.trim() || !currentBook || !chapter || streaming) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatMsgs(prev => [...prev, { who: 'user', text: msg, cnum: chapter.chapterNum, createdAt: new Date().toISOString() }])
    setStreaming(true)
    setLiveText('')

    try {
      const res = await fetch('/api/coread/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: currentBook.id,
          chapterNum: chapter.chapterNum,
          message: msg,
          selection: selection || undefined,
        })
      })

      if (!res.ok) {
        const err = await res.json()
        setChatMsgs(prev => [...prev, { who: 'ai', text: `（错误：${err.error || '未知'}）`, cnum: chapter.chapterNum, createdAt: new Date().toISOString() }])
        setStreaming(false)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let finalReply = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: live')) continue
          if (line.startsWith('data: ')) {
            try {
              const d = JSON.parse(line.slice(6))
              if (d.t) { setLiveText(d.t); finalReply = d.t }
              if (d.reply) { finalReply = d.reply }
              if (d.error) { finalReply = d.error }
            } catch {}
          }
        }
      }

      if (finalReply) {
        setChatMsgs(prev => [...prev, { who: 'ai', text: finalReply, cnum: chapter.chapterNum, createdAt: new Date().toISOString() }])
      }
      setSelection('')
    } catch (e: any) {
      setChatMsgs(prev => [...prev, { who: 'ai', text: `（连接失败：${e.message}）`, cnum: chapter.chapterNum, createdAt: new Date().toISOString() }])
    }
    setStreaming(false)
    setLiveText('')
  }

  // ── Add user annotation ──
  const addUserAnnotation = async () => {
    if (!selection || !currentBook || !chapter) return
    const note = prompt('写一条批注：')
    if (!note?.trim()) return
    const res = await fetch('/api/coread/annotate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: currentBook.id,
        chapterNum: chapter.chapterNum,
        originalText: selection,
        annotation: note.trim(),
      })
    })
    const data = await res.json()
    if (data.success && data.annotation) {
      setAnnotations(prev => [...prev, data.annotation])
    }
    setSelection('')
  }

  // ── Delete book ──
  const handleDeleteBook = async (bookId: string) => {
    if (!confirm('确定删除这本书？所有阅读记录和批注都会丢失。')) return
    await fetch('/api/coread/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId })
    })
    loadBooks()
  }

  // ── Import ──
  const handleImportText = async (title: string, author: string, content: string) => {
    const res = await fetch('/api/coread/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', title, author, content })
    })
    const data = await res.json()
    if (data.success) {
      setShowImport(false)
      loadBooks()
    } else {
      alert(data.error || '导入失败')
    }
  }

  const handleImportEpub = async (file: File) => {
    // Parse epub in browser using simple approach
    // Read as arrayBuffer, parse the container.xml and content
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(file)
      
      // Find container.xml
      const container = await zip.file('META-INF/container.xml')?.async('text')
      if (!container) throw new Error('不是有效的 EPUB 文件')
      
      const rootfileMatch = container.match(/full-path="([^"]+)"/)
      if (!rootfileMatch) throw new Error('找不到根文件')
      
      const rootPath = rootfileMatch[1]
      const rootDir = rootPath.includes('/') ? rootPath.substring(0, rootPath.lastIndexOf('/') + 1) : ''
      const opf = await zip.file(rootPath)?.async('text')
      if (!opf) throw new Error('找不到 OPF')
      
      // Parse title & author
      const titleMatch = opf.match(/<dc:title[^>]*>([^<]+)/)
      const authorMatch = opf.match(/<dc:creator[^>]*>([^<]+)/)
      const title = titleMatch?.[1] || file.name.replace('.epub', '')
      const author = authorMatch?.[1] || ''
      
      // Parse spine order
      const spineItems: string[] = []
      const spineMatch = opf.match(/<spine[^>]*>([\s\S]*?)<\/spine>/)
      if (spineMatch) {
        const refs = spineMatch[1].matchAll(/idref="([^"]+)"/g)
        for (const m of refs) spineItems.push(m[1])
      }
      
      // Parse manifest
      const manifest: Record<string, string> = {}
      const itemMatches = opf.matchAll(/<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*/>/g)
      for (const m of itemMatches) manifest[m[1]] = m[2]
      
      // Also try alternate attribute order
      const itemMatches2 = opf.matchAll(/<item\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*/>/g)
      for (const m of itemMatches2) manifest[m[2]] = m[1]
      
      // Extract chapters
      const chapters: { title: string; content: string }[] = []
      for (const itemId of spineItems) {
        const href = manifest[itemId]
        if (!href) continue
        const fullPath = rootDir + href
        const html = await zip.file(fullPath)?.async('text')
        if (!html) continue
        
        const text = html
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
          .replace(/\n{3,}/g, '\n\n').trim()
        
        if (text.length < 20) continue
        
        const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)
        const chTitle = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : `第${chapters.length + 1}章`
        chapters.push({ title: chTitle, content: text })
      }
      
      if (!chapters.length) throw new Error('未提取到章节')
      
      const res = await fetch('/api/coread/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'chapters', title, author, chapters })
      })
      const data = await res.json()
      if (data.success) {
        setShowImport(false)
        loadBooks()
      } else {
        alert(data.error || '导入失败')
      }
    } catch (e: any) {
      alert('EPUB 解析失败: ' + e.message)
    }
  }

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMsgs, liveText])

  // ── RENDER ──
  const bg = isNight ? 'bg-[#1e1e1d]' : 'bg-[#faf9f7]'
  const tx = isNight ? 'text-[#f5f4f1]' : 'text-[#1f1f1e]'
  const soft = isNight ? 'text-[#f5f4f1]/60' : 'text-[#1f1f1e]/60'
  const card = isNight ? 'bg-[#f5f4f1]/5' : 'bg-[#1f1f1e]/4'
  const border = isNight ? 'border-[#f5f4f1]/10' : 'border-[#1f1f1e]/10'
  const accent = 'text-[#b0543f]'

  // ── Shelf View ──
  if (view === 'shelf') {
    return (
      <div className={`h-full overflow-y-auto p-4 ${bg} ${tx}`}>
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-serif">📖 共读书架</h2>
              <p className={`text-sm ${soft} italic`}>falling in love on the same page</p>
            </div>
            <button onClick={() => setShowImport(true)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm ${card} border ${border} hover:opacity-80`}>
              <Plus size={14} /> 导入
            </button>
          </div>

          {books.length === 0 ? (
            <div className={`text-center py-12 ${soft}`}>
              <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
              <p>书架还是空的</p>
              <p className="text-sm mt-1">导入一本 epub 或文本，开始共读</p>
            </div>
          ) : (
            <div className="space-y-2">
              {books.map(book => (
                <div key={book.id} className={`p-3 rounded-lg ${card} border ${border} cursor-pointer hover:opacity-80 flex items-center justify-between`}
                  onClick={() => openBook(book)}>
                  <div>
                    <div className="font-medium">{book.title}</div>
                    <div className={`text-xs ${soft}`}>
                      {book.author && `${book.author} · `}
                      {book.lastChapter ? `读到第${book.lastChapter}章` : '未开始'}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteBook(book.id) }}
                    className={`p-1 rounded hover:bg-red-500/20 ${soft}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Import Modal */}
          <AnimatePresence>
            {showImport && <ImportModal onClose={() => setShowImport(false)} onImportText={handleImportText} onImportEpub={handleImportEpub} isNight={isNight} />}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // ── TOC View ──
  if (view === 'toc') {
    return (
      <div className={`h-full overflow-y-auto p-4 ${bg} ${tx}`}>
        <div className="max-w-xl mx-auto">
          <button onClick={() => { setView('shelf'); setCurrentBook(null) }} className={`flex items-center gap-1 text-sm ${soft} mb-4 hover:opacity-80`}>
            <ArrowLeft size={14} /> 书架
          </button>
          <h2 className="text-xl font-serif mb-1">{currentBook?.title}</h2>
          {currentBook?.author && <p className={`text-sm ${soft} mb-4`}>{currentBook.author}</p>}
          
          <div className="space-y-1">
            {chapters.map(ch => (
              <div key={ch.chapterNum}
                className={`p-2.5 rounded-lg cursor-pointer hover:opacity-80 flex items-center justify-between ${
                  ch.chapterNum === currentBook?.lastChapter ? `${card} border ${border}` : ''
                }`}
                onClick={() => openChapter(ch.chapterNum)}>
                <span className="text-sm">
                  <span className={soft}>#{ch.chapterNum}</span>{' '}
                  {ch.title}
                </span>
                <span className="flex items-center gap-1">
                  {ch.hasDigest && <BookMarked size={12} className={soft} />}
                  {ch.chapterNum === currentBook?.lastChapter && <span className={`text-xs ${accent}`}>上次读到</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Reading View ──
  return (
    <div className={`h-full flex flex-col ${bg} ${tx}`}>
      {/* Top bar */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${border} shrink-0`}>
        <button onClick={() => setView('toc')} className={`flex items-center gap-1 text-sm ${soft}`}>
          <ArrowLeft size={14} /> 目录
        </button>
        <span className="text-sm font-medium truncate mx-2">
          {chapter?.title || `第${chapter?.chapterNum}章`}
        </span>
        <button onClick={() => setShowChat(!showChat)} className={`p-1.5 rounded-lg ${showChat ? accent : soft} ${card}`}>
          <MessageSquare size={16} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Content panel */}
        <div className={`flex-1 overflow-y-auto p-4 ${showChat ? 'hidden md:block md:w-1/2' : ''}`}
          ref={contentRef} onMouseUp={handleTextSelect} onTouchEnd={handleTextSelect}>
          <div className="max-w-xl mx-auto">
            <p className={`text-xs ${soft} mb-4`}>{currentBook?.title} · #{chapter?.chapterNum}</p>
            
            {/* Chapter content with annotations highlighted */}
            <ChapterContent content={chapter?.content || ''} annotations={annotations} isNight={isNight} />

            {/* Selection action bar */}
            {selection && (
              <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 flex gap-2 p-2 rounded-xl ${card} border ${border} backdrop-blur-sm shadow-lg z-50`}>
                <button onClick={addUserAnnotation} className="px-3 py-1 text-xs rounded-lg bg-purple-500/20 text-purple-300">
                  ✏️ 批注
                </button>
                <button onClick={() => { setShowChat(true) }} className="px-3 py-1 text-xs rounded-lg bg-blue-500/20 text-blue-300">
                  💬 聊这句
                </button>
              </div>
            )}

            {/* Chapter nav */}
            <div className={`flex justify-between mt-8 pt-4 border-t ${border} text-sm ${soft}`}>
              {chapter && chapter.chapterNum > 1 ? (
                <button onClick={() => openChapter(chapter.chapterNum - 1)} className="flex items-center gap-1 hover:opacity-80">
                  <ChevronLeft size={14} /> 上一章
                </button>
              ) : <span />}
              {chapter && chapters.find(c => c.chapterNum === chapter.chapterNum + 1) ? (
                <button onClick={() => openChapter(chapter.chapterNum + 1)} className="flex items-center gap-1 hover:opacity-80">
                  下一章 <ChevronRight size={14} />
                </button>
              ) : <span />}
            </div>
          </div>
        </div>

        {/* Chat panel */}
        {showChat && (
          <div className={`w-full md:w-1/2 flex flex-col border-l ${border}`}>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {chatMsgs.length === 0 && !streaming && (
                <div className={`text-center py-8 ${soft} text-sm`}>
                  <p>选中一句话，或直接开聊</p>
                  <p className="text-xs mt-1">AI 只就你正读的内容讨论，不会剧透</p>
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} className={`text-sm ${m.who === 'user' ? 'text-right' : ''}`}>
                  <div className={`inline-block max-w-[85%] px-3 py-2 rounded-xl ${
                    m.who === 'user'
                      ? (isNight ? 'bg-purple-900/30' : 'bg-purple-100')
                      : card
                  }`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>
                </div>
              ))}
              {streaming && liveText && (
                <div className="text-sm">
                  <div className={`inline-block max-w-[85%] px-3 py-2 rounded-xl ${card}`}>
                    <p className="whitespace-pre-wrap">{liveText}</p>
                    <span className="inline-block w-1.5 h-4 bg-current opacity-50 animate-pulse ml-0.5" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Selection indicator */}
            {selection && (
              <div className={`px-3 py-1 text-xs ${soft} border-t ${border} truncate`}>
                💬 讨论：「{selection.slice(0, 60)}...」
              </div>
            )}

            {/* Input */}
            <div className={`p-2 border-t ${border} flex gap-2`}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                placeholder={selection ? '聊聊这句...' : '说点什么...'}
                disabled={streaming}
                className={`flex-1 px-3 py-2 rounded-lg text-sm ${card} border ${border} bg-transparent outline-none`}
              />
              <button onClick={sendChat} disabled={streaming || !chatInput.trim()}
                className={`p-2 rounded-lg ${accent} disabled:opacity-30`}>
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Chapter Content with annotation highlights ──
function ChapterContent({ content, annotations, isNight }: { content: string; annotations: Annotation[]; isNight: boolean }) {
  if (!content) return null
  
  // Build highlighted HTML
  let html = content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')

  // Sort annotations by original text length (longer first to avoid partial matches)
  const sorted = [...annotations].filter(a => a.originalText).sort((a, b) => b.originalText.length - a.originalText.length)
  const embedded = new Set<string>()
  
  for (const ann of sorted) {
    const escaped = ann.originalText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (embedded.has(escaped)) continue
    const idx = html.indexOf(escaped)
    if (idx < 0) continue
    // Don't nest inside existing spans
    const before = html.slice(0, idx)
    if ((before.match(/<span/g)?.length || 0) > (before.match(/<\/span>/g)?.length || 0)) continue
    
    const cls = ann.annotator === 'user'
      ? (isNight ? 'bg-purple-500/20 rounded px-0.5' : 'bg-purple-200/60 rounded px-0.5')
      : (isNight ? 'border-b border-[#b0543f]' : 'border-b border-[#b0543f]')
    const tooltip = ann.annotation.slice(0, 100)
    html = before + `<span class="${cls}" title="${tooltip.replace(/"/g, '&quot;')}">${escaped}</span>` + html.slice(idx + escaped.length)
    embedded.add(escaped)
  }

  return (
    <div
      className="text-base leading-relaxed font-serif"
      style={{ whiteSpace: 'pre-wrap' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ── Import Modal ──
function ImportModal({ onClose, onImportText, onImportEpub, isNight }: {
  onClose: () => void
  onImportText: (title: string, author: string, content: string) => void
  onImportEpub: (file: File) => void
  isNight: boolean
}) {
  const [tab, setTab] = useState<'epub' | 'text'>('epub')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const bg = isNight ? 'bg-[#2a2a29]' : 'bg-white'
  const border = isNight ? 'border-[#f5f4f1]/10' : 'border-[#1f1f1e]/10'
  const card = isNight ? 'bg-[#f5f4f1]/5' : 'bg-[#1f1f1e]/4'

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className={`w-full max-w-md rounded-xl ${bg} border ${border} p-4 shadow-xl`}
        onClick={e => e.stopPropagation()}>
        <h3 className="text-lg mb-3">导入书籍</h3>
        
        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('epub')} className={`px-3 py-1 rounded-lg text-sm ${tab === 'epub' ? 'bg-purple-500/20' : card}`}>
            <Upload size={12} className="inline mr-1" /> EPUB
          </button>
          <button onClick={() => setTab('text')} className={`px-3 py-1 rounded-lg text-sm ${tab === 'text' ? 'bg-purple-500/20' : card}`}>
            <FileText size={12} className="inline mr-1" /> 纯文本
          </button>
        </div>

        {tab === 'epub' ? (
          <div>
            <p className="text-sm opacity-60 mb-3">选择一个 .epub 文件（请用公版书或你有权使用的书）</p>
            <input ref={fileRef} type="file" accept=".epub"
              onChange={e => { const f = e.target.files?.[0]; if (f) onImportEpub(f) }}
              className="text-sm" />
          </div>
        ) : (
          <div className="space-y-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="书名 *"
              className={`w-full px-3 py-2 rounded-lg text-sm border ${border} bg-transparent`} />
            <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="作者"
              className={`w-full px-3 py-2 rounded-lg text-sm border ${border} bg-transparent`} />
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="粘贴全文..."
              rows={8} className={`w-full px-3 py-2 rounded-lg text-sm border ${border} bg-transparent resize-none`} />
            <button onClick={() => { if (title && text) onImportText(title, author, text) }}
              disabled={!title || !text}
              className="px-4 py-2 rounded-lg bg-purple-500/20 text-sm disabled:opacity-30">
              导入
            </button>
          </div>
        )}

        <button onClick={onClose} className={`mt-3 text-sm opacity-50 hover:opacity-80`}>取消</button>
      </motion.div>
    </motion.div>
  )
}
