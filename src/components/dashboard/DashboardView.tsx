'use client'

import { useState, useEffect, useRef } from 'react'
import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'

interface UsageStats {
  today: { calls: number; inputTokens: number; outputTokens: number; cost: number }
  week: { calls: number; inputTokens: number; outputTokens: number; cost: number }
  dailyBreakdown: { date: string; calls: number; tokens: number }[]
  memoryStats: { total: number; pinned: number; domains: Record<string, number> }
}

export function DashboardView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    loadStats()
  }, [])

  useEffect(() => {
    if (stats) drawPulse()
  }, [stats, theme])

  const loadStats = async () => {
    try {
      const res = await fetch('/api/usage')
      const data = await res.json()
      setStats(data)
    } catch (err) {
      console.error('Usage load failed', err)
    } finally {
      setLoading(false)
    }
  }

  const drawPulse = () => {
    const canvas = canvasRef.current
    if (!canvas || !stats) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    ctx.clearRect(0, 0, w, h)

    const data = stats.dailyBreakdown.slice(-14)
    if (data.length < 2) return

    const maxTokens = Math.max(...data.map(d => d.tokens), 1)
    const stepX = w / (data.length - 1)

    // Draw grid lines
    ctx.strokeStyle = isNight ? 'rgba(46,61,77,0.6)' : 'rgba(0,0,0,0.05)'
    ctx.lineWidth = 1
    for (let i = 0; i < 4; i++) {
      const y = (h / 4) * i + 10
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // Draw pulse line
    const gradient = ctx.createLinearGradient(0, 0, w, 0)
    if (isNight) {
      gradient.addColorStop(0, '#e2a84b')
      gradient.addColorStop(1, '#f5c96b')
    } else {
      gradient.addColorStop(0, '#F3A4AC')
      gradient.addColorStop(1, '#EF4067')
    }

    ctx.strokeStyle = gradient
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()

    data.forEach((d, i) => {
      const x = i * stepX
      const y = h - 20 - ((d.tokens / maxTokens) * (h - 40))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Draw dots
    data.forEach((d, i) => {
      const x = i * stepX
      const y = h - 20 - ((d.tokens / maxTokens) * (h - 40))
      ctx.fillStyle = isNight ? '#e2a84b' : '#EF4067'
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    })

    // Labels
    ctx.fillStyle = isNight ? '#8899a6' : 'rgba(0,0,0,0.3)'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'center'
    data.forEach((d, i) => {
      if (i % 2 === 0) {
        const x = i * stepX
        ctx.fillText(d.date.slice(5), x, h - 4)
      }
    })
  }

  const formatNum = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return n.toString()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <h2 className="text-lg font-medium">💰 Usage</h2>

        {loading || !stats ? (
          <div className="text-center py-12 opacity-30">加载中...</div>
        ) : (
          <>
            {/* Today's stats */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '今日对话', value: stats.today.calls.toString(), unit: '次' },
                { label: '今日Token', value: formatNum(stats.today.inputTokens + stats.today.outputTokens), unit: 'tokens' },
                { label: '本周对话', value: stats.week.calls.toString(), unit: '次' },
                { label: '本周Token', value: formatNum(stats.week.inputTokens + stats.week.outputTokens), unit: 'tokens' },
              ].map((card, i) => (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`p-4 rounded-2xl ${
                    isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
                  }`}
                >
                  <p className="text-[10px] opacity-40 mb-1">{card.label}</p>
                  <p className={`text-2xl font-light ${
                    isNight ? 'text-night-amber' : 'text-day-heart'
                  }`}>
                    {card.value}
                  </p>
                  <p className="text-[10px] opacity-30">{card.unit}</p>
                </motion.div>
              ))}
            </div>

            {/* Pulse chart */}
            <div className={`p-4 rounded-2xl ${
              isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
            }`}>
              <p className="text-xs opacity-40 mb-3">💓 Token 心跳 (14天)</p>
              <canvas
                ref={canvasRef}
                className="w-full"
                style={{ height: 160 }}
              />
            </div>

            {/* Memory stats */}
            <div className={`p-4 rounded-2xl ${
              isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
            }`}>
              <p className="text-xs opacity-40 mb-3">🧠 记忆库</p>
              <div className="flex gap-6 mb-3">
                <div>
                  <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>
                    {stats.memoryStats.total}
                  </p>
                  <p className="text-[10px] opacity-30">总记忆</p>
                </div>
                <div>
                  <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>
                    {stats.memoryStats.pinned}
                  </p>
                  <p className="text-[10px] opacity-30">钉选</p>
                </div>
              </div>
              {Object.entries(stats.memoryStats.domains).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(stats.memoryStats.domains).map(([domain, count]) => (
                    <span key={domain} className={`text-[10px] px-2 py-0.5 rounded-full ${
                      isNight ? 'bg-night-card text-night-muted' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {domain}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
