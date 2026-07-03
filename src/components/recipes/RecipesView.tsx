'use client'

import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { ChefHat, Plus, Camera, MessageCircle, BookOpen, CalendarDays, Search } from 'lucide-react'

type RecipeTab = 'book' | 'daily'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export function RecipesView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const [activeTab, setActiveTab] = useState<RecipeTab>('book')

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">🍳 食谱</h2>
            <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
              吃什么，也是一种记录。
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
            {activeTab === 'book' ? '添加食谱' : '记录今天'}
          </button>
        </div>

        {/* Tab Switcher */}
        <div className={`flex gap-1 p-1 rounded-xl ${
          isNight ? 'bg-night-surface' : 'bg-gray-100'
        }`}>
          <button
            onClick={() => setActiveTab('book')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs transition-all ${
              activeTab === 'book'
                ? isNight
                  ? 'bg-night-card text-night-amber shadow-sm'
                  : 'bg-white text-day-pink shadow-sm'
                : 'opacity-50'
            }`}
          >
            <BookOpen size={14} />
            食谱书
          </button>
          <button
            onClick={() => setActiveTab('daily')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs transition-all ${
              activeTab === 'daily'
                ? isNight
                  ? 'bg-night-card text-night-amber shadow-sm'
                  : 'bg-white text-day-pink shadow-sm'
                : 'opacity-50'
            }`}
          >
            <CalendarDays size={14} />
            每日饮食
          </button>
        </div>

        {activeTab === 'book' ? (
          /* ===== Recipe Book ===== */
          <div className="space-y-4">
            {/* Search */}
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${
              isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
            }`}>
              <Search size={14} className="opacity-30" />
              <input
                type="text"
                placeholder="搜索食谱…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-30"
              />
            </div>

            {/* Empty State */}
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
                <ChefHat size={24} className="opacity-20" />
              </div>
              <p className={`text-sm mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>
                食谱书还是空的
              </p>
              <p className="text-[10px] opacity-30 mb-4">
                添加第一道菜吧
              </p>
            </motion.div>

            {/* Alphabet Index */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className={`p-4 rounded-2xl ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <p className="text-xs opacity-40 mb-3">🔤 字母索引</p>
              <div className="flex flex-wrap gap-1.5">
                {alphabet.map((letter) => (
                  <button
                    key={letter}
                    className={`w-8 h-8 rounded-lg text-xs flex items-center justify-center transition-colors ${
                      isNight
                        ? 'bg-night-card text-night-muted hover:text-night-amber hover:bg-night-amber/10'
                        : 'bg-gray-50 text-day-muted hover:text-day-pink hover:bg-day-pinkLight'
                    }`}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Recipe Placeholder Cards */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-2"
            >
              <p className="text-xs opacity-40">📖 所有食谱</p>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 p-3 rounded-xl ${
                    isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    isNight ? 'bg-night-card' : 'bg-gray-50'
                  }`}>
                    <ChefHat size={16} className="opacity-15" />
                  </div>
                  <div className="flex-1">
                    <div className={`h-3 w-24 rounded ${isNight ? 'bg-night-card' : 'bg-gray-100'}`} />
                    <div className={`h-2 w-16 rounded mt-1.5 ${isNight ? 'bg-night-card' : 'bg-gray-100'}`} />
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className={`p-4 rounded-2xl ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <p className="text-xs opacity-40 mb-3">📊 食谱统计</p>
              <div className="flex gap-6">
                <div>
                  <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
                  <p className="text-[10px] opacity-30">总食谱</p>
                </div>
                <div>
                  <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
                  <p className="text-[10px] opacity-30">已做过</p>
                </div>
                <div>
                  <p className={`text-xl font-light ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>0</p>
                  <p className="text-[10px] opacity-30">收藏</p>
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          /* ===== Daily Food Diary ===== */
          <div className="space-y-4">
            {/* Today Card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-4 rounded-2xl ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs opacity-40">📅 今天</p>
                <p className="text-[10px] opacity-30">
                  {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}
                </p>
              </div>
              <div className="space-y-3">
                {['🌅 早餐', '☀️ 午餐', '🌙 晚餐', '🍪 加餐'].map((meal, i) => (
                  <div
                    key={meal}
                    className={`flex items-center gap-3 p-3 rounded-xl border border-dashed ${
                      isNight ? 'border-night-border' : 'border-gray-200'
                    }`}
                  >
                    <span className="text-sm">{meal}</span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                      <button className={`p-1.5 rounded-lg ${
                        isNight ? 'hover:bg-night-card' : 'hover:bg-gray-50'
                      }`}>
                        <Camera size={12} className="opacity-30" />
                      </button>
                      <button className={`p-1.5 rounded-lg ${
                        isNight ? 'hover:bg-night-card' : 'hover:bg-gray-50'
                      }`}>
                        <Plus size={12} className="opacity-30" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Calendar Grid Placeholder */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`p-4 rounded-2xl ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <p className="text-xs opacity-40 mb-3">📆 本月记录</p>
              <div className="grid grid-cols-7 gap-1.5">
                {['日','一','二','三','四','五','六'].map((d) => (
                  <div key={d} className="text-center text-[10px] opacity-30 pb-1">{d}</div>
                ))}
                {Array.from({ length: 35 }, (_, i) => (
                  <div
                    key={i}
                    className={`aspect-square rounded-lg flex items-center justify-center text-[10px] ${
                      isNight ? 'bg-night-card' : 'bg-gray-50'
                    } opacity-30`}
                  >
                    {i < 31 ? i + 1 : ''}
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Past Days Placeholder */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="space-y-3"
            >
              <p className="text-xs opacity-40">📋 历史记录</p>
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className={`p-4 rounded-2xl ${
                    isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
                  }`}
                >
                  <div className={`h-3 w-20 rounded mb-3 ${isNight ? 'bg-night-card' : 'bg-gray-100'}`} />
                  <div className="space-y-2">
                    {[1, 2, 3].map((j) => (
                      <div key={j} className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg ${isNight ? 'bg-night-card' : 'bg-gray-50'}`} />
                        <div className="flex-1">
                          <div className={`h-2.5 w-20 rounded ${isNight ? 'bg-night-card' : 'bg-gray-100'}`} />
                          <div className={`h-2 w-12 rounded mt-1 ${isNight ? 'bg-night-card' : 'bg-gray-100'}`} />
                        </div>
                        <MessageCircle size={12} className="opacity-15" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  )
}
