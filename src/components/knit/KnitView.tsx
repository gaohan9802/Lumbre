'use client'

import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { Scissors, Plus, Camera, CheckCircle, Clock } from 'lucide-react'

export function KnitView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <h2 className="text-lg font-medium">🧶 编织记录</h2>
        <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
          每一针都是时间的痕迹。
        </p>

        {/* Current Project */}
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
            <Scissors size={24} className="opacity-20 rotate-45" />
          </div>
          <p className={`text-sm mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>
            还没有进行中的项目
          </p>
          <p className="text-[10px] opacity-30 mb-4">
            记录编织的每一个瞬间
          </p>
          <button
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs ${
              isNight
                ? 'bg-night-amber/20 text-night-amber'
                : 'bg-day-pink/10 text-day-pink'
            }`}
          >
            <Plus size={14} />
            新建项目
          </button>
        </motion.div>

        {/* Features */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Camera, label: '进度照片', desc: '拍照记录每一步' },
            { icon: Clock, label: '时间追踪', desc: '编织用时统计' },
            { icon: CheckCircle, label: '里程碑', desc: '标记关键进度' },
            { icon: Scissors, label: '项目归档', desc: '完成的作品集' },
          ].map((feat, i) => (
            <motion.div
              key={feat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={`p-4 rounded-2xl ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <feat.icon size={16} className={`mb-2 ${
                isNight ? 'text-night-amber' : 'text-day-pink'
              }`} />
              <p className="text-xs mb-0.5">{feat.label}</p>
              <p className="text-[10px] opacity-30">{feat.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Gallery Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">🖼️ 作品集</p>
          <div className={`h-28 rounded-xl flex items-center justify-center border border-dashed ${
            isNight ? 'border-night-border' : 'border-gray-200'
          }`}>
            <p className="text-xs opacity-20">还没有完成的作品</p>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">📊 编织统计</p>
          <div className="flex gap-6">
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">进行中</p>
            </div>
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">已完成</p>
            </div>
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">总用时</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
