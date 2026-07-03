'use client'

import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { useWeather, weatherEmoji } from '@/lib/useWeather'
import { Menu } from 'lucide-react'

export function TopBar() {
  const { toggleSidebar, activeTab } = useApp()
  const { theme } = useTheme()
  const weather = useWeather()

  const titles: Record<string, string> = {
    chat: '🐆 星星',
    diary: '📔 日记',
    notes: '📌 小纸条',
    todo: '🧾 待办',
    photos: '📷 照片',
    calendar: '📅 日历',
    memory: '✨ 记忆',
    health: '❤️ 健康',
    coreading: '📖 阅读',
    knit: '🧶 编织',
    recipes: '🍳 食谱',
    dashboard: '💰 Usage',
  }

  return (
    <header
      className={`
        sticky top-0 z-30 px-4 py-3
        flex items-center justify-between gap-2
        ${theme === 'night'
          ? 'bg-night-bg/80 border-night-border'
          : 'bg-white/80 border-day-border'
        }
        border-b backdrop-blur-md
        md:hidden
      `}
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <button onClick={toggleSidebar} className="p-2 -m-1 flex-shrink-0">
        <Menu size={22} />
      </button>
      <span className="text-sm font-medium truncate">{titles[activeTab] || 'Lumbre'}</span>
      <span className={`text-[10px] flex-shrink-0 ${theme === 'night' ? 'text-night-muted' : 'text-day-muted'}`}>
        {weather
          ? `${weatherEmoji(weather.code)} ${weather.temp != null ? Math.round(weather.temp) + '°' : ''}${weather.city ? ' ' + weather.city : ''}`
          : '🦦'}
      </span>
    </header>
  )
}
