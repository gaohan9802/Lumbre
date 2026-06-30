'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, RotateCcw, Trash2, Plus, Eye, EyeOff } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import {
  useChatStore,
  estimateTokens,
  ApiProvider,
  DEFAULT_ANTHROPIC_BASE,
  DEFAULT_OPENAI_BASE,
} from '@/lib/chatStore'

interface Props {
  open: boolean
  onClose: () => void
}

const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
  { id: 'claude-opus-4-20250514', label: 'Opus 4' },
  { id: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' },
]

const OPENAI_COMPAT_MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'deepseek-chat', label: 'DeepSeek' },
  { id: 'openrouter/auto', label: 'OpenRouter Auto' },
]

function maskKey(key: string) {
  if (!key) return '未填写'
  if (key.length <= 10) return '••••••'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

export function ChatSettings({ open, onClose }: Props) {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const {
    messages,
    settings,
    setSettings,
    resetSettings,
    clearMessages,
    addApiProfile,
    updateApiProfile,
    deleteApiProfile,
    setActiveProfile,
  } = useChatStore()

  const [showKeys, setShowKeys] = useState(false)
  const [newProfileOpen, setNewProfileOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newProvider, setNewProvider] = useState<ApiProvider>('anthropic')
  const [newBaseUrl, setNewBaseUrl] = useState(DEFAULT_ANTHROPIC_BASE)
  const [newApiKey, setNewApiKey] = useState('')
  const [newModel, setNewModel] = useState('claude-sonnet-4-20250514')

  const systemTokens = estimateTokens(settings.systemPrompt)
  const totalMsgTokens = messages.reduce((s, m) => s + estimateTokens(m.content), 0)
  const sentSlice = messages.slice(-settings.contextLength)
  const sentTokens = sentSlice.reduce((s, m) => s + estimateTokens(m.content), 0)

  const activeProfile = settings.apiProfiles.find((p) => p.id === settings.activeProfileId) || settings.apiProfiles[0]
  const modelPresets = activeProfile?.provider === 'openai-compatible' ? OPENAI_COMPAT_MODELS : ANTHROPIC_MODELS
  const inputClass = `w-full text-xs px-3 py-2 rounded-lg outline-none ${
    isNight ? 'bg-night-surface text-night-text placeholder:text-night-muted' : 'bg-gray-50 text-day-text placeholder:text-day-muted'
  }`
  const subtleCard = `${isNight ? 'bg-night-surface/70 border-night-border' : 'bg-gray-50 border-gray-100'} border rounded-xl`

  const createProfile = () => {
    const fallbackBase = newProvider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE : DEFAULT_OPENAI_BASE
    const fallbackModel = newProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'
    addApiProfile({
      name: newName.trim() || (newProvider === 'anthropic' ? 'Anthropic' : 'OpenAI Compatible'),
      provider: newProvider,
      baseUrl: (newBaseUrl.trim() || fallbackBase).replace(/\/$/, ''),
      apiKey: newApiKey.trim(),
      defaultModel: newModel.trim() || fallbackModel,
    })
    setNewName('')
    setNewProvider('anthropic')
    setNewBaseUrl(DEFAULT_ANTHROPIC_BASE)
    setNewApiKey('')
    setNewModel('claude-sonnet-4-20250514')
    setNewProfileOpen(false)
  }

  const switchNewProvider = (provider: ApiProvider) => {
    setNewProvider(provider)
    if (provider === 'anthropic') {
      setNewBaseUrl(DEFAULT_ANTHROPIC_BASE)
      setNewModel('claude-sonnet-4-20250514')
    } else {
      setNewBaseUrl(DEFAULT_OPENAI_BASE)
      setNewModel('gpt-4o')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className={`
              fixed right-0 top-0 bottom-0 w-full sm:w-[460px] z-50 overflow-y-auto
              ${isNight ? 'bg-night-card border-l border-night-border' : 'bg-white border-l border-day-muted/10'}
              pb-[env(safe-area-inset-bottom)]
            `}
          >
            <div className="sticky top-0 backdrop-blur-md bg-inherit px-6 py-4 flex items-center justify-between border-b border-current/5">
              <h3 className="font-medium">⚙️ Chat 设置</h3>
              <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* API profiles */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs opacity-60">API 密钥管理</label>
                    <p className="text-[10px] opacity-40 mt-1">保存在本机 localStorage；请求时交给 Lumbre 后端临时转发。</p>
                  </div>
                  <button
                    onClick={() => setShowKeys(!showKeys)}
                    className="p-2 rounded-lg opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                    title={showKeys ? '隐藏 key' : '显示 key'}
                  >
                    {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                <div className="space-y-2">
                  {settings.apiProfiles.map((p) => (
                    <div
                      key={p.id}
                      className={`p-3 ${subtleCard} ${settings.activeProfileId === p.id ? (isNight ? 'ring-1 ring-night-amber' : 'ring-1 ring-day-pink') : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <button
                          onClick={() => setActiveProfile(p.id)}
                          className={`text-xs px-2 py-1 rounded-md ${
                            settings.activeProfileId === p.id
                              ? isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                              : isNight ? 'bg-night-card' : 'bg-white'
                          }`}
                        >
                          {settings.activeProfileId === p.id ? '使用中' : '切换'}
                        </button>
                        <span className="text-[10px] opacity-50 flex-1 text-right">{p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}</span>
                        <button
                          onClick={() => { if (confirm('删除这个 API 配置？')) deleteApiProfile(p.id) }}
                          className="text-[10px] text-red-500/70 hover:text-red-500"
                        >
                          删除
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <input className={inputClass} value={p.name} placeholder="名字" onChange={(e) => updateApiProfile(p.id, { name: e.target.value })} />
                        <select
                          className={inputClass}
                          value={p.provider}
                          onChange={(e) => {
                            const provider = e.target.value as ApiProvider
                            updateApiProfile(p.id, {
                              provider,
                              baseUrl: provider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE : DEFAULT_OPENAI_BASE,
                              defaultModel: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o',
                            })
                          }}
                        >
                          <option value="anthropic">Anthropic</option>
                          <option value="openai-compatible">OpenAI Compatible</option>
                        </select>
                        <input className={`${inputClass} col-span-2`} value={p.baseUrl} placeholder="Base URL" onChange={(e) => updateApiProfile(p.id, { baseUrl: e.target.value })} />
                        <input
                          className={`${inputClass} col-span-2 font-mono`}
                          type={showKeys ? 'text' : 'password'}
                          value={p.apiKey}
                          placeholder="API Key"
                          onChange={(e) => updateApiProfile(p.id, { apiKey: e.target.value })}
                        />
                        <input
                          className={`${inputClass} col-span-2 font-mono`}
                          value={p.defaultModel}
                          placeholder="默认模型"
                          onChange={(e) => updateApiProfile(p.id, { defaultModel: e.target.value })}
                        />
                      </div>
                      <div className="text-[10px] opacity-40 mt-2 truncate">key: {showKeys ? p.apiKey || '未填写' : maskKey(p.apiKey)}</div>
                    </div>
                  ))}
                </div>

                {newProfileOpen ? (
                  <div className={`p-3 ${subtleCard} space-y-2`}>
                    <div className="grid grid-cols-2 gap-2">
                      <input className={inputClass} value={newName} placeholder="名字，例如 OpenRouter" onChange={(e) => setNewName(e.target.value)} />
                      <select className={inputClass} value={newProvider} onChange={(e) => switchNewProvider(e.target.value as ApiProvider)}>
                        <option value="anthropic">Anthropic</option>
                        <option value="openai-compatible">OpenAI Compatible</option>
                      </select>
                      <input className={`${inputClass} col-span-2`} value={newBaseUrl} placeholder="Base URL" onChange={(e) => setNewBaseUrl(e.target.value)} />
                      <input className={`${inputClass} col-span-2 font-mono`} type={showKeys ? 'text' : 'password'} value={newApiKey} placeholder="API Key" onChange={(e) => setNewApiKey(e.target.value)} />
                      <input className={`${inputClass} col-span-2 font-mono`} value={newModel} placeholder="默认模型" onChange={(e) => setNewModel(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={createProfile} className={`px-3 py-2 rounded-lg text-xs ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>保存</button>
                      <button onClick={() => setNewProfileOpen(false)} className="px-3 py-2 rounded-lg text-xs opacity-60 hover:opacity-100">取消</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setNewProfileOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Plus size={12} /> 添加 API 站点
                  </button>
                )}
              </section>

              {/* Model */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">当前模型</label>
                  <span className="text-[10px] opacity-40">{activeProfile?.name || 'No profile'}</span>
                </div>
                <input
                  value={settings.model}
                  onChange={(e) => setSettings({ model: e.target.value })}
                  placeholder="模型 ID"
                  className={`${inputClass} font-mono`}
                />
                <div className="flex gap-2 flex-wrap">
                  {modelPresets.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSettings({ model: m.id })}
                      className={`px-3 py-1.5 rounded-lg text-xs transition ${
                        settings.model === m.id
                          ? isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                          : isNight ? 'bg-night-surface' : 'bg-gray-100'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* System prompt */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">System Prompt</label>
                  <span className="text-[10px] opacity-40">~{systemTokens} tok</span>
                </div>
                <textarea
                  value={settings.systemPrompt}
                  onChange={(e) => setSettings({ systemPrompt: e.target.value })}
                  rows={8}
                  placeholder="给星星定一个底色…"
                  className={`
                    w-full text-sm leading-relaxed p-3 rounded-xl outline-none resize-y
                    ${isNight
                      ? 'bg-night-surface text-night-text placeholder:text-night-muted'
                      : 'bg-gray-50 text-day-text placeholder:text-day-muted'}
                  `}
                />
              </section>

              {/* Context length */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">Context — 抓取最近多少条</label>
                  <span className="text-xs">
                    <span className={isNight ? 'text-night-amber' : 'text-day-heart'}>{settings.contextLength}</span>
                    <span className="opacity-40"> / {messages.length}</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={200}
                  step={2}
                  value={settings.contextLength}
                  onChange={(e) => setSettings({ contextLength: parseInt(e.target.value) })}
                  className="w-full accent-current"
                />
                <div className="text-[10px] opacity-40 flex justify-between">
                  <span>4</span>
                  <span>本轮发送 ~{sentTokens} tok（共 ~{totalMsgTokens}）</span>
                  <span>200</span>
                </div>
              </section>

              {/* Thinking budget */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">Extended Thinking / Reasoning Budget</label>
                  <span className="text-xs opacity-60">{settings.thinkingBudget || 'off'}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={32000}
                  step={1000}
                  value={settings.thinkingBudget}
                  onChange={(e) => setSettings({ thinkingBudget: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="text-[10px] opacity-40 flex justify-between">
                  <span>off</span>
                  <span>{settings.thinkingBudget > 0 ? `${settings.thinkingBudget} tok 思考预算` : '关闭'}</span>
                  <span>32k</span>
                </div>
              </section>

              {/* Prompt caching */}
              <section className="flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-60">Prompt Caching</p>
                  <p className="text-[10px] opacity-40 mt-1">Anthropic 原生支持；OpenAI 兼容站点会忽略。</p>
                </div>
                <button
                  onClick={() => setSettings({ promptCaching: !settings.promptCaching })}
                  className={`relative w-10 h-6 rounded-full transition ${
                    settings.promptCaching
                      ? isNight ? 'bg-night-amber' : 'bg-day-pink'
                      : 'bg-gray-300 dark:bg-night-surface'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.promptCaching ? 'translate-x-4' : ''}`} />
                </button>
              </section>

              {/* Actions */}
              <section className="pt-4 border-t border-current/10 space-y-2">
                <button
                  onClick={() => { if (confirm('恢复默认设置？API key 配置也会重置。')) resetSettings() }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <RotateCcw size={12} /> 恢复默认
                </button>
                <button
                  onClick={() => { if (confirm(`清空 ${messages.length} 条聊天？这不能撤销。`)) clearMessages() }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-red-500/80 hover:text-red-500 hover:bg-red-500/5"
                >
                  <Trash2 size={12} /> 清空对话（{messages.length} 条）
                </button>
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
