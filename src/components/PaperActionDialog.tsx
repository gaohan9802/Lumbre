'use client'

import type { ReactNode } from 'react'
import { useTheme } from '@/lib/theme'

export function PaperActionDialog({
  open,
  title,
  children,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}) {
  const night = useTheme(state => state.theme === 'night')
  if (!open) return null

  return <>
    <button type="button" aria-label="关闭弹窗" className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-sm" onClick={onClose}/>
    <form
      role="dialog"
      aria-modal="true"
      aria-labelledby="paper-action-title"
      className={`fixed left-1/2 top-1/2 z-[121] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-5 shadow-2xl ${night ? 'border border-night-border bg-night-surface text-night-text' : 'chat-dialog text-[#3f2c29]'}`}
      onSubmit={event => { event.preventDefault(); void onConfirm() }}
    >
      <h3 id="paper-action-title" className="font-serif text-lg">{title}</h3>
      {children && <div className="mt-4">{children}</div>}
      <div className="mt-5 flex gap-2 text-xs">
        <button type="button" onClick={onClose} className={`flex-1 rounded-xl py-2.5 ${night ? 'bg-night-card' : 'bg-[#DBB9B3]/15'}`}>{cancelLabel}</button>
        <button type="submit" disabled={busy} className={`flex-1 rounded-xl py-2.5 disabled:opacity-35 ${danger ? 'bg-red-500/85 text-white' : night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>{confirmLabel}</button>
      </div>
    </form>
  </>
}
