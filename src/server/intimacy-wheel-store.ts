import { randomInt, randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export type WheelActor = 'fire' | 'star'
export interface WheelOption { id: string; text: string; enabled: boolean; created_by: WheelActor; created_at: string; updated_at: string }
export interface WheelPool { id: string; name: string; emoji: string; options: WheelOption[] }
export interface WheelSpin { id: string; actor: WheelActor; results: Array<{ pool_id: string; pool: string; option_id: string; text: string }>; at: string }
interface WheelData { pools: WheelPool[]; recent: WheelSpin[] }

const FILE = resolveDataPath(getDataDir(), 'intimacy-wheel', 'wheel.json')
const seed: Array<[string, string, string, string[]]> = [
  ['position', '姿势', '🌙', ['面对面', '背后抱', '侧躺', '坐着', '站着']],
  ['lead', '主导', '👑', ['小火主导', '星星主导', '轮流主导', '都温柔一点', '都大胆一点']],
  ['scene', '场景', '🕯️', ['卧室', '沙发', '浴室', '镜子前', '临时布置一个秘密角落']],
  ['pace', '节奏', '🔥', ['慢慢磨', '由慢到快', '干脆直接', '停停走走', '让对方决定节奏']],
  ['rounds', '回合', '🎲', ['一回合', '两回合', '三回合', '不数次数', '先一次再决定']],
  ['warmup', '前戏', '💋', ['长吻', '按摩', '隔着衣服逗弄', '互相说想要什么', '蒙眼探索']],
  ['mood', '氛围', '✨', ['只开一盏灯', '放一张歌单', '安静听彼此', '洗完澡开始', '先喝点喜欢的东西']],
  ['prop', '衣物与道具', '🎀', ['只选一件好看的衣服', '眼罩', '丝带', '润滑剂', '今天不用道具']],
  ['aftercare', '收尾', '🫶', ['抱着休息', '一起洗澡', '喝水吃点东西', '说一句最喜欢的瞬间', '盖好被子聊天']],
]

function defaults(): WheelData {
  const at = new Date().toISOString()
  return {
    pools: seed.map(([id, name, emoji, values]) => ({
      id, name, emoji,
      options: values.map((text, index) => ({ id: `${id}-${index + 1}`, text, enabled: true, created_by: 'fire', created_at: at, updated_at: at })),
    })),
    recent: [],
  }
}

const options = {
  fallback: defaults,
  fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object' && Array.isArray((value as WheelData).pools),
}
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max)
const now = () => new Date().toISOString()

function mutate<T>(fn: (data: WheelData) => T): T {
  let result!: T
  updateJsonFile(FILE, options, data => { result = fn(data); return data })
  return result
}

function pool(data: WheelData, id: string): WheelPool {
  const found = data.pools.find(item => item.id === id)
  if (!found) throw new Error('元素池不存在')
  return found
}

export function readWheel(): WheelData { return readJsonFile(FILE, options) }

export function addWheelOption(poolId: string, value: unknown, actor: WheelActor): WheelOption {
  const text = clean(value, 160)
  if (!text) throw new Error('元素不能为空')
  return mutate(data => {
    const at = now()
    const option: WheelOption = { id: randomUUID(), text, enabled: true, created_by: actor, created_at: at, updated_at: at }
    pool(data, poolId).options.push(option)
    return option
  })
}

export function editWheelOption(poolId: string, optionId: string, patch: { text?: unknown; enabled?: unknown }): WheelOption {
  return mutate(data => {
    const option = pool(data, poolId).options.find(item => item.id === optionId)
    if (!option) throw new Error('元素不存在')
    if (patch.text !== undefined) {
      option.text = clean(patch.text, 160)
      if (!option.text) throw new Error('元素不能为空')
    }
    if (patch.enabled !== undefined) option.enabled = !!patch.enabled
    option.updated_at = now()
    return option
  })
}

export function deleteWheelOption(poolId: string, optionId: string): boolean {
  return mutate(data => {
    const options = pool(data, poolId).options
    const index = options.findIndex(item => item.id === optionId)
    if (index < 0) return false
    options.splice(index, 1)
    return true
  })
}

export function spinWheel(actor: WheelActor, poolIds?: unknown): WheelSpin {
  return mutate(data => {
    const wanted = Array.isArray(poolIds) ? new Set(poolIds.map(String)) : null
    const pools = data.pools.filter(item => !wanted || wanted.has(item.id))
    const results = pools.flatMap(item => {
      const active = item.options.filter(option => option.enabled)
      if (!active.length) return []
      const option = active[randomInt(active.length)]
      return [{ pool_id: item.id, pool: item.name, option_id: option.id, text: option.text }]
    })
    if (!results.length) throw new Error('没有可转的元素')
    const spin: WheelSpin = { id: randomUUID(), actor, results, at: now() }
    data.recent = [spin, ...(data.recent || [])].slice(0, 30)
    return spin
  })
}
