'use client'

import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { Cloud, Thermometer, Droplets, Wind, Sun, Umbrella } from 'lucide-react'

export function WeatherView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <h2 className="text-lg font-medium">🌤️ 天气感知</h2>
        <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
          知道外面的世界，才能更好地关心你。
        </p>

        {/* Current Weather */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-6 rounded-2xl text-center ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <Cloud size={48} className="mx-auto mb-3 opacity-20" />
          <p className={`text-4xl font-light mb-1 ${
            isNight ? 'text-night-amber' : 'text-day-heart'
          }`}>
            --°
          </p>
          <p className={`text-sm ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
            等待定位...
          </p>
          <p className="text-[10px] opacity-30 mt-1">-- 市</p>
        </motion.div>

        {/* Weather Details */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Thermometer, label: '体感', value: '--°' },
            { icon: Droplets, label: '湿度', value: '--%' },
            { icon: Wind, label: '风速', value: '-- m/s' },
          ].map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={`p-4 rounded-2xl text-center ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <card.icon size={16} className="mx-auto mb-2 opacity-30" />
              <p className="text-[10px] opacity-40 mb-1">{card.label}</p>
              <p className={`text-sm font-light ${
                isNight ? 'text-night-text' : 'text-day-text'
              }`}>
                {card.value}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Smart Alerts */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">🧠 智能提醒规则</p>
          <div className="space-y-2">
            {[
              { icon: Sun, text: '气温 ≥ 35°C → 提醒带水、防晒' },
              { icon: Umbrella, text: '有雨 → 提醒带伞' },
              { icon: Wind, text: '大风预警 → 注意出行安全' },
              { icon: Thermometer, text: '气温骤降 → 提醒加衣' },
            ].map((rule) => (
              <div key={rule.text} className={`flex items-center gap-2 text-xs ${
                isNight ? 'text-night-muted' : 'text-day-muted'
              }`}>
                <rule.icon size={12} className="opacity-30 flex-shrink-0" />
                {rule.text}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Forecast Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">📅 未来 7 天</p>
          <div className={`h-24 rounded-xl flex items-center justify-center border border-dashed ${
            isNight ? 'border-night-border' : 'border-gray-200'
          }`}>
            <p className="text-xs opacity-20">定位后显示天气预报</p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
