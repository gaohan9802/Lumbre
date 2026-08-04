'use client'

import { useSyncStatus } from '@/lib/syncStatus'

function ago(ts: number) {
  if (!ts) return '尚未同步'
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 10) return '刚刚已同步'
  if (sec < 60) return `${sec}秒前同步`
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前同步`
  return `${Math.floor(sec / 3600)}小时前同步`
}

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const { phase, lastSyncedAt, error, retry } = useSyncStatus()
  const label = phase === 'syncing' ? '正在同步'
    : phase === 'offline' ? '离线 · 本地可用'
    : phase === 'error' ? (error || '同步失败')
    : ago(lastSyncedAt)
  const dot = phase === 'syncing' ? 'bg-night-info animate-pulse'
    : phase === 'offline' ? 'bg-night-warning'
    : phase === 'error' ? 'bg-night-error'
    : 'bg-night-success'
  return (
    <button type="button" onClick={phase === 'error' || phase === 'offline' ? retry : undefined}
      title={phase === 'error' || phase === 'offline' ? `${label}，点击重试` : label}
      className="flex items-center gap-1.5 text-[10px] opacity-55 hover:opacity-90 transition max-w-[130px]">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {!compact && <span className="truncate">{label}</span>}
    </button>
  )
}
