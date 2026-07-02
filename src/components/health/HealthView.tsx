'use client'

import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { Heart, Footprints, Moon, Activity, Smartphone } from 'lucide-react'

export function HealthView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'

  const healthCards = [
    { icon: Heart, label: '心率', value: '--', unit: 'BPM', color: 'text-red-400' },
    { icon: Footprints, label: '今日步数', value: '--', unit: '步', color: 'text-green-400' },
    { icon: Moon, label: '昨晚睡眠', value: '--', unit: '小时', color: 'text-indigo-400' },
    { icon: Activity, label: '活动消耗', value: '--', unit: 'kcal', color: 'text-orange-400' },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <h2 className="text-lg font-medium">❤️ 健康数据</h2>
        <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
          接入 Apple Health，感知你的身体状态。
        </p>

        {/* Health Cards */}
        <div className="grid grid-cols-2 gap-3">
          {healthCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={`p-5 rounded-2xl ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <card.icon size={18} className={`${card.color} mb-3`} />
              <p className="text-[10px] opacity-40 mb-1">{card.label}</p>
              <div className="flex items-baseline gap-1">
                <p className={`text-2xl font-light ${
                  isNight ? 'text-night-amber' : 'text-day-heart'
                }`}>
                  {card.value}
                </p>
                <p className="text-[10px] opacity-30">{card.unit}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Heart Rate Timeline Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">💓 心率曲线 (24h)</p>
          <div className={`h-32 rounded-xl flex items-center justify-center border border-dashed ${
            isNight ? 'border-night-border' : 'border-gray-200'
          }`}>
            <p className="text-xs opacity-20">连接 HealthKit 后显示</p>
          </div>
        </motion.div>

        {/* Alert Rules */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">⚠️ 异常检测规则</p>
          <div className="space-y-2">
            {[
              '心率 > 120 BPM 持续 5 分钟',
              '心率 < 50 BPM',
              '6 小时无步数 + 无对话',
              '睡眠不足 5 小时',
            ].map((rule) => (
              <div key={rule} className={`flex items-center gap-2 text-xs ${
                isNight ? 'text-night-muted' : 'text-day-muted'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  isNight ? 'bg-night-amber/30' : 'bg-day-pink/30'
                }`} />
                {rule}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Connect Prompt */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className={`p-4 rounded-2xl border border-dashed text-center ${
            isNight ? 'border-night-border text-night-muted' : 'border-day-muted/30 text-day-muted'
          }`}
        >
          <Smartphone size={20} className="mx-auto mb-2 opacity-30" />
          <p className="text-xs opacity-60 mb-3">需要 iOS HealthKit 授权</p>
          <button
            className={`px-4 py-2 rounded-xl text-xs ${
              isNight
                ? 'bg-night-amber/20 text-night-amber'
                : 'bg-day-pink/10 text-day-pink'
            }`}
          >
            连接 Apple Health
          </button>
        </motion.div>
      </div>
    </div>
  )
}
