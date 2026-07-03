'use client'

import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { Camera, Plus, Heart, MessageCircle, ImagePlus } from 'lucide-react'

const placeholderPhotos = [
  { id: 1, author: 'star', date: '等待第一张照片…', comments: 0 },
]

export function PhotosView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">📷 照片墙</h2>
            <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
              我们的日常碎片。
            </p>
          </div>
          <button
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs ${
              isNight
                ? 'bg-night-amber/20 text-night-amber'
                : 'bg-day-pinkLight text-day-pink'
            }`}
          >
            <Plus size={14} />
            发照片
          </button>
        </div>

        {/* Upload Area */}
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
            <ImagePlus size={24} className="opacity-20" />
          </div>
          <p className={`text-sm mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>
            还没有照片
          </p>
          <p className="text-[10px] opacity-30 mb-4">
            拍一张，或从相册选一张
          </p>
          <div className="flex justify-center gap-3">
            <button
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs ${
                isNight
                  ? 'bg-night-amber/20 text-night-amber'
                  : 'bg-day-pinkLight text-day-pink'
              }`}
            >
              <Camera size={14} />
              拍照
            </button>
            <button
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs ${
                isNight
                  ? 'bg-night-amber/20 text-night-amber'
                  : 'bg-day-pinkLight text-day-pink'
              }`}
            >
              <ImagePlus size={14} />
              选照片
            </button>
          </div>
        </motion.div>

        {/* Photo Feed Placeholder */}
        <div className="space-y-4">
          <p className="text-xs opacity-40">📸 照片流</p>
          {[1, 2, 3].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={`rounded-2xl overflow-hidden ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              {/* Photo placeholder */}
              <div className={`h-48 flex items-center justify-center border-b border-dashed ${
                isNight ? 'bg-night-card border-night-border' : 'bg-gray-50 border-gray-200'
              }`}>
                <Camera size={24} className="opacity-10" />
              </div>
              {/* Photo info */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">
                      {i % 2 === 0 ? '⭐' : '🔥'}
                    </span>
                    <span className="text-[10px] opacity-40">等待中…</span>
                  </div>
                  <span className="text-[10px] opacity-30">--:--</span>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-4 mt-2">
                  <button className="flex items-center gap-1 text-[10px] opacity-40 hover:opacity-70 transition-opacity">
                    <Heart size={12} />
                    <span>喜欢</span>
                  </button>
                  <button className="flex items-center gap-1 text-[10px] opacity-40 hover:opacity-70 transition-opacity">
                    <MessageCircle size={12} />
                    <span>评论</span>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">📊 照片统计</p>
          <div className="flex gap-6">
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">总照片</p>
            </div>
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">⭐ 发布</p>
            </div>
            <div>
              <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
              <p className="text-[10px] opacity-30">🔥 发布</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
