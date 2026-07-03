'use client'

import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion } from 'framer-motion'
import { BookOpen, Plus, MessageSquare, Bookmark, Users } from 'lucide-react'

export function CoReadingView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()
  const isNight = theme === 'night'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <h2 className="text-lg font-medium">📖 共读空间</h2>
        <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
          同读一本书，在书页空白处传纸条。
        </p>

        {/* Current Book Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-6 rounded-2xl text-center ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <div className={`inline-flex items-center justify-center w-20 h-28 rounded-lg mb-4 ${
            isNight ? 'bg-night-card border border-night-border' : 'bg-gray-50 border border-gray-200'
          }`}>
            <BookOpen size={28} className="opacity-15" />
          </div>
          <p className={`text-sm mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>
            还没有在读的书
          </p>
          <p className="text-[10px] opacity-30 mb-4">
            添加一本书，开始一起阅读吧
          </p>
          <button
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs ${
              isNight
                ? 'bg-night-amber/20 text-night-amber'
                : 'bg-day-pinkLight text-day-pink'
            }`}
          >
            <Plus size={14} />
            添加书籍
          </button>
        </motion.div>

        {/* Features Preview */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Users, label: '同步进度', desc: '看到彼此读到哪了' },
            { icon: MessageSquare, label: '批注互见', desc: '在书页间传纸条' },
            { icon: Bookmark, label: '划线标注', desc: '标记喜欢的句子' },
            { icon: BookOpen, label: '共读书架', desc: '一起读过的书' },
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

        {/* Reading Stats Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">📊 阅读统计</p>
          <div className="flex gap-6">
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">共读过</p>
            </div>
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">批注数</p>
            </div>
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">划线数</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
