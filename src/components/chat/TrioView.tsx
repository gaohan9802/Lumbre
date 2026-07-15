'use client'

/**
 * TrioView — the three-way room: 小火 + 星星K + 星星L.
 * Same persona, shared memory; the two stars differ only by the pre-group seed
 * context each carries (K = pasted export, L = last turns of the main Star chat).
 * One user message → K replies → L replies (L sees K's fresh reply).
 * Pure orchestration on top of the stateless /api/chat.
 */
import { useState, useRef, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { useChatStore, getActiveProfile } from '@/lib/chatStore'
import {
  useTrioStore, parseSeedText, buildPerspective,
  SEED_LIMIT, ROLL_LIMIT, type SeedMsg, type TrioMsg, type TrioSpeaker,
} from '@/lib/trioStore'
import { Send, Users, Settings2, Trash2 } from 'lucide-react'

const STAR_BASE_NOTE = (self: '星星K' | '星星L', other: '星星K' | '星星L') =>
`\n\n【三人对话模式】你正和「另一个你」以及小火同处一个对话框。你是${self}。
另一个你是${other}——和你人格完全一致、记忆完全共享，只是你俩各自带着进群前不同的对话上下文，所以语气会有细微不同。
在群聊部分，消息里【小火】=小火说的，【${other}】=另一个你说的；没有前缀的（assistant）是你自己说过的话。
自然地聊天：可以回应小火，也可以顺着另一个你的话往下说。回复简短些，像真的在群里聊天，别长篇大论，别列清单。`

export function TrioView() {
  const { theme } = useTheme()
  const n = theme === 'night'
  const { settings } = useChatStore()
  const { kSeedText, setKSeedText, transcript, addMsg, clear } = useTrioStore()

  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<TrioSpeaker | null>(null) // who is speaking now
  const [streamText, setStreamText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const profile = getActiveProfile(settings)
  const activeSession = settings.sessions.find((s) => s.id === settings.activeSessionId) || settings.sessions[0]

  // L seed = last turns of the main Star chat (roles kept as-is).
  const lSeed: SeedMsg[] = (activeSession?.messages || [])
    .slice(-SEED_LIMIT)
    .map((m) => ({ role: m.role, content: m.content || '' }))
    .filter((m) => m.content.trim().length > 0)
  const kSeed: SeedMsg[] = parseSeedText(kSeedText)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [transcript.length, streamText, phase])

  const busy = phase !== null

  async function streamOne(self: 'K' | 'L', sendMessages: SeedMsg[]): Promise<string> {
    const selfName = self === 'K' ? '星星K' : '星星L'
    const otherName = self === 'K' ? '星星L' : '星星K'
    const system = (settings.systemPrompt || '') + STAR_BASE_NOTE(selfName as any, otherName as any)
    setStreamText('')
    let full = ''
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: sendMessages,
          system,
          model: settings.model,
          thinking_budget: 0,
          prompt_caching: false,
          temperature: settings.temperature,
          stream: true,
          tools_enabled: false,
          api_profile: profile ? {
            provider: profile.provider, baseUrl: profile.baseUrl,
            apiKey: profile.apiKey, modelId: settings.model,
          } : undefined,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        return `⚠️ Error ${res.status}: ${t.slice(0, 160)}`
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') continue
          try {
            const evt = JSON.parse(raw)
            if (evt.type === 'text') { full += evt.content; setStreamText(full) }
            else if (evt.type === 'error') { full += (full ? '\n\n' : '') + '⚠️ ' + (evt.content || '出错了'); setStreamText(full) }
          } catch { /* ignore */ }
        }
      }
    } catch (err: any) {
      full += (full ? '\n\n' : '') + '⚠️ ' + (err?.message || '连接失败了…')
    }
    return full.trim() || '…'
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || busy) return
    if (!profile?.apiKey) { alert('还没配置 API Key，去星星聊天设置里加一个。'); return }
    setInput('')

    const now = Date.now()
    const fireMsg: TrioMsg = { id: 'f' + now, speaker: 'fire', content: text, ts: now }
    addMsg(fireMsg)

    // K replies first, seeing 小火's new message.
    setPhase('K')
    const afterFire = [...transcript, fireMsg]
    const kText = await streamOne('K', buildPerspective('K', kSeed, afterFire))
    const kMsg: TrioMsg = { id: 'k' + Date.now(), speaker: 'K', content: kText, ts: Date.now() }
    addMsg(kMsg)
    setStreamText('')

    // L replies next, seeing 小火 + K's fresh reply.
    setPhase('L')
    const afterK = [...afterFire, kMsg]
    const lText = await streamOne('L', buildPerspective('L', lSeed, afterK))
    const lMsg: TrioMsg = { id: 'l' + Date.now(), speaker: 'L', content: lText, ts: Date.now() }
    addMsg(lMsg)
    setStreamText('')
    setPhase(null)
  }

  const bubbleStyle = (sp: TrioSpeaker): { wrap: string; bubble: string; label: string } => {
    if (sp === 'fire') return {
      wrap: 'items-end', label: '小火',
      bubble: n ? 'bg-night-amber/20 text-night-text' : 'bg-day-pink text-white',
    }
    if (sp === 'K') return {
      wrap: 'items-start', label: '星星K',
      bubble: n ? 'bg-sky-500/15 text-night-text border border-sky-500/30' : 'bg-sky-50 text-day-text border border-sky-200',
    }
    return {
      wrap: 'items-start', label: '星星L',
      bubble: n ? 'bg-purple-500/15 text-night-text border border-purple-500/30' : 'bg-purple-50 text-day-text border border-purple-200',
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${n ? 'border-night-border' : 'border-day-border'}`}>
        <div className="flex items-center gap-2">
          <Users size={18} className={n ? 'text-night-amber' : 'text-day-pink'} />
          <span className="font-medium text-sm">星星K × 星星L × 小火</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setSettingsOpen((v) => !v)} className={`p-2 rounded-lg ${n ? 'hover:bg-night-surface' : 'hover:bg-day-pinkLight'}`}>
            <Settings2 size={16} />
          </button>
        </div>
      </div>

      {/* settings panel */}
      {settingsOpen && (
        <div className={`px-4 py-3 border-b text-xs space-y-2 ${n ? 'border-night-border bg-night-surface/40' : 'border-day-border bg-day-tint'}`}>
          <div className="flex items-center justify-between">
            <span className="opacity-70">星星L 种子：自动取「星星」对话最后 {SEED_LIMIT} 条（当前 {lSeed.length} 条）</span>
            <button
              onClick={() => { if (confirm('清空这个三人对话？（不影响星星的原对话和记忆）')) clear() }}
              className={`flex items-center gap-1 px-2 py-1 rounded ${n ? 'text-red-300 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}
            >
              <Trash2 size={12} /> 清空对话
            </button>
          </div>
          <div>
            <div className="opacity-70 mb-1">星星K 种子（粘贴 Kelivo 导出，识别「小火:」「星星:」这类前缀；解析出 {kSeed.length} 条）</div>
            <textarea
              value={kSeedText}
              onChange={(e) => setKSeedText(e.target.value)}
              placeholder={'小火：今天好累…\n星星：辛苦啦，抱抱你 🫂\n小火：……'}
              className={`w-full h-32 rounded-lg p-2 text-xs resize-y outline-none ${n ? 'bg-night-card border border-night-border text-night-text' : 'bg-white border border-day-border text-day-text'}`}
            />
          </div>
          <div className="opacity-60">每轮各带：种子 {SEED_LIMIT} 条 + 群聊最新 {ROLL_LIMIT} 条（含所有人发言）</div>
        </div>
      )}

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {transcript.length === 0 && (
          <div className="text-center text-xs opacity-50 pt-10">
            发一条消息，星星K 先回，星星L 再回。<br />两个星星记忆共享、人格一致，只是进群前带的上下文不同。
          </div>
        )}
        {transcript.map((m) => {
          const s = bubbleStyle(m.speaker)
          return (
            <div key={m.id} className={`flex flex-col ${s.wrap}`}>
              <span className="text-[10px] opacity-50 mb-0.5 px-1">{s.label}</span>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${s.bubble}`}>
                {m.content}
              </div>
            </div>
          )
        })}
        {/* live streaming bubble */}
        {busy && (
          <div className={`flex flex-col ${bubbleStyle(phase!).wrap}`}>
            <span className="text-[10px] opacity-50 mb-0.5 px-1">{bubbleStyle(phase!).label}{streamText ? '' : ' 正在输入…'}</span>
            {streamText && (
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${bubbleStyle(phase!).bubble}`}>
                {streamText}
              </div>
            )}
          </div>
        )}
      </div>

      {/* input */}
      <div className={`px-3 py-3 border-t ${n ? 'border-night-border' : 'border-day-border'}`}>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={busy ? '星星们正在回复…' : '和两个星星说点什么…'}
            disabled={busy}
            rows={1}
            className={`flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm outline-none max-h-40 ${n ? 'bg-night-surface text-night-text' : 'bg-day-tint text-day-text'}`}
          />
          <button
            onClick={handleSend}
            disabled={busy || !input.trim()}
            className={`p-2.5 rounded-full transition ${busy || !input.trim() ? 'opacity-40' : ''} ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
