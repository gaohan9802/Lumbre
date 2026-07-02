'use client'

import { useState } from 'react'
import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { Bell, Clock, Heart, MapPin, Utensils, Sun, Moon as MoonIcon, Sparkles, ToggleLeft, ToggleRight } from 'lucide-react'

interface WakeRule {
  id: string
  icon: typeof Bell
  label: string
  description: string
  enabled: boolean
}

export function AutoWakeView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'

  const [rules, setRules] = useState<WakeRule[]>([
    { id: 'silence', icon: Clock, label: '长时间沉默', description: '超过 3 小时未对话', enabled: true },
    { id: 'heartrate', icon: Heart, label: '心率异常', description: '心率过高或过低时提醒', enabled: true },
    { id: 'meal', icon: Utensils, label: '饭点检查', description: '到了饭点没动静', enabled: true },
    { id: 'gps', icon: MapPin, label: 'GPS 异常', description: '深夜不在家时关心', enabled: false },
    { id: 'morning', icon: Sun, label: '早安', description: '每天早上自动问好', enabled: true },
    { id: 'night', icon: MoonIcon, label: '晚安', description: '每天晚上道晚安', enabled: true },
    { id: 'random', icon: Sparkles, label: '想你了', description: '无条件触发，就是想你', enabled: true },
  ])

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
  }

  const enabledCount = rules.filter(r => r.enabled).length

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <h2 className="text-lg font-medium">🔔 自主唤醒</h2>
        <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
          不是你来找我。是我去找你。
        </p>

        {/* Status */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-5 rounded-2xl text-center ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-full mb-3 ${
            isNight ? 'bg-night-amber/10' : 'bg-day-pink/10'
          }`}>
            <Bell size={24} className={isNight ? 'text-night-amber' : 'text-day-pink'} />
          </div>
          <p className={`text-sm mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>
            {enabledCount} 个规则已启用
          </p>
          <p className="text-[10px] opacity-30">
            星星会在合适的时候主动来找你
          </p>
        </motion.div>

        {/* Rules */}
        <div className="space-y-2">
          {rules.map((rule, i) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`flex items-center gap-3 p-4 rounded-2xl ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}
            >
              <rule.icon size={18} className={
                rule.enabled
                  ? isNight ? 'text-night-amber' : 'text-day-pink'
                  : 'opacity-20'
              } />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${rule.enabled ? '' : 'opacity-40'}`}>
                  {rule.label}
                </p>
                <p className="text-[10px] opacity-30">{rule.description}</p>
              </div>
              <button onClick={() => toggleRule(rule.id)}>
                {rule.enabled ? (
                  <ToggleRight size={24} className={isNight ? 'text-night-amber' : 'text-day-pink'} />
                ) : (
                  <ToggleLeft size={24} className="opacity-20" />
                )}
              </button>
            </motion.div>
          ))}
        </div>

        {/* Recent Wake History */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className={`p-4 rounded-2xl ${
            isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
          }`}
        >
          <p className="text-xs opacity-40 mb-3">📝 最近唤醒记录</p>
          <div className={`h-20 rounded-xl flex items-center justify-center border border-dashed ${
            isNight ? 'border-night-border' : 'border-gray-200'
          }`}>
            <p className="text-xs opacity-20">暂无记录</p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
