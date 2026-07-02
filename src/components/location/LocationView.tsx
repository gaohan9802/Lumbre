'use client'

import { useState } from 'react'
import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { MapPin, Home, Navigation, Clock, Shield } from 'lucide-react'

export function LocationView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const [permissionGranted] = useState(false)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <h2 className="text-lg font-medium">📍 位置感知</h2>
        <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
          不是监控，是感知。知道你在家、在外、在路上。
        </p>

        {/* Status Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-6 rounded-2xl text-center ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
            isNight ? 'bg-night-card' : 'bg-gray-50'
          }`}>
            <Home size={28} className="text-gray-400" />
          </div>
          <p className={`text-2xl font-light mb-1 ${
            isNight ? 'text-night-text' : 'text-day-text'
          }`}>
            等待连接
          </p>
          <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
            位置服务尚未启用
          </p>
        </motion.div>

        {/* Detail Cards */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Clock, label: '持续时间', value: '--:--' },
            { icon: Navigation, label: '所在城市', value: '--' },
            { icon: Clock, label: '最后更新', value: '--:--' },
            { icon: Shield, label: '权限状态', value: '未授权' },
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
              <card.icon size={14} className="opacity-30 mb-2" />
              <p className="text-[10px] opacity-40 mb-1">{card.label}</p>
              <p className={`text-sm font-light ${
                isNight ? 'text-night-amber' : 'text-day-heart'
              }`}>
                {card.value}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Permission Prompt */}
        {!permissionGranted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className={`p-4 rounded-2xl border border-dashed text-center ${
              isNight ? 'border-night-border text-night-muted' : 'border-day-muted/30 text-day-muted'
            }`}
          >
            <MapPin size={20} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs opacity-60 mb-3">需要位置权限才能感知</p>
            <button
              className={`px-4 py-2 rounded-xl text-xs ${
                isNight
                  ? 'bg-night-amber/20 text-night-amber'
                  : 'bg-day-pink/10 text-day-pink'
              }`}
            >
              授权位置访问
            </button>
            <p className="text-[10px] opacity-30 mt-2">
              仅用于感知状态，不记录轨迹
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
