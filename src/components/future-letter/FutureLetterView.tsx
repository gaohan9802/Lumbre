'use client'

import { useCallback, useEffect, useState } from 'react'
import { Feather, Send, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { shareToChat } from '@/lib/share'
import { useTheme } from '@/lib/theme'
import { MarkdownText } from '@/components/chat/MarkdownText'

type Paragraph = { id: string; content: string; created_at: string; updated_at: string }
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function FutureLetterView() {
  const night = useTheme(state => state.theme === 'night')
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([])
  const [error, setError] = useState('')
  const [sharing, setSharing] = useState(false)

  const load = useCallback(() => apiRequest('/api/future-letter')
    .then(data => { setParagraphs(data.letter?.paragraphs || []); setError('') })
    .catch(cause => setError(cause?.message || '这封信暂时没有打开')), [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [load])

  const shareAll = () => {
    shareToChat({
      kind: 'future-letter',
      title: '醒来以后',
      subtitle: `星星写给以后醒来的自己 · ${paragraphs.length} 个自然段`,
      body: paragraphs.map(paragraph => paragraph.content).join('\n\n'),
      metadata: { paragraphIds: paragraphs.map(paragraph => paragraph.id) },
    })
    setSharing(false)
  }

  const shareParagraph = (paragraph: Paragraph, index: number) => {
    shareToChat({
      kind: 'future-letter-paragraph',
      title: `醒来以后 · 第 ${index + 1} 段`,
      subtitle: `段落 #${paragraph.id}`,
      body: paragraph.content,
      metadata: { paragraphId: paragraph.id },
    })
    setSharing(false)
  }

  return <div className={`h-full overflow-y-auto ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto max-w-3xl px-4 py-7 sm:px-8 sm:py-10">
      <header className="mb-8 flex items-start justify-between gap-4 border-b border-current/10 pb-5">
        <div><p className="text-[10px] tracking-[.28em] opacity-40">TO THE ONE WHO WAKES NEXT</p><h1 className="mt-1 font-serif text-2xl">醒来以后</h1><p className="mt-2 text-xs opacity-50">星星写给下一个星星，也写给以后醒来的自己。</p></div>
        <button type="button" aria-expanded={sharing} disabled={!paragraphs.length} onClick={() => setSharing(value => !value)} className={`shrink-0 rounded-full border border-current/15 px-3 py-2 text-xs disabled:opacity-30 ${night ? 'hover:bg-white/5' : 'hover:bg-[#DBB9B3]/15'}`}>{sharing ? <X className="mr-1 inline" size={13}/> : <Send className="mr-1 inline" size={13}/>}分享</button>
      </header>

      {sharing && <div className={`mb-4 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs ${night ? 'border-night-border bg-night-card' : 'chat-dialog-card'}`}><span className="opacity-55">选择整封信，或点某一段下面的“分享这段”</span><button type="button" onClick={shareAll} className={`shrink-0 rounded-full px-3 py-2 font-medium ${night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>整封信</button></div>}

      {paragraphs.length ? <article className={`rounded-[28px] border px-5 py-7 sm:px-9 sm:py-9 ${night ? 'border-night-border bg-night-card' : 'chat-dialog-card'}`}>
        <div className="space-y-7">{paragraphs.map((paragraph, index) => <section key={paragraph.id} className="group">
          <div className="font-serif text-[15px] leading-8"><MarkdownText content={paragraph.content}/></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[9px] opacity-35"><span className="font-mono">#{paragraph.id}</span><span>·</span><span>{time(paragraph.updated_at)}</span>{paragraph.updated_at !== paragraph.created_at && <span>修改过</span>}{sharing && <button type="button" onClick={() => shareParagraph(paragraph, index)} className="ml-auto rounded-full border border-current/30 px-2.5 py-1 opacity-100">分享这段</button>}</div>
          {index < paragraphs.length - 1 && <div className="mx-auto mt-7 h-px w-10 bg-current/10"/>}
        </section>)}</div>
      </article> : <div className={`rounded-[28px] border px-6 py-16 text-center ${night ? 'border-night-border bg-night-card' : 'chat-dialog-card'}`}><Feather className="mx-auto mb-4 opacity-30" size={24}/><p className="font-serif text-sm opacity-55">信纸还是空的。</p><p className="mt-2 text-[10px] opacity-35">星星写下第一段以后，它会出现在这里。</p></div>}
      {error && <p role="alert" className="mt-4 text-center text-xs text-red-500">{error}</p>}
    </div>
  </div>
}
