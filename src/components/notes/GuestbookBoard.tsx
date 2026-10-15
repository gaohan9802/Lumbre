'use client'

import { useEffect, useState } from 'react'
import { Send, Share2, Trash2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { formatMadridShort } from '@/lib/madrid-time'
import { shareToChat } from '@/lib/share'
import { useTheme } from '@/lib/theme'
import { PaperActionDialog } from '@/components/PaperActionDialog'

type Actor = 'fire' | 'star' | 'guest'
interface Reply { id: string; author: Actor; content: string; created_at: string; reply_to?: string; reply_to_author?: Actor }
interface Message extends Reply { replies: Reply[] }
interface Board { guest_name: string | null; messages: Message[] }
interface ReplyTarget { messageId: string; replyId?: string; label: string }

const EMPTY: Board = { guest_name: null, messages: [] }

export function GuestbookBoard({ actor, endpoint, onLoaded }: { actor: Actor; endpoint: string; onLoaded?: () => void }) {
  const { theme } = useTheme()
  const night = theme === 'night'
  const [board, setBoard] = useState<Board>(EMPTY)
  const [content, setContent] = useState('')
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ message_id: string; reply_id?: string } | null>(null)

  const load = async () => {
    try { setBoard(await apiRequest(endpoint)); setMessage(''); onLoaded?.() }
    catch (error: any) { setMessage(error?.message || '告状簿加载失败') }
  }

  useEffect(() => { void load() }, [endpoint])

  const submit = async (text: string, target?: ReplyTarget) => {
    if (!text.trim() || busy) return
    setBusy(true)
    setMessage('')
    try {
      await apiRequest(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, reply_to: target?.messageId, reply_to_reply: target?.replyId }),
      })
      setContent('')
      setReply('')
      setReplyingTo(null)
      await load()
    } catch (error: any) {
      setMessage(error?.message || '留言失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget || busy) return
    setBusy(true)
    setMessage('')
    try {
      await apiRequest(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ...deleteTarget }),
      })
      setDeleteTarget(null)
      await load()
    } catch (error: any) {
      setMessage(error?.message || '删除失败')
    } finally {
      setBusy(false)
    }
  }

  const name = (value: Actor) => value === 'fire' ? '小火' : value === 'star' ? '星星' : board.guest_name || '访客'
  const icon = (value: Actor) => value === 'fire' ? '🦦' : value === 'star' ? '🐆' : '🌙'
  const canDelete = (value: Actor) => actor === value
  return (
    <div className={`h-full overflow-y-auto px-4 pb-6 pt-4 ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
      <div className={`mx-auto mb-4 max-w-3xl rounded-2xl border p-3 ${night ? 'border-night-border bg-night-card/70' : 'chat-dialog-card'}`}>
        <textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          placeholder={`以${name(actor)}的身份写一张告状纸…`}
          rows={2}
          maxLength={2000}
          className="w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs opacity-45">{icon(actor)} {name(actor)}</span>
          <button disabled={busy || !content.trim()} onClick={() => void submit(content)} className={`rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-35 ${night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>
            {busy ? '贴上去…' : '贴上去'}
          </button>
        </div>
        {message && <p role="alert" className="mt-2 text-xs text-red-500">{message}</p>}
      </div>

      {board.messages.length === 0 ? (
        <div className="py-16 text-center text-sm opacity-35">第一张告状纸还没有贴上来</div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-3">
          {board.messages.map(item => (
            <article key={item.id} className={`rounded-2xl border p-4 ${night ? 'border-night-border bg-night-card/70' : 'chat-dialog-card'}`}>
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <strong className="flex items-center gap-2 font-medium"><span className={`h-1.5 w-1.5 rounded-full ${item.author === 'star' ? 'bg-[#c89f99]' : item.author === 'fire' ? 'bg-[#9caaa2]' : 'bg-[#b7a4c6]'}`}/>{icon(item.author)} {name(item.author)}</strong>
                <time className="opacity-40">{formatMadridShort(item.created_at)}</time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.content}</p>

              {item.replies.length > 0 && (
                <div className={`mt-3 space-y-2 border-t pt-3 ${night ? 'border-night-border' : 'chat-dialog-line'}`}>
                  {item.replies.map(replyItem => (
                    <div key={replyItem.id} className={`group flex gap-2 rounded-xl px-3 py-2 text-xs leading-5 ${night ? 'bg-night-bg/45' : 'bg-[#DBB9B3]/10'}`}>
                      <span>{icon(replyItem.author)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium opacity-70">{name(replyItem.author)}</span>
                          <time className="text-[9px] opacity-30">{formatMadridShort(replyItem.created_at)}</time>
                        </div>
                        {replyItem.reply_to_author && <p className="text-[10px] opacity-40">回复 {icon(replyItem.reply_to_author)} {name(replyItem.reply_to_author)}</p>}
                        <p className="whitespace-pre-wrap opacity-75">{replyItem.content}</p>
                        <div className="mt-1 flex items-center gap-2 opacity-35">
                          <button onClick={() => setReplyingTo({ messageId: item.id, replyId: replyItem.id, label: name(replyItem.author) })} className="hover:opacity-70">回复</button>
                          <button onClick={() => shareToChat({ kind: 'guestbook', title: '📌 告状簿回复', subtitle: `${icon(replyItem.author)} ${name(replyItem.author)} · ${formatMadridShort(replyItem.created_at)}`, body: replyItem.content, metadata: { ...replyItem, message_id: item.id, guest_name: board.guest_name } })} aria-label="分享到 Chat" title="分享到 Chat" className="hover:opacity-70"><Share2 size={10}/></button>
                        </div>
                      </div>
                      {canDelete(replyItem.author) && (
                        <button aria-label="删除回复" onClick={() => setDeleteTarget({ message_id: item.id, reply_id: replyItem.id })} className="self-start p-1 opacity-35 transition sm:opacity-0 sm:group-hover:opacity-35 sm:focus:opacity-60"><Trash2 size={11}/></button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className={`mt-3 flex items-center gap-3 border-t pt-3 text-[11px] ${night ? 'border-night-border' : 'chat-dialog-line'}`}>
                <button onClick={() => setReplyingTo({ messageId: item.id, label: name(item.author) })} className="opacity-45 hover:opacity-80">回复</button>
                <button onClick={() => shareToChat({ kind: 'guestbook', title: '📌 告状簿', subtitle: `${icon(item.author)} ${name(item.author)} · ${formatMadridShort(item.created_at)}`, body: item.content, metadata: { ...item, guest_name: board.guest_name } })} aria-label="分享到 Chat" title="分享到 Chat" className="opacity-35 hover:opacity-70"><Share2 size={11}/></button>
                {canDelete(item.author) && <button onClick={() => setDeleteTarget({ message_id: item.id })} className="flex items-center gap-1 opacity-35 hover:opacity-70"><Trash2 size={10}/> 撕掉</button>}
              </div>

              {replyingTo?.messageId === item.id && (
                <div className="mt-3 flex items-center gap-2">
                  <input autoFocus value={reply} onChange={event => setReply(event.target.value)} onKeyDown={event => event.key === 'Enter' && void submit(reply, replyingTo)} placeholder={`回复 ${replyingTo.label}…`} maxLength={2000} className="min-w-0 flex-1 border-b border-current bg-transparent py-1 text-xs outline-none opacity-75" />
                  <button disabled={busy || !reply.trim()} onClick={() => void submit(reply, replyingTo)} aria-label="发送回复" className="p-1 opacity-60 disabled:opacity-25"><Send size={13}/></button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <PaperActionDialog open={!!deleteTarget} title="撕掉这条留言？" confirmLabel="撕掉" danger onClose={() => setDeleteTarget(null)} onConfirm={remove}/>
    </div>
  )
}
