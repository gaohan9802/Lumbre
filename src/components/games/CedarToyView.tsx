'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Gamepad2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'

export function CedarToyView() {
  const [configured, setConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    apiRequest('/api/cedartoy/status')
      .then(data => { if (active) setConfigured(data.configured === true) })
      .catch(() => { if (active) setConfigured(false) })
    return () => { active = false }
  }, [])

  return <main className="h-full overflow-y-auto px-5 pb-8 pt-2 sm:px-8">
    <div className="mx-auto max-w-xl">
      <header className="pb-6 pt-2">
        <p className="text-[10px] tracking-[.28em] opacity-40">CEDARTOY</p>
        <h1 className="mt-1 font-serif text-2xl">小游戏</h1>
      </header>
      <section className="chat-theme-panel chat-theme-border rounded-[24px] border p-5">
        <div className="flex items-start gap-4">
          <div className="chat-theme-soft grid h-11 w-11 shrink-0 place-items-center rounded-2xl"><Gamepad2 size={20} strokeWidth={1.5}/></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">星星的游戏厅</h2>
              <span className="chat-theme-soft rounded-full px-2.5 py-1 text-[10px] opacity-70">{configured === null ? '检查中…' : configured ? '账号已连接' : '账号待绑定'}</span>
            </div>
            <p className="mt-2 text-xs leading-6 opacity-55">星星可以在聊天里挑游戏、看玩法、玩一回合；接好账号后会保留存档。</p>
          </div>
        </div>
        <a href="https://toy.cedarstar.org/" target="_blank" rel="noreferrer" className="chat-theme-accent-bg mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium text-[#3f2c29]">
          打开 CedarToy <ExternalLink size={14}/>
        </a>
      </section>
    </div>
  </main>
}
