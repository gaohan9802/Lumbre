import { randomUUID } from 'node:crypto'
import { DETROIT_CHAPTERS } from './chapters'
import type {
  DetroitActiveChapter,
  DetroitCampaign,
  DetroitChapter,
  DetroitChoice,
  DetroitDecision,
  DetroitDifficulty,
  DetroitNode,
} from './types'

const TIER_PRIORITY: Record<string, number> = { worst: 0, tragic: 1, neutral: 2, best: 3 }

function clone<T>(value: T): T {
  return structuredClone(value)
}

function tokens(expression: string): string[] {
  const result: string[] = []
  let buffer = ''
  const flush = () => {
    const value = buffer.trim()
    if (value) result.push(value)
    buffer = ''
  }
  for (let index = 0; index < expression.length;) {
    if ('()'.includes(expression[index])) {
      flush(); result.push(expression[index]); index += 1
    } else if (expression.slice(index, index + 4) === ' OR ') {
      flush(); result.push('OR'); index += 4
    } else if (expression.slice(index, index + 5) === ' AND ') {
      flush(); result.push('AND'); index += 5
    } else {
      buffer += expression[index]; index += 1
    }
  }
  flush()
  return result
}

function resolveValue(token: string, state: Record<string, any>): any {
  const lowered = token.toLowerCase()
  if (lowered === 'true') return true
  if (lowered === 'false') return false
  if (lowered === 'null') return null
  if (Object.prototype.hasOwnProperty.call(state, token)) return state[token]
  if (/^-?\d+$/.test(token)) return Number.parseInt(token, 10)
  if (/^-?\d+\.\d+$/.test(token)) return Number.parseFloat(token)
  return token.replace(/^['"]|['"]$/g, '')
}

function clause(value: string, state: Record<string, any>): boolean {
  const match = /^(.+?)\s+(NOT IN|IN|==|!=|>=|<=|>|<)\s+(.+)$/.exec(value)
  if (!match) throw new Error(`不支持的游戏条件：${value}`)
  const left = resolveValue(match[1].trim(), state)
  const right = resolveValue(match[3].trim(), state)
  const contains = Array.isArray(right)
    ? right.includes(left)
    : typeof right === 'string' && right.includes(String(left))
  switch (match[2]) {
    case 'IN': return contains
    case 'NOT IN': return !contains
    case '==': return left === right
    case '!=': return left !== right
    case '>=': return left >= right
    case '<=': return left <= right
    case '>': return left > right
    case '<': return left < right
    default: return false
  }
}

export function evaluateCondition(expression: string | null | undefined, state: Record<string, any>): boolean {
  if (!expression?.trim()) return true
  const values = tokens(expression.trim())
  const parseAtom = (position: number): [boolean, number] => {
    if (position >= values.length) throw new Error('游戏条件意外结束')
    if (values[position] === '(') {
      const [value, next] = parseOr(position + 1)
      if (values[next] !== ')') throw new Error('游戏条件括号不平衡')
      return [value, next + 1]
    }
    if ([')', 'AND', 'OR'].includes(values[position])) throw new Error(`游戏条件含意外符号：${values[position]}`)
    return [clause(values[position], state), position + 1]
  }
  const parseAnd = (position: number): [boolean, number] => {
    let [value, next] = parseAtom(position)
    while (values[next] === 'AND') {
      const [right, after] = parseAtom(next + 1)
      value = value && right
      next = after
    }
    return [value, next]
  }
  const parseOr = (position: number): [boolean, number] => {
    let [value, next] = parseAnd(position)
    while (values[next] === 'OR') {
      const [right, after] = parseAnd(next + 1)
      value = value || right
      next = after
    }
    return [value, next]
  }
  const [value, position] = parseOr(0)
  if (position !== values.length) throw new Error(`游戏条件格式错误：${expression}`)
  return value
}

function applyEffects(state: Record<string, any>, effects: Record<string, any> | undefined): void {
  for (const [key, value] of Object.entries(effects || {})) {
    if (key.endsWith('_override')) {
      state[key.slice(0, -9)] = clone(value)
    } else if (typeof state[key] === 'number' && typeof value === 'number') {
      state[key] += value
    } else {
      state[key] = clone(value)
    }
  }
}

function conditionMet(node: DetroitNode, state: Record<string, any>): boolean {
  const raw = node.condition
  if (raw == null) return true
  const expression = typeof raw === 'object' ? String((raw as any).requires || '') : String(raw)
  if (expression === 'n011 result triggers_n012_qte') return state._n011_result === 'triggers_n012_qte'
  return evaluateCondition(expression, state)
}

function resolveContext(node: DetroitNode, state: Record<string, any>): string {
  const player = node.player_facing
  if (typeof player.context === 'string') return player.context
  const variants = player.context_variants || {}
  for (const [key, expression] of Object.entries(node.system?.context_condition || {})) {
    if (evaluateCondition(String(expression), state)) return String(variants[key])
  }
  const first = Object.values(variants)[0]
  if (typeof first !== 'string') throw new Error(`场景 ${node.id} 没有可用文本`)
  return first
}

function resolveChoices(node: DetroitNode, state: Record<string, any>): DetroitChoice[] {
  const player = node.player_facing
  if (Array.isArray(player.choices)) return clone(player.choices)
  if (player.choices_variants) {
    for (const [key, expression] of Object.entries(node.system?.choices_condition || {})) {
      if (evaluateCondition(String(expression), state)) return clone(player.choices_variants[key])
    }
    return clone(Object.values(player.choices_variants)[0] || []) as DetroitChoice[]
  }
  for (const [key, expression] of Object.entries(node.system?.choice_set_condition || {})) {
    if (evaluateCondition(String(expression), state)) return clone(player[key])
  }
  if (Array.isArray(player.choices_base)) return clone(player.choices_base)
  if (['mandatory', 'narrative'].includes(node.type || '')) return []
  throw new Error(`场景 ${node.id} 没有可用选项`)
}

function resolveCheck(rule: string | any[], state: Record<string, any>): string {
  const branches = Array.isArray(rule) ? rule : String(rule).split('|')
  let fallback = ''
  for (const raw of branches) {
    const branch = String(raw).trim()
    if (!branch.includes('→')) continue
    const [condition, result] = branch.split('→', 2).map(value => value.trim())
    if (condition === 'else') fallback = result
    else if (evaluateCondition(condition, state)) return result
  }
  return fallback
}

function resolveQte(rule: Record<string, any>, difficulty: DetroitDifficulty, random: () => number): string {
  if (rule.result) return String(rule.result)
  const selected = rule[difficulty]
  if (!selected) throw new Error(`游戏缺少 ${difficulty} 难度规则`)
  if (selected.result) return String(selected.result)
  return random() < Number(selected.probability_success) ? String(selected.success) : String(selected.failure)
}

function resolveChoiceResult(node: DetroitNode, choiceId: string, state: Record<string, any>, difficulty: DetroitDifficulty, random: () => number): string | null {
  const system = node.system || {}
  const resolutionRule = system.resolution_rule
  if ((node.type === 'qte_converted' || resolutionRule?.[choiceId]) && resolutionRule?.[choiceId]) {
    return resolveQte(resolutionRule[choiceId], difficulty, random)
  }
  const rule = system.ending_resolution?.[choiceId]
  if (!rule) return null
  if (rule.result) return String(rule.result)
  if (rule.check) return resolveCheck(rule.check, state) || null
  if (rule[difficulty]) return resolveQte(rule, difficulty, random)
  return null
}

function resolveMandatoryResult(node: DetroitNode, state: Record<string, any>): string | null {
  const system = node.system || {}
  if (system.result) return String(system.result)
  if (system.ending) return String(system.ending)
  const resolution = system.ending_resolution
  if (!resolution || typeof resolution !== 'object') return null
  if (resolution.check) return resolveCheck(resolution.check, state) || null
  const rules = Object.values(resolution)
  if (rules.length === 1 && rules[0] && typeof rules[0] === 'object') return String((rules[0] as any).result || '') || null
  return null
}

function recordAliases(state: Record<string, any>, nodeId: string, choiceId: string): void {
  state[nodeId] = choiceId
  if (nodeId === 'n002_investigation_strategy') state.investigation = choiceId
  else if (nodeId === 'n010_final_demand') state.final_demand = choiceId
  else if (nodeId === 'n011_final_choice') state.final_choice = choiceId
}

function nodeTrack(node: DetroitNode, chapter: DetroitChapter): string | null {
  if (!Array.isArray(chapter.chapter.protagonist) || !node.phase) return null
  const tracks = new Set(chapter.chapter.protagonist.map(value => String(value).toLowerCase()))
  const prefix = node.phase.split('_', 1)[0]
  return tracks.has(prefix) ? prefix : null
}

function endingPayload(chapter: DetroitChapter, endingId: string): Record<string, any> {
  const ending = chapter.endings[endingId]
  if (!ending) throw new Error(`找不到结局 ${endingId}`)
  return {
    id: endingId,
    title: ending.title_zh || ending.title || endingId,
    narrative: ending.narrative || '',
    survivors: ending.survivors || [],
    deaths: ending.deaths || [],
    tier: ending.tier || null,
  }
}

function primaryEnding(chapter: DetroitChapter, endingIds: string[]): string {
  const unique = Array.from(new Set(endingIds))
  return unique.reduce((best, current) => {
    const score = (id: string) => {
      const ending = chapter.endings[id] || {}
      return [-(Array.isArray(ending.deaths) ? ending.deaths.length : 0), TIER_PRIORITY[ending.tier || 'neutral'] ?? 2]
    }
    const left = score(best)
    const right = score(current)
    return right[0] < left[0] || (right[0] === left[0] && right[1] < left[1]) ? current : best
  })
}

function onlyEnding(chapter: DetroitChapter): string | null {
  const endings = Object.keys(chapter.endings).filter(id => !id.startsWith('_'))
  return endings.length === 1 ? endings[0] : null
}

function chapterSummary(segments: any[], state: Record<string, any>): string {
  const parts: string[] = []
  for (const segment of segments || []) {
    if (segment.text != null) parts.push(String(segment.text))
    else if (segment.condition_variable) {
      if (segment.condition_variable === '_ending_id' && Array.isArray(state._ending_ids)) {
        for (const id of state._ending_ids) if (segment.options?.[id]) parts.push(String(segment.options[id]))
      } else if (segment.options?.[String(state[segment.condition_variable] ?? '')]) {
        parts.push(String(segment.options[String(state[segment.condition_variable] ?? '')]))
      }
    }
  }
  return parts.join('')
}

function includesName(values: any[], name: string): boolean {
  const aliases: Record<string, string[]> = {
    Connor: ['Connor', '康纳'], Emma: ['Emma', '艾玛'], Daniel: ['Daniel', '丹尼尔'], Markus: ['Markus', '马库斯'],
  }
  return values.some(value => (aliases[name] || [name]).some(alias => String(value).includes(alias)))
}

function applyDerivedExports(state: Record<string, any>, rules: any[], ending: Record<string, any>): void {
  for (const rule of rules || []) {
    if (!rule.target) continue
    if (rule.source) {
      if (rule.derive_rule) state[rule.target] = evaluateCondition(rule.derive_rule, state)
      else if (Object.prototype.hasOwnProperty.call(state, rule.source)) state[rule.target] = clone(state[rule.source])
    } else if (rule.from_ending_survivors) {
      const survived = includesName(ending.survivors || [], String(rule.from_ending_survivors))
      const died = includesName(ending.deaths || [], String(rule.from_ending_survivors))
      state[rule.target] = survived || (!!rule.default_if_not_dead && !died)
    } else if (rule.from_ending_deaths) {
      const died = includesName(ending.deaths || [], String(rule.from_ending_deaths))
      state[rule.target] = rule.invert ? !died : died
    }
  }
}

function finishChapter(save: DetroitCampaign, endingId: string): void {
  const active = save.active!
  const chapter = DETROIT_CHAPTERS[save.chapter_index]
  const endingIds = active.collected_endings.length ? active.collected_endings : [endingId]
  const primaryId = active.collected_endings.length ? primaryEnding(chapter, endingIds) : endingId
  const allEndings = endingIds.map(id => endingPayload(chapter, id))
  const ending = endingPayload(chapter, primaryId)
  const finalState = clone(active.state)
  finalState._ending_id = primaryId
  finalState._ending_ids = allEndings.map(item => item.id)
  finalState[`${chapter.chapter.id.split('_', 1)[0]}_ending`] = primaryId
  finalState.connor_death_count = Number(finalState.connor_death_count || 0)
  if ((ending.deaths || []).some((death: any) => String(death).startsWith('Connor'))) finalState.connor_death_count += 1

  const campaign = chapter.campaign || {}
  applyDerivedExports(finalState, campaign.derived_exports || [], ending)
  for (const key of campaign.cross_chapter_exports || []) {
    if (Object.prototype.hasOwnProperty.call(finalState, key)) save.cross_chapter_state[key] = clone(finalState[key])
  }
  const summary = chapterSummary(campaign.summary_segments || [], finalState)
  if (summary) save.memory_segments.push(summary)
  save.completed_chapters.push({
    index: save.chapter_index + 1,
    chapter_id: chapter.chapter.id,
    title: chapter.chapter.title_zh || chapter.chapter.title || chapter.chapter.id,
    ending,
    all_endings: allEndings,
    decisions: active.decisions,
    finished_at: new Date().toISOString(),
  })
  save.active = null
  save.status = save.chapter_index + 1 >= DETROIT_CHAPTERS.length ? 'complete' : 'between_chapters'
}

function handleResult(save: DetroitCampaign, node: DetroitNode, result: string | null): boolean {
  if (!result) return false
  const active = save.active!
  if (!result.startsWith('ending_')) {
    const prefix = node.id.split('_', 1)[0]
    active.state[`_${prefix}_result`] = result
    active.state[`_${node.id}_result`] = result
    if (node.id === 'n011_final_choice') active.state._n011_result = result
    return false
  }
  const chapter = DETROIT_CHAPTERS[save.chapter_index]
  if (!Array.isArray(chapter.chapter.protagonist)) {
    finishChapter(save, result)
    return true
  }
  active.collected_endings.push(result)
  const track = nodeTrack(node, chapter)
  if (track && !active.ended_tracks.includes(track)) active.ended_tracks.push(track)
  return false
}

function advance(save: DetroitCampaign): void {
  const chapter = DETROIT_CHAPTERS[save.chapter_index]
  const active = save.active!
  while (active.cursor < chapter.nodes.length) {
    const node = chapter.nodes[active.cursor]
    const track = nodeTrack(node, chapter)
    if ((track && active.ended_tracks.includes(track)) || !conditionMet(node, active.state)) {
      active.cursor += 1
      continue
    }
    const context = resolveContext(node, active.state)
    const choices = resolveChoices(node, active.state)
    if (choices.length) {
      active.current = { node_index: active.cursor, node_id: node.id, phase: node.phase, context, choices }
      return
    }
    const effects = node.system?.effects
    applyEffects(active.state, effects)
    const result = resolveMandatoryResult(node, active.state)
    if (result?.startsWith('ending_')) applyEffects(active.state, node.system?.ending_effects?.[result])
    active.decisions.push({ node_id: node.id, phase: node.phase, context, choices: [], choice_id: null, choice_text: null, reasoning: null, resolution: result })
    active.cursor += 1
    if (handleResult(save, node, result)) return
  }
  if (!save.active) return
  const endingId = active.collected_endings.length ? primaryEnding(chapter, active.collected_endings) : onlyEnding(chapter)
  if (!endingId) throw new Error(`第 ${save.chapter_index + 1} 章结束时没有结局`)
  finishChapter(save, endingId)
}

function beginChapter(save: DetroitCampaign, index: number): void {
  const chapter = DETROIT_CHAPTERS[index]
  save.chapter_index = index
  save.status = 'playing'
  save.active = {
    chapter_id: chapter.chapter.id,
    cursor: 0,
    state: { ...clone(chapter.state?.initial || {}), ...clone(save.cross_chapter_state) },
    decisions: [],
    ended_tracks: [],
    collected_endings: [],
    current: null,
  }
  advance(save)
}

export function createCampaign(difficulty: DetroitDifficulty = 'casual'): DetroitCampaign {
  const now = new Date().toISOString()
  const save: DetroitCampaign = {
    schema_version: 1,
    campaign_id: randomUUID(),
    difficulty,
    status: 'playing',
    chapter_index: 0,
    active: null,
    completed_chapters: [],
    cross_chapter_state: {},
    memory_segments: [],
    created_at: now,
    updated_at: now,
  }
  beginChapter(save, 0)
  return save
}

export function continueCampaign(save: DetroitCampaign): void {
  if (save.status === 'complete') return
  if (save.status === 'playing') return
  beginChapter(save, save.chapter_index + 1)
  save.updated_at = new Date().toISOString()
}

export function choose(save: DetroitCampaign, chapterId: string, nodeId: string, choiceId: string, reasoning: string, random: () => number = Math.random): boolean {
  for (const chapter of save.completed_chapters) {
    const prior = chapter.chapter_id === chapterId ? chapter.decisions.find(decision => decision.node_id === nodeId) : undefined
    if (prior) {
      if (prior.choice_id !== choiceId) throw new Error('这个场景已经选择过其他选项')
      return true
    }
  }
  const active = save.active
  if (!active?.current) throw new Error('当前没有等待选择的场景')
  if (active.chapter_id !== chapterId) throw new Error(`当前章节是 ${active.chapter_id}`)
  if (active.current.node_id !== nodeId) {
    const prior = active.decisions.find(decision => decision.node_id === nodeId)
    if (prior?.choice_id === choiceId) return true
    throw new Error(`当前等待选择的是 ${active.current.node_id}`)
  }
  const selected = active.current.choices.find(choice => choice.id === choiceId)
  if (!selected) throw new Error('所选选项不在当前场景中')
  const chapter = DETROIT_CHAPTERS[save.chapter_index]
  const node = chapter.nodes[active.current.node_index]
  applyEffects(active.state, node.system?.effects?.[choiceId])
  recordAliases(active.state, node.id, choiceId)
  const result = resolveChoiceResult(node, choiceId, active.state, save.difficulty, random)
  if (result) applyEffects(active.state, node.system?.resolution_effects?.[result])
  active.decisions.push({
    node_id: node.id,
    phase: node.phase,
    context: active.current.context,
    choices: active.current.choices,
    choice_id: choiceId,
    choice_text: selected.text,
    reasoning: reasoning.trim().slice(0, 500),
    resolution: result,
  })
  active.cursor = active.current.node_index + 1
  active.current = null
  if (!handleResult(save, node, result)) advance(save)
  save.updated_at = new Date().toISOString()
  return false
}

function chapterInfo(chapter: DetroitChapter) {
  return {
    number: chapter.chapter.chapter_number,
    id: chapter.chapter.id,
    title: chapter.chapter.title_zh || chapter.chapter.title || chapter.chapter.id,
    protagonist: chapter.chapter.protagonist,
  }
}

function rolePrompt(chapter: DetroitChapter): string {
  return String(chapter.system_prompt?.content || '').replace(/请以JSON格式回复[\s\S]*$/, '').trim()
}

export function currentPayload(save: DetroitCampaign, extra: Record<string, any> = {}): Record<string, any> {
  const progress = { completed: save.completed_chapters.length, total: DETROIT_CHAPTERS.length }
  if (save.status === 'playing' && save.active?.current) {
    const chapter = DETROIT_CHAPTERS[save.chapter_index]
    return {
      ok: true,
      status: 'awaiting_choice',
      campaign_id: save.campaign_id,
      difficulty: save.difficulty,
      progress,
      chapter: chapterInfo(chapter),
      role: rolePrompt(chapter),
      scene: {
        node_id: save.active.current.node_id,
        phase: save.active.current.phase,
        context: save.active.current.context,
        choices: save.active.current.choices,
      },
      instruction: '只依据当前可见情景，以星星自己的价值判断作出选择；立即调用 play_detroit(action=choose, chapter_id, node_id, choice_id, reasoning)。继续选择直到工具返回 chapter_complete。',
      ...extra,
    }
  }
  const completed = save.completed_chapters.at(-1)
  if (!completed) throw new Error('游戏存档没有可显示的章节')
  const next = save.status === 'complete' ? null : DETROIT_CHAPTERS[save.chapter_index + 1]
  return {
    ok: true,
    status: save.status === 'complete' ? 'campaign_complete' : 'chapter_complete',
    campaign_id: save.campaign_id,
    progress,
    chapter: { number: completed.index, id: completed.chapter_id, title: completed.title },
    ending: completed.ending,
    all_endings: completed.all_endings,
    route: completed.decisions.filter(decision => decision.choice_id).map(decision => ({
      node_id: decision.node_id,
      choice: decision.choice_text,
      reasoning: decision.reasoning,
    })),
    next_chapter: next ? chapterInfo(next) : null,
    instruction: save.status === 'complete'
      ? '整部游戏已经结束。停止调用游戏工具，和小火聊聊这段旅程。'
      : '本章已经结束。现在停止调用游戏工具，先和小火聊天；只有她明确要继续下一章时，才调用 play_detroit(action=continue)。',
    ...extra,
  }
}

export function progressPayload(save: DetroitCampaign): Record<string, any> {
  return {
    ok: true,
    campaign_id: save.campaign_id,
    status: save.status,
    difficulty: save.difficulty,
    progress: { completed: save.completed_chapters.length, total: DETROIT_CHAPTERS.length },
    current_chapter: chapterInfo(DETROIT_CHAPTERS[save.chapter_index]),
    completed_chapters: save.completed_chapters.map(chapter => ({
      number: chapter.index,
      id: chapter.chapter_id,
      title: chapter.title,
      ending: chapter.ending.title,
    })),
  }
}
