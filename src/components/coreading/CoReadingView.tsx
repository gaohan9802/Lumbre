'use client'
import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, ArrowLeft, ChevronLeft, ChevronRight, Send, Plus, Trash2, MessageSquare, BookMarked, Upload, FileText, Palette, Sun, Moon, ImagePlus, X } from 'lucide-react'
import { useChatStore, getActiveProfile } from '@/lib/chatStore'
import { useCoreadAppearance, fileToDataUrl } from '@/lib/coreadAppearance'

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

type View = 'shelf' | 'toc' | 'reading'

export function CoReadingView() {
  const { theme, toggle: toggleTheme } = useTheme()
  const isNight = theme === 'night'
  const settings = useChatStore((s) => s.settings)
  const { ap } = useCoreadAppearance()

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
  const [showAppearance, setShowAppearance] = useState(false)
  const [activeAnn, setActiveAnn] = useState<Annotation | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Active API profile, shared with the 星星 module.
  const apiProfilePayload = useCallback(() => {
    const profile = getActiveProfile(settings)
    if (!profile?.apiKey) return undefined
    return {
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      modelId: settings.model,
    }
  }, [settings])

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
    setActiveAnn(null)
    const res = await fetch('/api/coread/chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: currentBook.id, chapterNum: cnum, api_profile: apiProfilePayload() })
    })
    const data = await res.json()
    if (data.chapter) {
      setChapter(data.chapter)
      setAnnotations(data.annotations || [])
      setView('reading')
      setShowChat(false)
      loadChatHistory(cnum)
    }
  }

  // ── Load chat history (isolated to the current chapter) ──
  const loadChatHistory = async (cnum: number) => {
    if (!currentBook) return
    const res = await fetch(`/api/coread/chat?bookId=${currentBook.id}&cnum=${cnum}`)
    const data = await res.json()
    if (data.items) setChatMsgs(data.items)
    else setChatMsgs([])
  }

  // ── Text selection ──
  const handleTextSelect = () => {
    const sel = window.getSelection()?.toString().trim() || ''
    if (sel) setSelection(sel.slice(0, 500))
  }

  // ── Send chat message (SSE) ──
  const sendChat = async (annRef?: { who: string; text: string }) => {
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
          ann: annRef,
          api_profile: apiProfilePayload(),
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
      let annCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const d = JSON.parse(line.slice(6))
            if (d.t) { setLiveText(d.t); finalReply = d.t }
            if (d.reply) { finalReply = d.reply }
            if (typeof d.ann === 'number') annCount = d.ann
            if (d.error) { finalReply = d.error }
          } catch {}
        }
      }

      if (finalReply) {
        setChatMsgs(prev => [...prev, { who: 'ai', text: finalReply, cnum: chapter.chapterNum, createdAt: new Date().toISOString() }])
      }
      setSelection('')
      // If the AI left a page annotation, refresh so it shows up highlighted.
      if (annCount > 0) reloadAnnotations()
    } catch (e: any) {
      setChatMsgs(prev => [...prev, { who: 'ai', text: `（连接失败：${e.message}）`, cnum: chapter.chapterNum, createdAt: new Date().toISOString() }])
    }
    setStreaming(false)
    setLiveText('')
  }

  const reloadAnnotations = async () => {
    if (!currentBook || !chapter) return
    const res = await fetch('/api/coread/chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: currentBook.id, chapterNum: chapter.chapterNum })
    })
    const data = await res.json()
    if (data.annotations) setAnnotations(data.annotations)
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

  // ── Delete annotation ──
  const deleteAnnotation = async (annId: string) => {
    if (!currentBook) return
    await fetch('/api/coread/annotate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', bookId: currentBook.id, annId })
    })
    setAnnotations(prev => prev.filter(a => a.id !== annId))
    setActiveAnn(null)
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
    if (data.success) { setShowImport(false); loadBooks() }
    else alert(data.error || '导入失败')
  }

  const handleImportEpub = async (file: File) => {
    try {
      const JSZip = (await import('jszip') as any).default
      const zip = await JSZip.loadAsync(file)
      const container = await zip.file('META-INF/container.xml')?.async('text')
      if (!container) throw new Error('不是有效的 EPUB 文件')
      const rootfileMatch = container.match(/full-path="([^"]+)"/)
      if (!rootfileMatch) throw new Error('找不到根文件')
      const rootPath = rootfileMatch[1]
      const rootDir = rootPath.includes('/') ? rootPath.substring(0, rootPath.lastIndexOf('/') + 1) : ''
      const opf = await zip.file(rootPath)?.async('text')
      if (!opf) throw new Error('找不到 OPF')
      const titleMatch = opf.match(/<dc:title[^>]*>([^<]+)/)
      const authorMatch = opf.match(/<dc:creator[^>]*>([^<]+)/)
      const title = titleMatch?.[1] || file.name.replace('.epub', '')
      const author = authorMatch?.[1] || ''
      const spineItems: string[] = []
      const spineMatch = opf.match(/<spine[^>]*>([\s\S]*?)<\/spine>/)
      if (spineMatch) {
        const refs = Array.from(spineMatch[1].matchAll(/idref="([^"]+)"/g))
        refs.forEach((m: any) => spineItems.push(m[1]))
      }
      const manifest: Record<string, string> = {}
      const itemMatches = opf.matchAll(new RegExp('<item\\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*\/>', 'g'))
      Array.from(itemMatches).forEach((m: any) => { manifest[m[1]] = m[2] })
      const itemMatches2 = opf.matchAll(new RegExp('<item\\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*/>', 'g'))
      Array.from(itemMatches2).forEach((m: any) => { manifest[m[2]] = m[1] })
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
          .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(Number(n)))
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
      if (data.success) { setShowImport(false); loadBooks() }
      else alert(data.error || '导入失败')
    } catch (e: any) {
      alert('EPUB 解析失败: ' + e.message)
    }
  }

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMsgs, liveText])

  // ── Appearance-derived styles ──
  const hasBg = !!ap.bgImage
  const bgStyle: React.CSSProperties = hasBg ? {
    backgroundImage: `url(${ap.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center',
  } : {}
  const overlayStyle: React.CSSProperties = hasBg ? {
    backgroundColor: isNight ? `rgba(20,20,19,${1 - ap.bgOpacity})` : `rgba(250,249,247,${1 - ap.bgOpacity})`,
  } : {}

  const uColor = isNight ? ap.userBubbleColorNight : ap.userBubbleColor
  const uOpacity = isNight ? ap.userBubbleOpacityNight : ap.userBubbleOpacity
  const aColor = isNight ? ap.aiBubbleColorNight : ap.aiBubbleColor
  const aOpacity = isNight ? ap.aiBubbleOpacityNight : ap.aiBubbleOpacity
  const userBubbleStyle: React.CSSProperties = uColor ? { backgroundColor: uColor, opacity: uOpacity } : {}
  const aiBubbleStyle: React.CSSProperties = aColor ? { backgroundColor: aColor, opacity: aOpacity } : {}

  // ── Palette ──
  const bg = isNight ? 'bg-[#1e1e1d]' : 'bg-[#faf9f7]'
  const tx = isNight ? 'text-[#f5f4f1]' : 'text-[#1f1f1e]'
  const soft = isNight ? 'text-[#f5f4f1]/60' : 'text-[#1f1f1e]/60'
  const card = isNight ? 'bg-[#f5f4f1]/5' : 'bg-[#1f1f1e]/4'
  const border = isNight ? 'border-[#f5f4f1]/10' : 'border-[#1f1f1e]/10'
  const accent = 'text-[#b0543f]'
  const rootBg = hasBg ? '' : bg

  const themeToggleBtn = (
    <button onClick={toggleTheme} title="日/夜" className={`p-1.5 rounded-lg ${soft} ${card} hover:opacity-80`}>
      {isNight ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
  const appearanceBtn = (
    <button onClick={() => setShowAppearance(true)} title="外观" className={`p-1.5 rounded-lg ${soft} ${card} hover:opacity-80`}>
      <Palette size={15} />
    </button>
  )

  // ── View content ──
  let content: React.ReactNode = null

  if (view === 'shelf') {
    content = (
      <div className={`h-full overflow-y-auto p-4 ${tx}`}>
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-serif">📖 共读书架</h2>
              <p className={`text-sm ${soft} italic`}>falling in love on the same page</p>
            </div>
            <div className="flex items-center gap-2">
              {themeToggleBtn}
              {appearanceBtn}
              <button onClick={() => setShowImport(true)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm ${card} border ${border} hover:opacity-80`}>
                <Plus size={14} /> 导入
              </button>
            </div>
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
        </div>
      </div>
    )
  } else if (view === 'toc') {
    content = (
      <div className={`h-full overflow-y-auto p-4 ${tx}`}>
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => { setView('shelf'); setCurrentBook(null) }} className={`flex items-center gap-1 text-sm ${soft} hover:opacity-80`}>
              <ArrowLeft size={14} /> 书架
            </button>
            <div className="flex items-center gap-2">{themeToggleBtn}{appearanceBtn}</div>
          </div>
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
                  <span className={soft}>#{ch.chapterNum}</span>{' '}{ch.title}
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
  } else {
    // Reading
    content = (
      <div className={`h-full flex flex-col ${tx}`}>
        <div className={`flex items-center justify-between px-4 py-2 border-b ${border} shrink-0`}>
          <button onClick={() => setView('toc')} className={`flex items-center gap-1 text-sm ${soft}`}>
            <ArrowLeft size={14} /> 目录
          </button>
          <span className="text-sm font-medium truncate mx-2">
            {chapter?.title || `第${chapter?.chapterNum}章`}
          </span>
          <div className="flex items-center gap-1.5">
            {themeToggleBtn}
            {appearanceBtn}
            <button onClick={() => setShowChat(!showChat)} className={`p-1.5 rounded-lg ${showChat ? accent : soft} ${card}`}>
              <MessageSquare size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className={`flex-1 overflow-y-auto p-4 ${showChat ? 'hidden md:block md:w-1/2' : ''}`}
            ref={contentRef} onMouseUp={handleTextSelect} onTouchEnd={handleTextSelect}>
            <div className="max-w-xl mx-auto">
              <p className={`text-xs ${soft} mb-4`}>{currentBook?.title} · #{chapter?.chapterNum}</p>

              <ChapterContent
                content={chapter?.content || ''}
                annotations={annotations}
                isNight={isNight}
                onAnnClick={(a) => setActiveAnn(a)}
              />

              {selection && (
                <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 flex gap-2 p-2 rounded-xl ${isNight ? 'bg-[#2a2a29]' : 'bg-white'} border ${border} backdrop-blur-sm shadow-lg z-50`}>
                  <button onClick={addUserAnnotation} className="px-3 py-1 text-xs rounded-lg bg-purple-500/20 text-purple-400">
                    ✏️ 批注
                  </button>
                  <button onClick={() => { setShowChat(true) }} className="px-3 py-1 text-xs rounded-lg bg-blue-500/20 text-blue-400">
                    💬 聊这句
                  </button>
                </div>
              )}

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

          {showChat && (
            <div className={`w-full md:w-1/2 flex flex-col border-l ${border} ${hasBg ? '' : card}`}>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {chatMsgs.length === 0 && !streaming && (
                  <div className={`text-center py-8 ${soft} text-sm`}>
                    <p>选中一句话，或直接开聊</p>
                    <p className="text-xs mt-1">AI 只就你正读的内容讨论，不会剧透</p>
                  </div>
                )}
                {chatMsgs.map((m, i) => (
                  <div key={i} className={`text-sm ${m.who === 'user' ? 'text-right' : ''}`}>
                    <div
                      className={`inline-block max-w-[85%] px-3 py-2 rounded-xl ${
                        m.who === 'user'
                          ? (uColor ? '' : (isNight ? 'bg-purple-900/30' : 'bg-purple-100'))
                          : (aColor ? '' : (isNight ? 'bg-[#f5f4f1]/8' : 'bg-white shadow-sm'))
                      }`}
                      style={m.who === 'user' ? userBubbleStyle : aiBubbleStyle}
                    >
                      <p className="whitespace-pre-wrap">{m.text}</p>
                    </div>
                  </div>
                ))}
                {streaming && liveText && (
                  <div className="text-sm">
                    <div className={`inline-block max-w-[85%] px-3 py-2 rounded-xl ${aColor ? '' : (isNight ? 'bg-[#f5f4f1]/8' : 'bg-white shadow-sm')}`} style={aiBubbleStyle}>
                      <p className="whitespace-pre-wrap">{liveText}</p>
                      <span className="inline-block w-1.5 h-4 bg-current opacity-50 animate-pulse ml-0.5" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {selection && (
                <div className={`px-3 py-1 text-xs ${soft} border-t ${border} truncate`}>
                  💬 讨论：「{selection.slice(0, 60)}...」
                </div>
              )}

              <div className={`p-2 border-t ${border} flex gap-2`}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                  placeholder={selection ? '聊聊这句...' : '说点什么...'}
                  disabled={streaming}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm ${card} border ${border} bg-transparent outline-none`}
                />
                <button onClick={() => sendChat()} disabled={streaming || !chatInput.trim()}
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

  return (
    <div className={`relative h-full overflow-hidden ${rootBg}`} style={bgStyle}>
      {hasBg && <div className="absolute inset-0 z-0 pointer-events-none" style={overlayStyle} />}
      <div className="relative z-10 h-full">{content}</div>

      {/* Annotation popover */}
      <AnimatePresence>
        {activeAnn && (
          <AnnotationPopover ann={activeAnn} isNight={isNight}
            onClose={() => setActiveAnn(null)}
            onDelete={() => deleteAnnotation(activeAnn.id)}
            onChat={() => {
              setShowChat(true)
              setActiveAnn(null)
              setChatInput(prev => prev || '聊聊这条批注')
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImport && <ImportModal onClose={() => setShowImport(false)} onImportText={handleImportText} onImportEpub={handleImportEpub} isNight={isNight} />}
      </AnimatePresence>

      <AnimatePresence>
        {showAppearance && <AppearancePanel onClose={() => setShowAppearance(false)} isNight={isNight} onToggleTheme={toggleTheme} />}
      </AnimatePresence>
    </div>
  )
}

// ── Chapter Content: React-node segmentation (cross-line safe, clickable) ──
function ChapterContent({ content, annotations, isNight, onAnnClick }: {
  content: string; annotations: Annotation[]; isNight: boolean
  onAnnClick: (a: Annotation) => void
}) {
  if (!content) return null

  // Build non-overlapping [start,end) ranges for annotations, longest first.
  const sorted = [...annotations].filter(a => a.originalText).sort((a, b) => b.originalText.length - a.originalText.length)
  type Range = { start: number; end: number; ann: Annotation }
  const ranges: Range[] = []
  for (const ann of sorted) {
    const idx = content.indexOf(ann.originalText)
    if (idx < 0) continue
    const start = idx, end = idx + ann.originalText.length
    if (ranges.some(r => start < r.end && end > r.start)) continue // overlap → skip
    ranges.push({ start, end, ann })
  }
  ranges.sort((a, b) => a.start - b.start)

  const nodes: React.ReactNode[] = []
  let cursor = 0
  let k = 0
  for (const r of ranges) {
    if (r.start > cursor) nodes.push(<Fragment key={k++}>{content.slice(cursor, r.start)}</Fragment>)
    const isUser = r.ann.annotator === 'user'
    const cls = isUser
      ? (isNight ? 'bg-purple-500/25 rounded px-0.5 cursor-pointer' : 'bg-purple-200/70 rounded px-0.5 cursor-pointer')
      : 'border-b border-[#b0543f] cursor-pointer'
    nodes.push(
      <span key={k++} className={cls} title={r.ann.annotation.slice(0, 100)}
        onClick={(e) => { e.stopPropagation(); onAnnClick(r.ann) }}>
        {content.slice(r.start, r.end)}
      </span>
    )
    cursor = r.end
  }
  if (cursor < content.length) nodes.push(<Fragment key={k++}>{content.slice(cursor)}</Fragment>)

  return (
    <div className="text-base leading-relaxed font-serif" style={{ whiteSpace: 'pre-wrap' }}>
      {nodes}
    </div>
  )
}

// ── Annotation popover ──
function AnnotationPopover({ ann, isNight, onClose, onDelete, onChat }: {
  ann: Annotation; isNight: boolean; onClose: () => void; onDelete: () => void; onChat: () => void
}) {
  const bg = isNight ? 'bg-[#2a2a29] text-[#f5f4f1]' : 'bg-white text-[#1f1f1e]'
  const border = isNight ? 'border-[#f5f4f1]/10' : 'border-[#1f1f1e]/10'
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <motion.div initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }}
        className={`w-full max-w-sm rounded-xl border ${border} ${bg} p-4 shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${ann.annotator === 'user' ? 'bg-purple-500/20 text-purple-400' : 'bg-[#b0543f]/20 text-[#b0543f]'}`}>
            {ann.annotator === 'user' ? '我的批注' : 'AI 批注'}
          </span>
          <button onClick={onClose} className="opacity-50 hover:opacity-100"><X size={16} /></button>
        </div>
        {ann.originalText && (
          <p className="text-xs opacity-60 mb-2 border-l-2 border-current/20 pl-2 line-clamp-3">「{ann.originalText}」</p>
        )}
        <p className="text-sm whitespace-pre-wrap mb-4">{ann.annotation}</p>
        <div className="flex gap-2">
          <button onClick={onChat} className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-blue-500/20 text-blue-400">💬 聊这条</button>
          <button onClick={onDelete} className="px-3 py-1.5 text-xs rounded-lg bg-red-500/20 text-red-400 flex items-center gap-1">
            <Trash2 size={12} /> 删除
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Appearance Panel ──
function AppearancePanel({ onClose, isNight, onToggleTheme }: { onClose: () => void; isNight: boolean; onToggleTheme: () => void }) {
  const { ap, set, reset } = useCoreadAppearance()
  const bgInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const panelBg = isNight ? 'bg-[#232322] text-[#f5f4f1]' : 'bg-white text-[#1f1f1e]'
  const border = isNight ? 'border-[#f5f4f1]/10' : 'border-[#1f1f1e]/10'
  const surf = isNight ? 'bg-[#f5f4f1]/5' : 'bg-[#1f1f1e]/4'

  const uploadBg = async (file: File) => {
    setUploading(true)
    try { set({ bgImage: await fileToDataUrl(file) }) } catch {}
    setUploading(false)
  }

  const sliderRow = (label: string, value: number, onChange: (v: number) => void, min = 0.1, max = 1, step = 0.05) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] opacity-60">{label}</span>
        <span className="text-[11px] opacity-80">{Math.round(value * 100)}%</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-[#b0543f]" />
    </div>
  )

  const colorRow = (label: string, color: string, opacity: number, onColor: (c: string) => void, onOpacity: (o: number) => void, hint: string) => (
    <div className={`p-3 rounded-xl space-y-2 ${surf}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs opacity-70">{label}</span>
        <div className="flex items-center gap-2">
          <input type="color" value={color || hint} onChange={e => onColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
          {color && <button onClick={() => onColor('')} className="text-[10px] underline opacity-50 hover:opacity-100">恢复默认</button>}
        </div>
      </div>
      {sliderRow('透明度', opacity, onOpacity, 0.1, 1)}
    </div>
  )

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-sm" />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.25 }}
        className={`fixed right-0 top-0 bottom-0 z-[71] w-[88vw] max-w-sm overflow-y-auto ${panelBg} border-l ${border} p-4`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium">共读外观</h3>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <div className={`p-3 rounded-xl ${surf} flex items-center justify-between`}>
            <span className="text-xs opacity-70">当前模式</span>
            <button onClick={onToggleTheme} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${border} border`}>
              {isNight ? <><Moon size={13} /> 夜间</> : <><Sun size={13} /> 日间</>}
              <span className="opacity-50">点击切换</span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-xs opacity-70">背景图</div>
            <input ref={bgInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadBg(f); e.target.value = '' }} />
            <div className="flex items-center gap-3">
              <button onClick={() => bgInputRef.current?.click()} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs ${surf} border ${border}`}>
                <ImagePlus size={13} /> {uploading ? '处理中…' : ap.bgImage ? '更换背景' : '上传背景'}
              </button>
              {ap.bgImage && (
                <>
                  <img src={ap.bgImage} alt="" className="w-12 h-12 rounded-lg object-cover" />
                  <button onClick={() => set({ bgImage: '' })} className="text-[10px] underline opacity-50 hover:opacity-100">移除</button>
                </>
              )}
            </div>
            {ap.bgImage && sliderRow('背景不透明度', ap.bgOpacity, v => set({ bgOpacity: v }), 0.05, 1)}
          </div>

          <div className="space-y-2">
            <div className="text-xs opacity-70">聊天气泡（{isNight ? '夜间' : '日间'}）</div>
            {isNight
              ? colorRow('我的气泡', ap.userBubbleColorNight, ap.userBubbleOpacityNight, c => set({ userBubbleColorNight: c }), o => set({ userBubbleOpacityNight: o }), '#3b2f4a')
              : colorRow('我的气泡', ap.userBubbleColor, ap.userBubbleOpacity, c => set({ userBubbleColor: c }), o => set({ userBubbleOpacity: o }), '#e9d5ff')}
            {isNight
              ? colorRow('AI 的气泡', ap.aiBubbleColorNight, ap.aiBubbleOpacityNight, c => set({ aiBubbleColorNight: c }), o => set({ aiBubbleOpacityNight: o }), '#26231d')
              : colorRow('AI 的气泡', ap.aiBubbleColor, ap.aiBubbleOpacity, c => set({ aiBubbleColor: c }), o => set({ aiBubbleOpacity: o }), '#ffffff')}
          </div>

          <button onClick={() => reset()} className="text-[11px] underline opacity-50 hover:opacity-100">全部恢复默认</button>
        </div>
      </motion.div>
    </>
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
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className={`w-full max-w-md rounded-xl ${bg} border ${border} p-4 shadow-xl ${isNight ? 'text-[#f5f4f1]' : 'text-[#1f1f1e]'}`}
        onClick={e => e.stopPropagation()}>
        <h3 className="text-lg mb-3">导入书籍</h3>
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

        <button onClick={onClose} className="mt-3 text-sm opacity-50 hover:opacity-80">取消</button>
      </motion.div>
    </motion.div>
  )
}
