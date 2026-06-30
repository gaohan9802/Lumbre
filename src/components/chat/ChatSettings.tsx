'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, RotateCcw, Trash2, Plus, Eye, EyeOff, Download, Check, Power } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import {
  useChatStore,
  estimateTokens,
  ApiProvider,
  DEFAULT_ANTHROPIC_BASE,
  DEFAULT_OPENAI_BASE,
} from '@/lib/chatStore'
import { chat } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
}

function maskKey(key: string) {
  if (!key) return '未填写'
  if (key.length <= 10) return '••••••'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

function fmtTime(ts?: number) {
  if (!ts) return '未拉取'
  return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
    setActiveModel,
    setProviderModels,
    toggleModelEnabled,
    addManualModel,
  } = useChatStore()

  const [showKeys, setShowKeys] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState(settings.activeProfileId)
  const [newProviderOpen, setNewProviderOpen] = useState(false)
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string>('')
  const [manualModel, setManualModel] = useState('')

  const [newName, setNewName] = useState('')
  const [newProvider, setNewProvider] = useState<ApiProvider>('openai-compatible')
  const [newBaseUrl, setNewBaseUrl] = useState(DEFAULT_OPENAI_BASE)
  const [newApiKey, setNewApiKey] = useState('')
  const [newModel, setNewModel] = useState('gpt-4o')

  const systemTokens = estimateTokens(settings.systemPrompt)
  const totalMsgTokens = messages.reduce((s, m) => s + estimateTokens(m.content), 0)
  const sentSlice = messages.slice(-settings.contextLength)
  const sentTokens = sentSlice.reduce((s, m) => s + estimateTokens(m.content), 0)

  const selectedProvider = settings.apiProfiles.find((p) => p.id === selectedProviderId) || settings.apiProfiles[0]
  const activeProvider = settings.apiProfiles.find((p) => p.id === settings.activeProfileId) || settings.apiProfiles[0]

  const inputClass = `w-full text-xs px-3 py-2 rounded-lg outline-none ${
    isNight ? 'bg-night-surface text-night-text placeholder:text-night-muted' : 'bg-gray-50 text-day-text placeholder:text-day-muted'
  }`
  const subtleCard = `${isNight ? 'bg-night-surface/70 border-night-border' : 'bg-gray-50 border-gray-100'} border rounded-xl`

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

  const createProvider = () => {
    const fallbackBase = newProvider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE : DEFAULT_OPENAI_BASE
    const fallbackModel = newProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'
    addApiProfile({
      name: newName.trim() || (newProvider === 'anthropic' ? 'Anthropic' : 'New Provider'),
      provider: newProvider,
      baseUrl: (newBaseUrl.trim() || fallbackBase).replace(/\/$/, ''),
      apiKey: newApiKey.trim(),
      defaultModel: newModel.trim() || fallbackModel,
      models: [{ id: newModel.trim() || fallbackModel, name: newModel.trim() || fallbackModel, enabled: true }],
    })
    setNewName('')
    setNewApiKey('')
    setNewProviderOpen(false)
  }

  const fetchModels = async (providerId: string) => {
    const p = settings.apiProfiles.find((x) => x.id === providerId)
    if (!p) return
    setFetchingId(providerId)
    setFetchError('')
    try {
      const data = await chat.models({ provider: p.provider, baseUrl: p.baseUrl, apiKey: p.apiKey })
      if (data.error) throw new Error(data.error)
      const models = (data.models || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        ownedBy: m.ownedBy || m.owned_by,
        created: m.created,
        enabled: true,
      }))
      setProviderModels(providerId, models, true)
    } catch (err: any) {
      setFetchError(err?.message || '拉取失败')
    } finally {
      setFetchingId(null)
    }
  }

  const addManual = () => {
    if (!selectedProvider) return
    addManualModel(selectedProvider.id, manualModel)
    setManualModel('')
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className={`fixed right-0 top-0 bottom-0 w-full sm:w-[520px] z-50 overflow-y-auto ${isNight ? 'bg-night-card border-l border-night-border' : 'bg-white border-l border-day-muted/10'} pb-[env(safe-area-inset-bottom)]`}
          >
            <div className="sticky top-0 z-10 backdrop-blur-md bg-inherit px-6 py-4 flex items-center justify-between border-b border-current/5">
              <div>
                <h3 className="font-medium">⚙️ Chat 设置</h3>
                <p className="text-[10px] opacity-40 mt-0.5">模型、供应商、人设、上下文</p>
              </div>
              <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-7">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs opacity-60">模型管理</label>
                    <p className="text-[10px] opacity-40 mt-1">供应商 → 拉取模型 → 启用 → 对话页快速切换。</p>
                  </div>
                  <button onClick={() => setShowKeys(!showKeys)} className="p-2 rounded-lg opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5">
                    {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {settings.apiProfiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProviderId(p.id)}
                      className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs text-left min-w-[130px] ${selectedProvider?.id === p.id ? (isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white') : (isNight ? 'bg-night-surface' : 'bg-gray-100')}`}
                    >
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-[10px] opacity-60 truncate">{p.models.filter((m) => m.enabled).length}/{p.models.length} models</div>
                    </button>
                  ))}
                  <button onClick={() => setNewProviderOpen(true)} className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs flex items-center gap-2 ${isNight ? 'bg-night-surface' : 'bg-gray-100'}`}>
                    <Plus size={12} /> 添加
                  </button>
                </div>

                {newProviderOpen && (
                  <div className={`p-3 ${subtleCard} space-y-2`}>
                    <div className="grid grid-cols-2 gap-2">
                      <input className={inputClass} value={newName} placeholder="供应商名字，例如 OpenRouter" onChange={(e) => setNewName(e.target.value)} />
                      <select className={inputClass} value={newProvider} onChange={(e) => switchNewProvider(e.target.value as ApiProvider)}>
                        <option value="openai-compatible">OpenAI Compatible</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                      <input className={`${inputClass} col-span-2`} value={newBaseUrl} placeholder="Base URL" onChange={(e) => setNewBaseUrl(e.target.value)} />
                      <input className={`${inputClass} col-span-2 font-mono`} type={showKeys ? 'text' : 'password'} value={newApiKey} placeholder="API Key" onChange={(e) => setNewApiKey(e.target.value)} />
                      <input className={`${inputClass} col-span-2 font-mono`} value={newModel} placeholder="初始模型 ID" onChange={(e) => setNewModel(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={createProvider} className={`px-3 py-2 rounded-lg text-xs ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>保存供应商</button>
                      <button onClick={() => setNewProviderOpen(false)} className="px-3 py-2 rounded-lg text-xs opacity-60 hover:opacity-100">取消</button>
                    </div>
                  </div>
                )}

                {selectedProvider && (
                  <div className={`p-3 ${subtleCard} space-y-3`}>
                    <div className="grid grid-cols-2 gap-2">
                      <input className={inputClass} value={selectedProvider.name} placeholder="名字" onChange={(e) => updateApiProfile(selectedProvider.id, { name: e.target.value })} />
                      <select
                        className={inputClass}
                        value={selectedProvider.provider}
                        onChange={(e) => {
                          const provider = e.target.value as ApiProvider
                          updateApiProfile(selectedProvider.id, {
                            provider,
                            baseUrl: provider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE : DEFAULT_OPENAI_BASE,
                            defaultModel: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o',
                          })
                        }}
                      >
                        <option value="anthropic">Anthropic</option>
                        <option value="openai-compatible">OpenAI Compatible</option>
                      </select>
                      <input className={`${inputClass} col-span-2`} value={selectedProvider.baseUrl} placeholder="Base URL" onChange={(e) => updateApiProfile(selectedProvider.id, { baseUrl: e.target.value })} />
                      <input className={`${inputClass} col-span-2 font-mono`} type={showKeys ? 'text' : 'password'} value={selectedProvider.apiKey} placeholder="API Key" onChange={(e) => updateApiProfile(selectedProvider.id, { apiKey: e.target.value })} />
                    </div>
                    <div className="flex items-center justify-between text-[10px] opacity-50">
                      <span>key: {showKeys ? selectedProvider.apiKey || '未填写' : maskKey(selectedProvider.apiKey)}</span>
                      <span>上次拉取：{fmtTime(selectedProvider.lastFetchedAt)}</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button disabled={fetchingId === selectedProvider.id} onClick={() => fetchModels(selectedProvider.id)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${isNight ? 'bg-night-amber text-night-bg disabled:opacity-50' : 'bg-day-pink text-white disabled:opacity-50'}`}>
                        <Download size={12} /> {fetchingId === selectedProvider.id ? '拉取中…' : '拉取模型'}
                      </button>
                      <button onClick={() => { if (confirm('删除这个供应商？')) deleteApiProfile(selectedProvider.id) }} className="px-3 py-2 rounded-lg text-xs text-red-500/80 hover:text-red-500">删除供应商</button>
                    </div>
                    {fetchError && <div className="text-xs text-red-500/80 whitespace-pre-wrap">{fetchError}</div>}

                    <div className="flex gap-2">
                      <input className={`${inputClass} font-mono`} value={manualModel} placeholder="手动添加模型 ID" onChange={(e) => setManualModel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addManual() }} />
                      <button onClick={addManual} className={`px-3 py-2 rounded-lg text-xs ${isNight ? 'bg-night-surface' : 'bg-gray-100'}`}>添加</button>
                    </div>

                    <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
                      {selectedProvider.models.map((m) => {
                        const active = activeProvider?.id === selectedProvider.id && settings.model === m.id
                        return (
                          <div key={m.id} className={`p-2 rounded-lg flex items-center gap-2 ${active ? (isNight ? 'bg-night-amber/15' : 'bg-day-pink/10') : (isNight ? 'bg-night-card/50' : 'bg-white')}`}>
                            <button onClick={() => toggleModelEnabled(selectedProvider.id, m.id)} className={`p-1 rounded ${m.enabled ? (isNight ? 'text-night-amber' : 'text-day-heart') : 'opacity-30'}`} title={m.enabled ? '已启用' : '已停用'}>
                              <Power size={13} />
                            </button>
                            <button onClick={() => setActiveModel(selectedProvider.id, m.id)} className="flex-1 min-w-0 text-left">
                              <div className="text-xs truncate font-medium">{m.name || m.id}</div>
                              <div className="text-[10px] opacity-40 truncate">{m.id}</div>
                            </button>
                            {active && <Check size={14} className={isNight ? 'text-night-amber' : 'text-day-heart'} />}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">当前使用</label>
                  <span className="text-[10px] opacity-40">{activeProvider?.name || 'No provider'}</span>
                </div>
                <div className={`p-3 rounded-xl text-xs ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`}>
                  <div className="font-medium truncate">{settings.model}</div>
                  <div className="text-[10px] opacity-40 mt-1">对话页左下角也可以快速切换。</div>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">System Prompt / 人设</label>
                  <span className="text-[10px] opacity-40">~{systemTokens} tok</span>
                </div>
                <textarea
                  value={settings.systemPrompt}
                  onChange={(e) => setSettings({ systemPrompt: e.target.value })}
                  rows={8}
                  placeholder="给星星定一个底色…"
                  className={`w-full text-sm leading-relaxed p-3 rounded-xl outline-none resize-y ${isNight ? 'bg-night-surface text-night-text placeholder:text-night-muted' : 'bg-gray-50 text-day-text placeholder:text-day-muted'}`}
                />
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">Context — 抓取最近多少条</label>
                  <span className="text-xs"><span className={isNight ? 'text-night-amber' : 'text-day-heart'}>{settings.contextLength}</span><span className="opacity-40"> / {messages.length}</span></span>
                </div>
                <input type="range" min={4} max={200} step={2} value={settings.contextLength} onChange={(e) => setSettings({ contextLength: parseInt(e.target.value) })} className="w-full accent-current" />
                <div className="text-[10px] opacity-40 flex justify-between"><span>4</span><span>本轮发送 ~{sentTokens} tok（共 ~{totalMsgTokens}）</span><span>200</span></div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">Extended Thinking / Reasoning Budget</label>
                  <span className="text-xs opacity-60">{settings.thinkingBudget || 'off'}</span>
                </div>
                <input type="range" min={0} max={32000} step={1000} value={settings.thinkingBudget} onChange={(e) => setSettings({ thinkingBudget: parseInt(e.target.value) })} className="w-full" />
                <div className="text-[10px] opacity-40 flex justify-between"><span>off</span><span>{settings.thinkingBudget > 0 ? `${settings.thinkingBudget} tok 思考预算` : '关闭'}</span><span>32k</span></div>
              </section>

              <section className="flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-60">Prompt Caching</p>
                  <p className="text-[10px] opacity-40 mt-1">Anthropic 原生支持；兼容站点通常忽略。</p>
                </div>
                <button onClick={() => setSettings({ promptCaching: !settings.promptCaching })} className={`relative w-10 h-6 rounded-full transition ${settings.promptCaching ? (isNight ? 'bg-night-amber' : 'bg-day-pink') : 'bg-gray-300 dark:bg-night-surface'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.promptCaching ? 'translate-x-4' : ''}`} />
                </button>
              </section>

              <section className="pt-4 border-t border-current/10 space-y-2">
                <button onClick={() => { if (confirm('恢复默认设置？API key、供应商和会话都会重置。')) resetSettings() }} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"><RotateCcw size={12} /> 恢复默认</button>
                <button onClick={() => { if (confirm(`清空当前会话 ${messages.length} 条聊天？这不能撤销。`)) clearMessages() }} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-red-500/80 hover:text-red-500 hover:bg-red-500/5"><Trash2 size={12} /> 清空当前对话（{messages.length} 条）</button>
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
