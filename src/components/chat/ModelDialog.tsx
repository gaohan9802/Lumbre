'use client'

/**
 * ModelDialog — 模型 API 管理弹窗。
 * 添加/删除 API、模型切换、输入/输出/缓存价格，全平台同步（经 /api/sync config 合并）。
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Download, Check, Power, Plus, Trash2 } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import {
  useChatStore,
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
  return `…${key.slice(-4)}`
}

export function ModelDialog({ open, onClose }: Props) {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const {
    settings,
    addApiProfile,
    updateApiProfile,
    deleteApiProfile,
    setActiveModel,
    setProviderModels,
    toggleModelEnabled,
    setAllModelsEnabled,
    addManualModel,
    updateModelMeta,
    deleteModel,
  } = useChatStore()

  const [addOpen, setAddOpen] = useState(false)
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  const [fetchStatus, setFetchStatus] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [editPriceKey, setEditPriceKey] = useState<string | null>(null) // `${profileId}:${modelId}`
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null)
  const [manualModel, setManualModel] = useState('')

  // add form
  const [newName, setNewName] = useState('')
  const [newProvider, setNewProvider] = useState<ApiProvider>('anthropic')
  const [newBaseUrl, setNewBaseUrl] = useState(DEFAULT_ANTHROPIC_BASE)
  const [newApiKey, setNewApiKey] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newInPrice, setNewInPrice] = useState('')
  const [newOutPrice, setNewOutPrice] = useState('')
  const [newCachePrice, setNewCachePrice] = useState('')

  const inputClass = `w-full text-sm px-3 py-2.5 rounded-lg outline-none border ${
    isNight ? 'bg-night-surface border-night-border text-night-text placeholder:text-night-muted' : 'bg-white border-gray-200 text-day-text placeholder:text-gray-300'
  }`
  const labelClass = 'text-xs opacity-60 block mb-1.5'

  const switchNewProvider = (p: ApiProvider) => {
    setNewProvider(p)
    setNewBaseUrl(p === 'anthropic' ? DEFAULT_ANTHROPIC_BASE : DEFAULT_OPENAI_BASE)
  }

  const numOrUndef = (s: string) => {
    const n = parseFloat(s)
    return isFinite(n) ? n : undefined
  }

  const createApi = () => {
    const fallbackModel = newProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'
    const modelId = newModel.trim() || fallbackModel
    addApiProfile({
      name: newName.trim() || (newProvider === 'anthropic' ? 'Anthropic' : 'New API'),
      provider: newProvider,
      baseUrl: (newBaseUrl.trim() || (newProvider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE : DEFAULT_OPENAI_BASE)).replace(/\/$/, ''),
      apiKey: newApiKey.trim(),
      defaultModel: modelId,
      models: [{
        id: modelId, name: modelId, enabled: true,
        inputPrice: numOrUndef(newInPrice), outputPrice: numOrUndef(newOutPrice), cachePrice: numOrUndef(newCachePrice),
      }],
    })
    setNewName(''); setNewApiKey(''); setNewModel(''); setNewInPrice(''); setNewOutPrice(''); setNewCachePrice('')
    setAddOpen(false)
  }

  const fetchModels = async (providerId: string) => {
    const p = settings.apiProfiles.find((x) => x.id === providerId)
    if (!p) return
    setFetchingId(providerId)
    setFetchStatus((prev) => { const next = { ...prev }; delete next[providerId]; return next })
    try {
      const data = await chat.models({ provider: p.provider, baseUrl: p.baseUrl, apiKey: p.apiKey })
      if (data.error) throw new Error(data.error)
      const rawModels = data.models || []
      if (rawModels.length === 0) throw new Error('API 返回了空模型列表。检查 Base URL 和 API Key 是否正确。')
      const models = rawModels.map((m: any) => ({
        id: m.id, name: m.name || m.id, ownedBy: m.ownedBy || m.owned_by, created: m.created, enabled: true,
      })).filter((m: any) => m.id)
      if (models.length === 0) throw new Error('API 返回了模型但格式无法解析。')
      setProviderModels(providerId, models, true)
      setFetchStatus((prev) => ({ ...prev, [providerId]: { ok: true, text: `✓ 成功拉取 ${models.length} 个模型` } }))
    } catch (err: any) {
      setFetchStatus((prev) => ({ ...prev, [providerId]: { ok: false, text: err?.message || '拉取失败' } }))
    } finally {
      setFetchingId(null)
    }
  }

  const fmtPrice = (v?: number) => (typeof v === 'number' ? `$${v}` : '—')

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            className={`fixed z-[71] inset-x-0 mx-auto w-[min(560px,calc(100vw-2rem))] max-h-[80dvh] overflow-y-auto rounded-2xl shadow-2xl ${isNight ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}
            style={{ top: 'max(calc(env(safe-area-inset-top, 0px) + 10dvh), 10dvh)' }}
          >
            <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between backdrop-blur-md bg-inherit border-b border-current/10">
              <h3 className="text-lg font-medium">模型 API 管理</h3>
              <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* API / model list */}
              {settings.apiProfiles.map((p) => {
                const isActiveProfile = p.id === settings.activeProfileId
                const expanded = expandedProfile === p.id
                return (
                  <div key={p.id} className={`rounded-xl border ${isActiveProfile ? (isNight ? 'border-night-amber' : 'border-day-text') : (isNight ? 'border-night-border' : 'border-gray-200')}`}>
                    <div className="px-4 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setExpandedProfile(expanded ? null : p.id)}>
                        <div className="text-sm font-medium truncate">
                          {p.name}{isActiveProfile && <span className="ml-2 text-xs opacity-60">· 在用</span>}
                        </div>
                        <div className="text-xs opacity-40 truncate mt-0.5">{p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'} · {maskKey(p.apiKey)} · {p.models.filter((m) => m.enabled).length} 模型</div>
                      </div>
                      <button
                        onClick={() => { if (confirm(`删除 API「${p.name}」？`)) deleteApiProfile(p.id) }}
                        className={`text-xs px-3 py-1.5 rounded-lg border flex-shrink-0 ${isNight ? 'border-night-border hover:bg-night-surface' : 'border-gray-300 hover:bg-gray-100'}`}
                      >删除</button>
                    </div>

                    {/* models under this API */}
                    <div className="px-3 pb-3 space-y-1">
                      {p.models.filter((m) => m.enabled || expanded).map((m) => {
                        const active = isActiveProfile && settings.model === m.id
                        const priceKey = `${p.id}:${m.id}`
                        return (
                          <div key={m.id} className={`rounded-lg px-2.5 py-2 ${active ? (isNight ? 'bg-night-amber/15' : 'bg-day-pinkLight/60') : (isNight ? 'bg-night-surface/60' : 'bg-white')}`}>
                            <div className="flex items-center gap-2">
                              {expanded && (
                                <button onClick={() => toggleModelEnabled(p.id, m.id)} className={`p-1 rounded flex-shrink-0 ${m.enabled ? (isNight ? 'text-night-amber' : 'text-day-pink') : 'opacity-30'}`} title={m.enabled ? '已启用' : '已停用'}>
                                  <Power size={13} />
                                </button>
                              )}
                              <button onClick={() => setActiveModel(p.id, m.id)} className="flex-1 min-w-0 text-left">
                                <div className="text-xs font-medium truncate">{m.name || m.id}</div>
                                <div className="text-[10px] opacity-40 truncate">{m.id}</div>
                              </button>
                              {active && <Check size={15} className={`flex-shrink-0 ${isNight ? 'text-night-amber' : 'text-day-pink'}`} />}
                              {expanded && (
                                <button
                                  disabled={p.models.length <= 1}
                                  onClick={() => { if (confirm(`删除模型「${m.name || m.id}」？此操作不会删除整个 API。`)) deleteModel(p.id, m.id) }}
                                  className="p-1 text-red-500/60 hover:text-red-500 disabled:opacity-20 disabled:cursor-not-allowed"
                                  title={p.models.length <= 1 ? '每个 API 至少保留一个模型' : '删除这个模型'}
                                ><Trash2 size={13} /></button>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 pl-1 text-[10px] opacity-60">
                              <span>输入 {fmtPrice(m.inputPrice)}/1M</span>
                              <span>输出 {fmtPrice(m.outputPrice)}/1M</span>
                              <span>缓存 {fmtPrice(m.cachePrice)}/1M</span>
                              <button onClick={() => setEditPriceKey(editPriceKey === priceKey ? null : priceKey)} className="underline opacity-80 hover:opacity-100">{editPriceKey === priceKey ? '收起' : '改价'}</button>
                            </div>
                            {editPriceKey === priceKey && (
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                {(['inputPrice', 'outputPrice', 'cachePrice'] as const).map((k, i) => (
                                  <div key={k}>
                                    <label className="text-[10px] opacity-50 block mb-1">{['输入价/1M', '输出价/1M', '缓存价/1M'][i]}</label>
                                    <input
                                      type="number" step="any" min="0"
                                      defaultValue={m[k] ?? ''}
                                      onBlur={(e) => updateModelMeta(p.id, m.id, { [k]: numOrUndef(e.target.value) })}
                                      className={`w-full text-xs px-2 py-1.5 rounded-lg outline-none border ${isNight ? 'bg-night-surface border-night-border' : 'bg-white border-gray-200'}`}
                                      placeholder="$"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {expanded && (
                      <div className="px-4 pb-4 space-y-2 border-t border-current/5 pt-3">
                        <div className="flex gap-2 mb-2">
                          <button
                            onClick={() => setAllModelsEnabled(p.id, true)}
                            className={`px-3 py-1.5 rounded-lg text-xs ${isNight ? 'bg-night-surface hover:bg-night-amber/15' : 'bg-gray-100 hover:bg-gray-200'}`}
                          >一键全选</button>
                          <button
                            onClick={() => setAllModelsEnabled(p.id, false)}
                            className={`px-3 py-1.5 rounded-lg text-xs ${isNight ? 'bg-night-surface hover:bg-night-amber/15' : 'bg-gray-100 hover:bg-gray-200'}`}
                          >一键反选</button>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          <input className={inputClass} value={p.name} placeholder="名称" onChange={(e) => updateApiProfile(p.id, { name: e.target.value })} />
                          <input className={inputClass} value={p.baseUrl} placeholder="Base URL" onChange={(e) => updateApiProfile(p.id, { baseUrl: e.target.value })} />
                          <input className={`${inputClass} font-mono`} type="password" value={p.apiKey} placeholder="API Key" onChange={(e) => updateApiProfile(p.id, { apiKey: e.target.value })} />
                        </div>
                        <div className="flex gap-2">
                          <input
                            className={`${inputClass} font-mono flex-1`}
                            value={manualModel}
                            placeholder="手动添加模型 ID"
                            onChange={(e) => setManualModel(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && manualModel.trim()) { addManualModel(p.id, manualModel); setManualModel('') } }}
                          />
                          <button onClick={() => { if (manualModel.trim()) { addManualModel(p.id, manualModel); setManualModel('') } }} className={`px-3 rounded-lg text-xs flex-shrink-0 ${isNight ? 'bg-night-surface' : 'bg-gray-100'}`}>添加</button>
                          <button disabled={fetchingId === p.id} onClick={() => fetchModels(p.id)} className={`px-3 rounded-lg text-xs flex items-center gap-1 flex-shrink-0 ${isNight ? 'bg-night-surface' : 'bg-gray-100'} disabled:opacity-50`}>
                            <Download size={11} /> {fetchingId === p.id ? '拉取中' : '拉取'}
                          </button>
                        </div>
                        {fetchStatus[p.id] && (
                          <div className={`text-xs whitespace-pre-wrap ${fetchStatus[p.id].ok ? (isNight ? 'text-night-amber' : 'text-green-600') : 'text-day-error dark:text-night-error'}`}>
                            {fetchStatus[p.id].text}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* add API */}
              <div className="pt-2 border-t border-current/10">
                <button onClick={() => setAddOpen(!addOpen)} className="flex items-center gap-2 text-base font-medium py-2">
                  <Plus size={18} /> 添加 API
                </button>

                {addOpen && (
                  <div className="space-y-3 mt-2">
                    <div>
                      <label className={labelClass}>名称</label>
                      <input className={inputClass} value={newName} placeholder="例如 玖时·Opus" onChange={(e) => setNewName(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelClass}>供应商</label>
                      <select className={inputClass} value={newProvider} onChange={(e) => switchNewProvider(e.target.value as ApiProvider)}>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="openai-compatible">OpenAI 兼容</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>API Base URL</label>
                      <input className={inputClass} value={newBaseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setNewBaseUrl(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelClass}>API Key</label>
                      <input className={`${inputClass} font-mono`} type="password" value={newApiKey} placeholder="sk-…" onChange={(e) => setNewApiKey(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelClass}>模型名</label>
                      <input className={`${inputClass} font-mono`} value={newModel} placeholder="claude-opus-4-6-thinking" onChange={(e) => setNewModel(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={labelClass}>输入价 /1M</label>
                        <input type="number" step="any" min="0" className={inputClass} value={newInPrice} placeholder="$" onChange={(e) => setNewInPrice(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>输出价 /1M</label>
                        <input type="number" step="any" min="0" className={inputClass} value={newOutPrice} placeholder="$" onChange={(e) => setNewOutPrice(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>缓存价 /1M</label>
                        <input type="number" step="any" min="0" className={inputClass} value={newCachePrice} placeholder="$" onChange={(e) => setNewCachePrice(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex gap-2 pb-2">
                      <button onClick={createApi} className={`px-4 py-2.5 rounded-lg text-sm ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-text text-white'}`}>保存</button>
                      <button onClick={() => setAddOpen(false)} className="px-4 py-2.5 rounded-lg text-sm opacity-60 hover:opacity-100">取消</button>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-[10px] opacity-40 pb-2">点击 API 卡片标题可展开编辑 / 启停模型 / 拉取模型列表。配置会自动同步到所有设备。</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
