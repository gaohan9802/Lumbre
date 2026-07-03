'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { usePeriodStore } from '@/lib/periodStore'
import { motion } from 'framer-motion'
import { Heart, Footprints, Moon, Activity, MapPin, Navigation, Clock, Droplet, Plus, X } from 'lucide-react'
import { format, differenceInDays, addDays, parseISO } from 'date-fns'

export function HealthView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const { records, startPeriod, endPeriod, deleteRecord } = usePeriodStore()
  const [geo, setGeo] = useState<{ lat: number; lon: number; city: string } | null>(null)
  const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'denied' | 'ok'>('idle')
  const [showHistory, setShowHistory] = useState(false)

  const requestLocation = () => {
    if (!navigator.geolocation) return
    setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        let city = ''
        try {
          const res = await fetch('/api/weather', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lon }),
          })
          const d = await res.json()
          city = d.city || ''
        } catch {}
        setGeo({ lat, lon, city })
        setGeoStatus('ok')
      },
      () => setGeoStatus('denied'),
      { timeout: 10000 }
    )
  }

  useEffect(() => { requestLocation() }, [])

  // ── period calculations ──
  const today = format(new Date(), 'yyyy-MM-dd')
  const openPeriod = [...records].reverse().find((r) => !r.end)
  const completed = records.filter((r) => r.end)
  const lastStart = records.length ? records[records.length - 1].start : null

  // average cycle from completed history
  let avgCycle = 28
  if (records.length >= 2) {
    const gaps: number[] = []
    for (let i = 1; i < records.length; i++) {
      gaps.push(differenceInDays(parseISO(records[i].start), parseISO(records[i - 1].start)))
    }
    const valid = gaps.filter((g) => g >= 15 && g <= 60)
    if (valid.length) avgCycle = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  }
  const nextPredicted = lastStart ? addDays(parseISO(lastStart), avgCycle) : null
  const daysUntilNext = nextPredicted ? differenceInDays(nextPredicted, new Date()) : null
  const dayOfPeriod = openPeriod ? differenceInDays(new Date(), parseISO(openPeriod.start)) + 1 : null

  const healthCards = [
    { icon: Heart, label: '心率', value: '--', unit: 'BPM', color: 'text-red-400' },
    { icon: Footprints, label: '今日步数', value: '--', unit: '步', color: 'text-green-400' },
    { icon: Moon, label: '昨晚睡眠', value: '--', unit: '小时', color: 'text-indigo-400' },
    { icon: Activity, label: '活动消耗', value: '--', unit: 'kcal', color: 'text-orange-400' },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <h2 className="text-lg font-medium">❤️ 健康</h2>

        {/* ── 生理期 ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-5 rounded-2xl ${isNight ? 'bg-night-surface' : 'bg-white shadow-sm'}`}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs opacity-40 flex items-center gap-1"><Droplet size={12} /> 生理期</p>
            <button onClick={() => setShowHistory((v) => !v)} className="text-[10px] opacity-40 hover:opacity-80">
              {showHistory ? '收起' : `历史 (${completed.length})`}
            </button>
          </div>

          {openPeriod ? (
            <div className="text-center space-y-3">
              <p className={`text-3xl font-light ${isNight ? 'text-night-amber' : 'text-day-heart'}`}>
                Day {dayOfPeriod}
              </p>
              <p className="text-xs opacity-40">{openPeriod.start} 开始</p>
              <button
                onClick={() => endPeriod(today)}
                className={`px-4 py-2 rounded-xl text-xs ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}
              >
                今天结束了
              </button>
            </div>
          ) : (
            <div className="text-center space-y-3">
              {nextPredicted ? (
                <>
                  <p className={`text-3xl font-light ${isNight ? 'text-night-amber' : 'text-day-heart'}`}>
                    {daysUntilNext !== null && daysUntilNext >= 0 ? `${daysUntilNext} 天` : `晚了 ${-daysUntilNext!} 天`}
                  </p>
                  <p className="text-xs opacity-40">
                    预计 {format(nextPredicted, 'M月d日')} · 平均周期 {avgCycle} 天
                  </p>
                </>
              ) : (
                <p className="text-xs opacity-40 py-2">还没有记录，点下面开始</p>
              )}
              <button
                onClick={() => startPeriod(today)}
                className={`px-4 py-2 rounded-xl text-xs flex items-center gap-1 mx-auto ${isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink/10 text-day-pink'}`}
              >
                <Plus size={12} /> 今天来了
              </button>
            </div>
          )}

          {showHistory && records.length > 0 && (
            <div className="mt-4 pt-3 border-t border-current/5 space-y-1.5 max-h-48 overflow-y-auto">
              {[...records].reverse().map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span className="opacity-60">
                    {r.start} → {r.end || '进行中'}
                    {r.end && <span className="opacity-50 ml-1">({differenceInDays(parseISO(r.end), parseISO(r.start)) + 1}天)</span>}
                  </span>
                  <button onClick={() => deleteRecord(r.id)} className="p-1 text-red-400/50 hover:text-red-400">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* ── 位置 ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={`p-5 rounded-2xl ${isNight ? 'bg-night-surface' : 'bg-white shadow-sm'}`}
        >
          <p className="text-xs opacity-40 mb-3 flex items-center gap-1"><MapPin size={12} /> 位置</p>
          {geoStatus === 'ok' && geo ? (
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isNight ? 'bg-night-card' : 'bg-gray-50'}`}>
                <Navigation size={20} className={isNight ? 'text-night-amber' : 'text-day-pink'} />
              </div>
              <div>
                <p className="text-lg font-light">{geo.city || '未知城市'}</p>
                <p className="text-[10px] opacity-30">
                  {geo.lat.toFixed(4)}, {geo.lon.toFixed(4)} · <Clock size={9} className="inline" /> {format(new Date(), 'HH:mm')} 更新
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-2">
              <p className="text-xs opacity-40 mb-2">
                {geoStatus === 'denied' ? '位置权限被拒绝' : geoStatus === 'loading' ? '定位中...' : '尚未定位'}
              </p>
              {geoStatus !== 'loading' && (
                <button
                  onClick={requestLocation}
                  className={`px-4 py-2 rounded-xl text-xs ${isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink/10 text-day-pink'}`}
                >
                  {geoStatus === 'denied' ? '重试' : '授权定位'}
                </button>
              )}
            </div>
          )}
        </motion.div>

        {/* ── 健康数据（HealthKit 待接入）── */}
        <div className="grid grid-cols-2 gap-3">
          {healthCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={`p-5 rounded-2xl ${isNight ? 'bg-night-surface' : 'bg-white shadow-sm'}`}
            >
              <card.icon size={18} className={`${card.color} mb-3`} />
              <p className="text-[10px] opacity-40 mb-1">{card.label}</p>
              <div className="flex items-baseline gap-1">
                <p className={`text-2xl font-light ${isNight ? 'text-night-amber' : 'text-day-heart'}`}>
                  {card.value}
                </p>
                <p className="text-[10px] opacity-30">{card.unit}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <p className="text-[10px] opacity-30 text-center">健康数据需 iOS HealthKit 接入（规划中）</p>
      </div>
    </div>
  )
}
