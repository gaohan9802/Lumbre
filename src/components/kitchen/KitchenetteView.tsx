'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

type KitchenConfig = { pageUrl: string; credential: string; who: string }

export function KitchenetteView({ onClose }: { onClose?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [config, setConfig] = useState<KitchenConfig | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const origin = useMemo(() => {
    try { return config ? new URL(config.pageUrl).origin : '' } catch { return '' }
  }, [config])

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setConfig(null)
    fetch('/api/kitchenette', { cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || '小厨房暂时打不开')
      if (active) setConfig(data)
    }).catch(reason => { if (active) { setError(reason instanceof Error ? reason.message : '小厨房暂时打不开'); setLoading(false) } })
    return () => { active = false }
  }, [reload])

  useEffect(() => {
    if (!config || !origin) return
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || event.data?.v !== 1) return
      if (event.data.type === 'ready') {
        frame.current?.contentWindow?.postMessage({
          v: 1, id: 'lumbre-init', type: 'init',
          payload: { credential: config.credential, who: config.who, apiBase: config.pageUrl },
        }, origin)
      } else if (event.data.id === 'lumbre-init') {
        if (event.data.ok) { setLoading(false); setError('') }
        else { setLoading(false); setError(String(event.data.error || '小厨房没有接受连接')) }
      } else if (event.data.type === 'close') onClose?.()
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [config, onClose, origin])

  const src = config && origin
    ? `${origin}/page/?host=${encodeURIComponent(window.location.origin)}`
    : ''

  return <div className="relative h-full min-h-0 bg-[#f4eee5]">
    {src && <iframe
      ref={frame}
      key={`${src}:${reload}`}
      title="小厨房"
      src={src}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      className="h-full w-full border-0"
    />}
    {(loading || error) && <div className="absolute inset-0 grid place-items-center bg-[#f4eee5]/95 px-6 text-center text-[#4b3a32]">
      <div>{loading && !error ? <><Loader2 className="mx-auto animate-spin opacity-45" size={22}/><p className="mt-3 text-xs opacity-55">正在推开厨房门…</p></> : <><p className="text-sm">{error}</p><button type="button" onClick={() => setReload(value => value + 1)} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-current/15 px-4 py-2 text-xs"><RefreshCw size={13}/>重试</button></>}</div>
    </div>}
  </div>
}
