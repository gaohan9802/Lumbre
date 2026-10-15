'use client'

import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Activity, Check, ChevronLeft, ChevronRight, Droplets, Flame, PackageOpen, Pencil, Plus, Scale, Share2, ShoppingBasket, Trash2, Utensils, X } from 'lucide-react'
import { energy as energyApi } from '@/lib/api'
import {
  ENERGY_CATALOG, EXERCISE_CATALOG, MEAL_LABELS, exerciseCalories, findCatalogItem, findExerciseItem,
  type BodyMeasurement, type EnergyDaySummary, type EnergyEntry, type EnergyEntryKind, type EnergyGoal, type EnergyProfile, type GroceryItem, type PantryItem,
} from '@/lib/energy'
import { addMadridDays, formatMadrid, madridDateKey } from '@/lib/madrid-time'
import { shareToChat } from '@/lib/share'
import { useTheme } from '@/lib/theme'

interface Dashboard {
  profile: EnergyProfile
  current_measurement: BodyMeasurement | null
  measurements: BodyMeasurement[]
  pantry: PantryItem[]
  groceries: GroceryItem[]
  goals: EnergyGoal[]
  days: EnergyDaySummary[]
  today: EnergyDaySummary
}
type Tab = 'today' | 'plan' | 'trend' | 'body'
type ProfileDraft = { height_cm: string; birth_date: string; formula_sex: string; goal_weight_kg: string; manual_baseline_kcal: string }
type MeasurementDraft = { date: string; weight_kg: string; body_fat_percent: string }
type PantryDraft = { id?: string; name: string; quantity: string }
type GroceryDraft = { id?: string; name: string; quantity: string }
type GoalDraft = { id?: string; title: string }
type EntryDraft = {
  id?: string
  kind: EnergyEntryKind
  date: string
  name: string
  amount: string
  kcal_per_100: string
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  duration_minutes: string
  met: string
  calories: string
  not_in_health: boolean
  note: string
  source: 'catalog' | 'manual'
}

const blankEntry = (kind: EnergyEntryKind, date: string): EntryDraft => ({
  kind, date, name: '', amount: '', kcal_per_100: '', meal: 'snack',
  duration_minutes: '', met: '', calories: '', not_in_health: false, note: '', source: 'manual',
})
const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)
const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
const balanceText = (value: number | null) => value === null ? '—' : `${value >= 0 ? '缺' : '超'} ${Math.abs(Math.round(value))}`
const quickNames: Record<EnergyEntryKind, string[]> = {
  food: ['鸡蛋', '熟米饭', '鸡胸肉', '香蕉', '苹果', '混合坚果'],
  liquid: ['水', '美式咖啡', '全脂牛奶', '无糖豆浆', '可乐', '红酒'],
  exercise: ['散步', '快走', '跑步', '骑车', '力量训练', '瑜伽'],
}

export function EnergyView() {
  const { theme } = useTheme()
  const night = theme === 'night'
  const [date, setDate] = useState(madridDateKey())
  const [tab, setTab] = useState<Tab>('today')
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<EntryDraft | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [profile, setProfile] = useState({ height_cm: '', birth_date: '', formula_sex: '', goal_weight_kg: '', manual_baseline_kcal: '' })
  const [measurement, setMeasurement] = useState({ date: madridDateKey(), weight_kg: '', body_fat_percent: '' })
  const [pantryDraft, setPantryDraft] = useState<PantryDraft>({ name: '', quantity: '' })
  const [goalDraft, setGoalDraft] = useState<GoalDraft>({ title: '' })
  const [groceryDraft, setGroceryDraft] = useState<GroceryDraft>({ name: '', quantity: '' })
  const [trendDays, setTrendDays] = useState(7)
  const loadSequence = useRef(0)

  const load = async (target = date) => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError('')
    try {
      const result = await energyApi.dashboard(target, trendDays) as Dashboard
      if (sequence !== loadSequence.current) return
      setData(result)
      const p = result.profile
      setProfile({
        height_cm: p.height_cm?.toString() || '', birth_date: p.birth_date || '', formula_sex: p.formula_sex || '',
        goal_weight_kg: p.goal_weight_kg?.toString() || '', manual_baseline_kcal: p.manual_baseline_kcal?.toString() || '',
      })
      const exact = result.measurements.find(item => item.date === target)
      const synced = result.today.date === target ? result.today.health : null
      setMeasurement({
        date: target,
        weight_kg: (exact?.weight_kg ?? synced?.weight_kg)?.toString() || '',
        body_fat_percent: (exact?.body_fat_percent ?? synced?.body_fat_percent)?.toString() || '',
      })
    } catch (reason) {
      if (sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : '能量手账没有打开成功')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }
  useEffect(() => { void load() }, [date, trendDays]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = data?.today.date === date ? data.today : undefined
  const weight = current?.measurement?.weight_kg ?? current?.health?.weight_kg ?? data?.current_measurement?.weight_kg ?? null
  const exerciseEstimate = useMemo(() => {
    if (!draft || draft.kind !== 'exercise' || !weight) return null
    const minutes = Number(draft.duration_minutes)
    const met = Number(draft.met)
    return minutes > 0 && met > 0 ? exerciseCalories(weight, minutes, met) : null
  }, [draft, weight])

  const chooseName = (name: string) => {
    if (!draft) return
    if (draft.kind === 'exercise') {
      const found = findExerciseItem(name)
      setDraft({ ...draft, name, met: found ? String(found.met) : draft.met })
      return
    }
    const found = findCatalogItem(name, draft.kind)
    setDraft({
      ...draft, name,
      kcal_per_100: found ? String(found.kcal_per_100) : draft.kcal_per_100,
      source: found ? 'catalog' : 'manual',
    })
  }
  const edit = (entry: EnergyEntry) => setDraft({
    id: entry.id, kind: entry.kind, date: entry.date, name: entry.name,
    amount: entry.amount?.toString() || '', kcal_per_100: entry.kcal_per_100?.toString() || '',
    meal: entry.meal || 'snack', duration_minutes: entry.duration_minutes?.toString() || '',
    met: entry.met?.toString() || '', calories: entry.calories?.toString() || '',
    not_in_health: entry.not_in_health, note: entry.note,
    source: entry.source === 'catalog' ? 'catalog' : 'manual',
  })
  const saveEntry = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const entry: Record<string, unknown> = {
        id: draft.id, kind: draft.kind, date: draft.date, name: draft.name, note: draft.note, source: draft.source,
      }
      if (draft.kind === 'exercise') {
        Object.assign(entry, {
          duration_minutes: numberOrNull(draft.duration_minutes), met: numberOrNull(draft.met),
          calories: numberOrNull(draft.calories) ?? exerciseEstimate, not_in_health: draft.not_in_health,
        })
      } else {
        Object.assign(entry, { amount: numberOrNull(draft.amount), kcal_per_100: numberOrNull(draft.kcal_per_100), meal: draft.meal })
      }
      await energyApi.saveEntry(entry)
      setDraft(null)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没有记下来')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      await energyApi.remove(id)
      setDeleteId(null)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }
  const saveProfile = async () => {
    setBusy(true)
    setError('')
    try {
      await energyApi.saveProfile({
        height_cm: numberOrNull(profile.height_cm), birth_date: profile.birth_date || null,
        formula_sex: profile.formula_sex || null, goal_weight_kg: numberOrNull(profile.goal_weight_kg),
        manual_baseline_kcal: numberOrNull(profile.manual_baseline_kcal),
      })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '身体资料没有保存成功')
    } finally {
      setBusy(false)
    }
  }
  const saveMeasurement = async () => {
    setBusy(true)
    setError('')
    try {
      await energyApi.saveMeasurement({
        date: measurement.date, weight_kg: numberOrNull(measurement.weight_kg),
        body_fat_percent: numberOrNull(measurement.body_fat_percent),
      })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '身体数据没有保存成功')
    } finally {
      setBusy(false)
    }
  }
  const savePantry = async () => {
    if (!pantryDraft.name.trim()) return
    setBusy(true)
    setError('')
    try {
      await energyApi.savePantry(pantryDraft)
      setPantryDraft({ name: '', quantity: '' })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '食材没有保存成功')
    } finally {
      setBusy(false)
    }
  }
  const removePantry = async (id: string) => {
    setBusy(true)
    try {
      await energyApi.removePantry(id)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '食材没有删除成功')
    } finally {
      setBusy(false)
    }
  }
  const saveGrocery = async (item: Partial<GroceryItem> = groceryDraft) => {
    if (!item.name?.trim()) return
    setBusy(true)
    setError('')
    try {
      await energyApi.saveGrocery(item)
      setGroceryDraft({ name: '', quantity: '' })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '买菜清单没有保存成功')
    } finally {
      setBusy(false)
    }
  }
  const removeGrocery = async (id: string) => {
    setBusy(true)
    try {
      await energyApi.removeGrocery(id)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '待买食材没有删除成功')
    } finally {
      setBusy(false)
    }
  }
  const clearCompletedGroceries = async () => {
    setBusy(true)
    setError('')
    try {
      await energyApi.clearCompletedGroceries()
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '已完成的买菜项没有清理成功')
    } finally {
      setBusy(false)
    }
  }
  const saveGoal = async (goal: Partial<EnergyGoal> = goalDraft) => {
    if (!goal.title?.trim()) return
    setBusy(true)
    setError('')
    try {
      await energyApi.saveGoal({ ...goal, date })
      setGoalDraft({ title: '' })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '目标没有保存成功')
    } finally {
      setBusy(false)
    }
  }
  const removeGoal = async (id: string) => {
    setBusy(true)
    try {
      await energyApi.removeGoal(id)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '目标没有删除成功')
    } finally {
      setBusy(false)
    }
  }
  const share = (mealRequest = false) => {
    if (tab === 'plan' && data && current) {
      shareToChat({
        kind: 'energy-plan', title: mealRequest ? '🥬 请星星帮我搭一餐' : '🥬 ' + date + ' 家里与今日计划',
        subtitle: `${data.pantry.length} 样食材 · ${data.groceries.filter(item => !item.done).length} 样待买 · ${data.goals.filter(goal => goal.done).length}/${data.goals.length} 项目标完成`,
        body: [
          ...(mealRequest ? ['请根据家里的食材和今日目标，帮我搭一餐。', ''] : []),
          '家里的食材', ...(data.pantry.length ? data.pantry.map(item => `· ${item.name}${item.quantity ? ` ${item.quantity}` : ''}`) : ['· 暂时还没写']),
          '', '下次买菜', ...(data.groceries.length ? data.groceries.map(item => `${item.done ? '✓' : '○'} ${item.name}${item.quantity ? ` ${item.quantity}` : ''}`) : ['· 暂时还没写']),
          '', '今日目标', ...(data.goals.length ? data.goals.map(goal => `${goal.done ? '✓' : '○'} ${goal.title}${goal.progress ? `（${goal.progress.current}/${goal.progress.target} ${goal.progress.unit}）` : ''}`) : ['· 暂时还没写']),
        ].join('\n'),
        metadata: { date, pantry: data.pantry, groceries: data.groceries, goals: data.goals },
      })
      return
    }
    if (!current) return
    const today = current.date === madridDateKey()
    shareToChat({
      kind: 'energy-day', title: '🍽️ ' + current.date + ' 能量手账',
      subtitle: '摄入 ' + current.intake_kcal + ' kcal · ' + (today ? '今日预算 ' : '全天消耗 ') + (current.total_burn_kcal ?? '—') + ' kcal',
      body: [
        '饮食 ' + current.food_kcal + ' kcal',
        '水 ' + current.water_ml + ' ml · 液体共 ' + current.liquid_ml + ' ml / ' + current.liquid_kcal + ' kcal',
        '运动 ' + current.exercise_minutes + ' 分钟 / 约 ' + current.exercise_kcal + ' kcal',
        current.total_burn_kcal === null ? '身体资料还不足，暂时无法计算消耗' : `基础代谢${today ? '全天' : ''} ${current.baseline_kcal} + ${today ? '已同步活动' : '活动'} ${current.activity_kcal} = ${today ? '今日预算' : '全天消耗'} ${current.total_burn_kcal} kcal`,
        current.deficit_kcal === null ? '身体资料还不足，暂时无法计算热量差' : current.deficit_kcal >= 0 ? (today ? '按当前记录，今天还可用 ' : '当日缺口 ') + current.deficit_kcal + ' kcal' : (today ? '按当前记录，今天已超出 ' : '当日超出 ') + Math.abs(current.deficit_kcal) + ' kcal',
      ].join('\n'),
      metadata: {
        date: current.date, intake_kcal: current.intake_kcal, liquid_ml: current.liquid_ml, water_ml: current.water_ml,
        exercise_minutes: current.exercise_minutes, exercise_kcal: current.exercise_kcal, total_burn_kcal: current.total_burn_kcal, deficit_kcal: current.deficit_kcal,
      },
    })
  }

  const card = night ? 'border-night-border/60 bg-night-card' : 'border-[#8d5e55]/10 bg-white/55'
  const field = night ? 'bg-night-surface' : 'chat-dialog-field'
  const muted = night ? 'text-night-muted' : 'text-[#765953]/55'
  const entries = current?.entries || []
  const recent = [...(data?.days || [])].reverse().flatMap(day => [...day.entries].reverse()).filter((entry, index, all) => all.findIndex(item => item.kind === entry.kind && item.name === entry.name) === index).slice(0, 6)
  const groups = [
    ['breakfast', '早餐', entries.filter(item => item.kind === 'food' && item.meal === 'breakfast')],
    ['lunch', '午餐', entries.filter(item => item.kind === 'food' && item.meal === 'lunch')],
    ['dinner', '晚餐', entries.filter(item => item.kind === 'food' && item.meal === 'dinner')],
    ['snack', '加餐', entries.filter(item => item.kind === 'food' && item.meal === 'snack')],
    ['liquid', '液体', entries.filter(item => item.kind === 'liquid')],
    ['exercise', '运动', entries.filter(item => item.kind === 'exercise')],
  ] as const
  const repeatEntry = (entry: EnergyEntry) => {
    edit(entry)
    setDraft(currentDraft => currentDraft ? { ...currentDraft, id: undefined, date } : currentDraft)
  }
  const isToday = date === madridDateKey()

  return <div className={classNames('h-full overflow-y-auto px-4 pb-12 pt-2', night ? 'text-night-text' : 'text-[#59433f]')}>
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <div className={classNames('flex flex-1 rounded-xl p-1', night ? 'bg-night-surface' : 'bg-[#DBB9B3]/14')}>
          {([['today', '今天'], ['plan', '计划'], ['trend', '趋势'], ['body', '身体']] as const).map(([value, label]) =>
            <button key={value} onClick={() => setTab(value)} aria-pressed={tab === value} className={classNames('flex-1 rounded-lg py-2 text-xs', tab === value ? (night ? 'bg-night-card text-night-amber' : 'bg-white/80 shadow-sm') : 'opacity-45')}>{label}</button>)}
        </div>
        {(tab === 'today' || tab === 'plan') && <button onClick={() => share()} aria-label={tab === 'plan' ? '分享家里与今日计划到 Chat' : '分享能量手账到 Chat'} title="分享到 Chat" className="grid h-8 w-8 place-items-center rounded-full opacity-45"><Share2 size={14}/></button>}
      </div>

      {error && <div role="alert" className="flex items-center justify-between rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-500"><span>{error}</span><button onClick={() => setError('')}><X size={13}/></button></div>}

      {(tab === 'today' || tab === 'plan') && <div className="flex items-center justify-center gap-3 text-xs">
        <button onClick={() => setDate(value => addMadridDays(value, -1))} aria-label="前一天"><ChevronLeft size={15}/></button>
        <input type="date" max={madridDateKey()} value={date} onChange={event => setDate(event.target.value)} className="bg-transparent text-center outline-none"/>
        <button onClick={() => setDate(value => addMadridDays(value, 1))} disabled={date >= madridDateKey()} aria-label="后一天" className="disabled:opacity-20"><ChevronRight size={15}/></button>
      </div>}

      {tab === 'today' && <>
        <div className={classNames('rounded-2xl border p-4', card)}>
          <div className="grid grid-cols-3 gap-2">
            <Summary icon={<Utensils size={13}/>} label="摄入" value={loading ? '…' : String(current?.intake_kcal || 0)} suffix="kcal"/>
            <Summary icon={<Flame size={13}/>} label={isToday ? '今日预算' : '全天消耗'} value={loading ? '…' : current?.total_burn_kcal?.toString() || '—'} suffix="kcal"/>
            <Summary icon={<Activity size={13}/>} label={current?.deficit_kcal !== null && current?.deficit_kcal !== undefined && current.deficit_kcal < 0 ? (isToday ? '已超出' : '当日超出') : (isToday ? '今日可用' : '当日缺口')} value={loading ? '…' : current?.deficit_kcal === null || current?.deficit_kcal === undefined ? '—' : String(Math.abs(Math.round(current.deficit_kcal)))} suffix="kcal"/>
          </div>
          <p className={classNames('mt-3 border-t pt-2 text-center text-[9px]', muted)}>基础代谢{isToday ? '全天' : ''} {current?.baseline_kcal ?? '—'} + {isToday ? '已同步活动' : '活动消耗'} {current?.activity_kcal || 0} kcal</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <AddButton card={card} onClick={() => setDraft(blankEntry('food', date))} icon={<Utensils size={12}/>} label="饮食"/>
          <AddButton card={card} onClick={() => setDraft(blankEntry('liquid', date))} icon={<Droplets size={12}/>} label="液体"/>
          <AddButton card={card} onClick={() => setDraft(blankEntry('exercise', date))} icon={<Activity size={12}/>} label="运动"/>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ProgressMini label="饮水" value={`${current?.water_ml || 0} ml`} detail={`液体 ${current?.liquid_ml || 0} ml`} card={card}/>
          <ProgressMini label="运动" value={`${current?.exercise_minutes || 0} 分`} detail={`约 ${current?.exercise_kcal || 0} kcal`} card={card}/>
          <ProgressMini label="目标" value={`${data?.goals.filter(goal => goal.done).length || 0}/${data?.goals.length || 0}`} detail="今日完成" card={card}/>
        </div>
        {current?.health && <div className={classNames('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-[9px]', card)}><span className="font-medium">Apple Health</span><span>步数 {current.health.steps ?? '—'}</span><span>睡眠 {current.health.sleep_minutes ? Math.round(current.health.sleep_minutes / 6) / 10 + 'h' : '—'}</span><span>活动 {current.health.active_energy_kcal ?? '—'} kcal</span>{current.health.weight_kg !== null && current.health.weight_kg !== undefined && <span>体重 {current.health.weight_kg} kg</span>}{current.health.body_fat_percent !== null && current.health.body_fat_percent !== undefined && <span>体脂 {current.health.body_fat_percent}%</span>}<span className={muted}>{formatMadrid(current.health.synced_at, false)}</span></div>}
        {!!recent.length && <div><p className={classNames('mb-2 text-[9px]', muted)}>最近记过 · 点一下快速再记</p><div className="flex gap-1.5 overflow-x-auto pb-1">{recent.map(entry => <button key={entry.kind + entry.name} onClick={() => repeatEntry(entry)} className={classNames('shrink-0 rounded-full px-3 py-1.5 text-[9px]', field)}>{entry.kind === 'exercise' ? '🏃' : entry.kind === 'liquid' ? '🥤' : '🍚'} {entry.name}</button>)}</div></div>}
        <div className="space-y-2">
          {!loading && !entries.length && <p className={classNames('py-10 text-center text-xs', muted)}>今天还没有记录，吃喝运动都可以慢慢记。</p>}
          {groups.filter(([, , items]) => items.length).map(([key, label, items]) => <details key={key} open className={classNames('rounded-xl border px-3 py-2', card)}><summary className="cursor-pointer list-none text-xs font-medium">{label}<span className={classNames('ml-2 text-[9px]', muted)}>{items.length} 条 · {Math.round(items.reduce((sum, item) => sum + item.calories, 0))} kcal</span></summary><div className="mt-2 divide-y divide-current/5">{items.map(entry => <EnergyEntryRow key={entry.id} entry={entry} muted={muted} busy={busy} deleting={deleteId === entry.id} edit={() => edit(entry)} askDelete={() => setDeleteId(entry.id)} cancelDelete={() => setDeleteId(null)} remove={() => remove(entry.id)}/>)}</div></details>)}
        </div>
      </>}

      {tab === 'trend' && <TrendPanel data={data} card={card} muted={muted} night={night} days={trendDays} setDays={setTrendDays}/>}
      {tab === 'body' && <BodyPanel night={night} card={card} field={field} muted={muted} busy={busy} profile={profile} setProfile={setProfile} measurement={measurement} setMeasurement={setMeasurement} saveProfile={saveProfile} saveMeasurement={saveMeasurement}/>}
      {tab === 'plan' && <PlanPanel card={card} field={field} muted={muted} busy={busy} pantry={current ? data?.pantry || [] : []} groceries={data?.groceries || []} goals={current ? data?.goals || [] : []} pantryDraft={pantryDraft} setPantryDraft={setPantryDraft} groceryDraft={groceryDraft} setGroceryDraft={setGroceryDraft} goalDraft={goalDraft} setGoalDraft={setGoalDraft} savePantry={savePantry} removePantry={removePantry} saveGrocery={saveGrocery} removeGrocery={removeGrocery} clearCompletedGroceries={clearCompletedGroceries} saveGoal={saveGoal} removeGoal={removeGoal} sharePlan={() => share(true)}/>}
    </div>

    {draft && <EntryDialog night={night} field={field} muted={muted} busy={busy} draft={draft} setDraft={setDraft} chooseName={chooseName} exerciseEstimate={exerciseEstimate} weight={weight} save={saveEntry}/>}
  </div>
}

function Summary({ icon, label, value, suffix }: { icon: ReactNode; label: string; value: string; suffix: string }) {
  return <div className="min-w-0 text-center"><p className="flex items-center justify-center gap-1 text-[9px] opacity-45">{icon}{label}</p><p className="mt-1 truncate text-base font-medium">{value}</p><p className="text-[8px] opacity-35">{suffix}</p></div>
}

function AddButton({ card, onClick, icon, label }: { card: string; onClick: () => void; icon: ReactNode; label: string }) {
  return <button onClick={onClick} className={classNames('flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs', card)}><Plus size={12}/>{icon}{label}</button>
}

function ProgressMini({ label, value, detail, card }: { label: string; value: string; detail: string; card: string }) {
  return <div className={classNames('rounded-xl border px-2 py-2 text-center', card)}><p className="text-[8px] opacity-45">{label}</p><p className="mt-0.5 text-xs font-medium">{value}</p><p className="mt-0.5 text-[8px] opacity-35">{detail}</p></div>
}

function EnergyEntryRow({ entry, muted, busy, deleting, edit, askDelete, cancelDelete, remove }: { entry: EnergyEntry; muted: string; busy: boolean; deleting: boolean; edit: () => void; askDelete: () => void; cancelDelete: () => void; remove: () => Promise<void> }) {
  return <div className="py-2 first:pt-0 last:pb-0"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-[11px]">{entry.name} <span className={classNames('text-[9px]', muted)}>{entry.kind === 'exercise' ? `${entry.duration_minutes} 分钟` : `${entry.amount} ${entry.unit}`} · {Math.round(entry.calories)} kcal</span></p>{entry.note && <p className={classNames('mt-1 whitespace-pre-wrap text-[9px]', muted)}>{entry.note}</p>}</div><button onClick={edit} aria-label={'编辑' + entry.name} className="grid h-7 w-7 place-items-center opacity-35"><Pencil size={11}/></button><button onClick={askDelete} aria-label={'删除' + entry.name} className="grid h-7 w-7 place-items-center text-red-400/60"><Trash2 size={11}/></button></div>{deleting && <div className="mt-2 flex items-center gap-2 text-[9px]"><span className="mr-auto opacity-50">确定删除这条记录？</span><button onClick={cancelDelete}>取消</button><button disabled={busy} onClick={() => void remove()} className="text-red-500">删除</button></div>}</div>
}

function PlanPanel(props: {
  card: string; field: string; muted: string; busy: boolean; pantry: PantryItem[]; groceries: GroceryItem[]; goals: EnergyGoal[]
  pantryDraft: PantryDraft; setPantryDraft: Dispatch<SetStateAction<PantryDraft>>
  groceryDraft: GroceryDraft; setGroceryDraft: Dispatch<SetStateAction<GroceryDraft>>
  goalDraft: GoalDraft; setGoalDraft: Dispatch<SetStateAction<GoalDraft>>
  savePantry: () => void; removePantry: (id: string) => Promise<void>
  saveGrocery: (item?: Partial<GroceryItem>) => Promise<void>; removeGrocery: (id: string) => Promise<void>
  clearCompletedGroceries: () => Promise<void>
  saveGoal: (goal?: Partial<EnergyGoal>) => Promise<void>; removeGoal: (id: string) => Promise<void>
  sharePlan: () => void
}) {
  const { card, field, muted, busy, pantry, groceries, goals, pantryDraft, setPantryDraft, groceryDraft, setGroceryDraft, goalDraft, setGoalDraft } = props
  const [deleteKey, setDeleteKey] = useState<string | null>(null)
  const input = classNames('min-w-0 rounded-xl px-3 py-2 text-xs outline-none', field)
  const author = (actor: 'fire' | 'star') => actor === 'star' ? '🐆 星星' : '🦦 小火'
  const pendingGroceries = groceries.filter(item => !item.done)
  const completedGroceries = groceries.filter(item => item.done)
  return <div className="space-y-3">
    <button onClick={props.sharePlan} className={classNames('flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs', card)}><Share2 size={13}/>让星星帮我搭一餐</button>
    <section className={classNames('rounded-2xl border p-4', card)}>
      <div className="flex items-center gap-2"><PackageOpen size={14}/><div><p className="text-xs font-medium">家里的食材</p><p className={classNames('mt-0.5 text-[9px]', muted)}>写现有食材，星星就能一起想今天怎么吃。</p></div></div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_88px_36px] gap-2">
        <input value={pantryDraft.name} onChange={event => setPantryDraft({ ...pantryDraft, name: event.target.value })} placeholder="食材名称" maxLength={80} className={input}/>
        <input value={pantryDraft.quantity} onChange={event => setPantryDraft({ ...pantryDraft, quantity: event.target.value })} placeholder="数量" maxLength={80} className={input}/>
        <button onClick={props.savePantry} disabled={busy || !pantryDraft.name.trim()} aria-label={pantryDraft.id ? '保存食材修改' : '添加食材'} className="grid h-9 w-9 place-items-center rounded-xl bg-[#DBB9B3]/30 disabled:opacity-30">{pantryDraft.id ? <Check size={14}/> : <Plus size={14}/>}</button>
      </div>
      {pantryDraft.id && <button onClick={() => setPantryDraft({ name: '', quantity: '' })} className={classNames('mt-2 text-[9px]', muted)}>取消编辑</button>}
      <div className="mt-3 space-y-1.5">
        {pantry.map(item => <div key={item.id} className="rounded-xl bg-black/[0.025] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs">{item.name}{item.quantity && <span className={classNames('ml-2 text-[9px]', muted)}>{item.quantity}</span>}</span>
            <span className={classNames('text-[8px]', muted)}>{author(item.recorded_by)}</span>
            <button onClick={() => setPantryDraft({ id: item.id, name: item.name, quantity: item.quantity })} aria-label={'编辑' + item.name} className="grid h-7 w-7 place-items-center opacity-35"><Pencil size={11}/></button>
            <button onClick={() => setDeleteKey('pantry:' + item.id)} aria-label={'删除' + item.name} className="grid h-7 w-7 place-items-center text-red-400/60"><Trash2 size={11}/></button>
          </div>
          {deleteKey === 'pantry:' + item.id && <div className="mt-2 flex items-center gap-2 text-[9px]"><span className="mr-auto opacity-50">确定移出食材清单？</span><button onClick={() => setDeleteKey(null)}>取消</button><button disabled={busy} onClick={() => void props.removePantry(item.id).then(() => setDeleteKey(null))} className="text-red-500">删除</button></div>}
        </div>)}
        {!pantry.length && <p className={classNames('py-5 text-center text-[10px]', muted)}>冰箱和储物柜里有什么，就从这里开始写。</p>}
      </div>
    </section>

    <section className={classNames('rounded-2xl border p-4', card)}>
      <div className="flex items-center gap-2"><ShoppingBasket size={14}/><div><p className="text-xs font-medium">下次买菜</p><p className={classNames('mt-0.5 text-[9px]', muted)}>你和星星共用；买到以后直接勾掉。</p></div></div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_88px_36px] gap-2">
        <input value={groceryDraft.name} onChange={event => setGroceryDraft({ ...groceryDraft, name: event.target.value })} placeholder="要买什么" maxLength={80} className={input}/>
        <input value={groceryDraft.quantity} onChange={event => setGroceryDraft({ ...groceryDraft, quantity: event.target.value })} placeholder="数量" maxLength={80} className={input}/>
        <button onClick={() => void props.saveGrocery()} disabled={busy || !groceryDraft.name.trim()} aria-label={groceryDraft.id ? '保存待买食材修改' : '添加待买食材'} className="grid h-9 w-9 place-items-center rounded-xl bg-[#DBB9B3]/30 disabled:opacity-30">{groceryDraft.id ? <Check size={14}/> : <Plus size={14}/>}</button>
      </div>
      {groceryDraft.id && <button onClick={() => setGroceryDraft({ name: '', quantity: '' })} className={classNames('mt-2 text-[9px]', muted)}>取消编辑</button>}
      <div className="mt-3 space-y-1.5">
        {pendingGroceries.map(item => <GroceryRow key={item.id} item={item} muted={muted} busy={busy} author={author} deleting={deleteKey === 'grocery:' + item.id} toggle={() => props.saveGrocery({ id: item.id, name: item.name, quantity: item.quantity, done: true })} edit={() => setGroceryDraft({ id: item.id, name: item.name, quantity: item.quantity })} askDelete={() => setDeleteKey('grocery:' + item.id)} cancelDelete={() => setDeleteKey(null)} remove={() => props.removeGrocery(item.id).then(() => setDeleteKey(null))}/>) }
        {!groceries.length && <p className={classNames('py-5 text-center text-[10px]', muted)}>星星可以把下次要买的食材写在这里。</p>}
        {!!completedGroceries.length && <details className="pt-1">
          <summary className={classNames('cursor-pointer list-none text-[9px]', muted)}>已经买到 {completedGroceries.length} 样</summary>
          <div className="mt-2 space-y-1.5">{completedGroceries.map(item => <GroceryRow key={item.id} item={item} muted={muted} busy={busy} author={author} deleting={deleteKey === 'grocery:' + item.id} toggle={() => props.saveGrocery({ id: item.id, name: item.name, quantity: item.quantity, done: false })} edit={() => setGroceryDraft({ id: item.id, name: item.name, quantity: item.quantity })} askDelete={() => setDeleteKey('grocery:' + item.id)} cancelDelete={() => setDeleteKey(null)} remove={() => props.removeGrocery(item.id).then(() => setDeleteKey(null))}/>)}</div>
          {deleteKey === 'grocery:completed'
            ? <div className="mt-2 flex items-center gap-2 text-[9px]"><span className="mr-auto opacity-50">确定清除全部已完成项？</span><button onClick={() => setDeleteKey(null)}>取消</button><button disabled={busy} onClick={() => void props.clearCompletedGroceries().then(() => setDeleteKey(null))} className="text-red-500">清除</button></div>
            : <button onClick={() => setDeleteKey('grocery:completed')} className="mt-2 text-[9px] text-red-400/70">清除已完成</button>}
        </details>}
      </div>
    </section>

    <section className={classNames('rounded-2xl border p-4', card)}>
      <div><p className="text-xs font-medium">今日目标</p><p className={classNames('mt-0.5 text-[9px]', muted)}>像待办一样，一起写、一起看、完成就勾掉。</p></div>
      <div className="mt-3 flex gap-2">
        <input value={goalDraft.title} onChange={event => setGoalDraft({ ...goalDraft, title: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') void props.saveGoal() }} placeholder="例如：喝水 2000 ml" maxLength={160} className={classNames('flex-1', input)}/>
        <button onClick={() => void props.saveGoal()} disabled={busy || !goalDraft.title.trim()} aria-label={goalDraft.id ? '保存目标修改' : '添加今日目标'} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#DBB9B3]/30 disabled:opacity-30">{goalDraft.id ? <Check size={14}/> : <Plus size={14}/>}</button>
      </div>
      {!goalDraft.id && <div aria-label="常用目标" className="mt-2 flex gap-1.5">
        {['喝水 2000 ml', '运动 30 分钟'].map(title => <button key={title} type="button" onClick={() => setGoalDraft({ title })} className={classNames('rounded-full px-2.5 py-1.5 text-[9px]', field)}>{title}</button>)}
      </div>}
      {goalDraft.id && <button onClick={() => setGoalDraft({ title: '' })} className={classNames('mt-2 text-[9px]', muted)}>取消编辑</button>}
      <div className="mt-3 space-y-1.5">
        {goals.map(goal => <div key={goal.id} className="rounded-xl bg-black/[0.025] px-3 py-2">
          <div className="flex items-center gap-2">
            <button disabled={!!goal.progress} onClick={() => void props.saveGoal({ id: goal.id, title: goal.title, done: !goal.done })} aria-label={goal.progress ? '由饮水或运动记录自动完成' : goal.done ? '标记为未完成' : '标记为已完成'} aria-pressed={goal.done} className={classNames('grid h-6 w-6 shrink-0 place-items-center rounded-full border', goal.done ? 'border-[#789083] bg-[#789083] text-white' : 'border-current opacity-25')}>{goal.done && <Check size={12}/>}</button>
            <span className="min-w-0 flex-1"><span className={classNames('block text-xs', goal.done && 'line-through opacity-40')}>{goal.title}</span>{goal.progress && <span className={classNames('mt-0.5 block text-[8px]', muted)}>{goal.progress.current}/{goal.progress.target} {goal.progress.unit} · 自动进度</span>}</span>
            <span className={classNames('text-[8px]', muted)}>{author(goal.recorded_by)}</span>
            <button onClick={() => setGoalDraft({ id: goal.id, title: goal.title })} aria-label={'编辑' + goal.title} className="grid h-7 w-7 place-items-center opacity-35"><Pencil size={11}/></button>
            <button onClick={() => setDeleteKey('goal:' + goal.id)} aria-label={'删除' + goal.title} className="grid h-7 w-7 place-items-center text-red-400/60"><Trash2 size={11}/></button>
          </div>
          {deleteKey === 'goal:' + goal.id && <div className="mt-2 flex items-center gap-2 text-[9px]"><span className="mr-auto opacity-50">确定删除这项目标？</span><button onClick={() => setDeleteKey(null)}>取消</button><button disabled={busy} onClick={() => void props.removeGoal(goal.id).then(() => setDeleteKey(null))} className="text-red-500">删除</button></div>}
        </div>)}
        {!goals.length && <p className={classNames('py-5 text-center text-[10px]', muted)}>今天想照顾好自己的哪一件小事？</p>}
      </div>
    </section>
  </div>
}

function GroceryRow(props: {
  item: GroceryItem; muted: string; busy: boolean; author: (actor: 'fire' | 'star') => string; deleting: boolean
  toggle: () => Promise<unknown>; edit: () => void; askDelete: () => void; cancelDelete: () => void; remove: () => Promise<unknown>
}) {
  const { item, muted, busy } = props
  return <div className="rounded-xl bg-black/[0.025] px-3 py-2">
    <div className="flex items-center gap-2">
      <button onClick={() => void props.toggle()} aria-label={item.done ? '标记为未买' : '标记为已买'} aria-pressed={item.done} className={classNames('grid h-6 w-6 shrink-0 place-items-center rounded-full border', item.done ? 'border-[#789083] bg-[#789083] text-white' : 'border-current opacity-25')}>{item.done && <Check size={12}/>}</button>
      <span className={classNames('min-w-0 flex-1 truncate text-xs', item.done && 'line-through opacity-40')}>{item.name}{item.quantity && <span className={classNames('ml-2 text-[9px]', muted)}>{item.quantity}</span>}</span>
      <span className={classNames('text-[8px]', muted)}>{props.author(item.recorded_by)}</span>
      <button onClick={props.edit} aria-label={'编辑' + item.name} className="grid h-7 w-7 place-items-center opacity-35"><Pencil size={11}/></button>
      <button onClick={props.askDelete} aria-label={'删除' + item.name} className="grid h-7 w-7 place-items-center text-red-400/60"><Trash2 size={11}/></button>
    </div>
    {props.deleting && <div className="mt-2 flex items-center gap-2 text-[9px]"><span className="mr-auto opacity-50">确定从买菜清单删除？</span><button onClick={props.cancelDelete}>取消</button><button disabled={busy} onClick={() => void props.remove()} className="text-red-500">删除</button></div>}
  </div>
}

function TrendPanel({ data, card, muted, night, days, setDays }: { data: Dashboard | null; card: string; muted: string; night: boolean; days: number; setDays: (value: number) => void }) {
  const max = Math.max(...(data?.days || []).map(item => Math.max(item.intake_kcal, item.total_burn_kcal || 0)), 1)
  const loggedDays = (data?.days || []).filter(day => day.entries.length > 0)
  const average = (key: 'intake_kcal' | 'deficit_kcal') => {
    const values = loggedDays.map(day => day[key]).filter((value): value is number => value !== null)
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
  }
  const rangeStart = data?.days[0]?.date
  const measurements = (data?.measurements || []).filter(item => !rangeStart || item.date >= rangeStart).reverse()
  return <div className="space-y-3">
    <div className={classNames('rounded-2xl border p-4', card)}>
      <div className="flex items-center"><div className="flex-1"><p className="text-xs font-medium">最近{days}天</p><p className={classNames('mt-1 text-[10px]', muted)}>单日是估值，更值得看一段时间的平均。</p></div><div className="flex gap-1">{[7, 14, 30].map(value => <button key={value} onClick={() => setDays(value)} aria-pressed={days === value} className={classNames('rounded-full px-2 py-1 text-[8px]', days === value ? 'bg-[#DBB9B3]/35' : 'opacity-35')}>{value}天</button>)}</div></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className={classNames('rounded-xl px-3 py-2', night ? 'bg-white/[0.035]' : 'bg-black/[0.025]')}><p className={classNames('text-[8px]', muted)}>有记录日均摄入</p><p className="mt-1 text-sm">{average('intake_kcal') ?? '—'} <span className="text-[8px] opacity-45">kcal</span></p></div>
        <div className={classNames('rounded-xl px-3 py-2', night ? 'bg-white/[0.035]' : 'bg-black/[0.025]')}><p className={classNames('text-[8px]', muted)}>有记录日均热量差</p><p className="mt-1 text-sm">{balanceText(average('deficit_kcal'))} <span className="text-[8px] opacity-45">kcal</span></p></div>
      </div>
      <div className="mt-4 space-y-3">{(data?.days || []).map(day => <div key={day.date} className="grid grid-cols-[58px_1fr_52px] items-center gap-2 text-[9px]">
        <span>{day.date.slice(5)}</span><div className="space-y-1"><div className="h-1.5 rounded-full bg-black/5"><div className="h-full rounded-full bg-[#DBB9B3]" style={{ width: Math.min(100, day.intake_kcal / max * 100) + '%' }}/></div><div className="h-1.5 rounded-full bg-black/5"><div className="h-full rounded-full bg-[#8aa096]" style={{ width: Math.min(100, (day.total_burn_kcal || 0) / max * 100) + '%' }}/></div></div><span className={day.deficit_kcal !== null && day.deficit_kcal >= 0 ? 'text-[#718b80]' : 'text-[#b46d65]'}>{balanceText(day.deficit_kcal)}</span>
      </div>)}</div>
      <div className={classNames('mt-4 flex gap-4 text-[8px]', muted)}><span><i className="mr-1 inline-block h-1.5 w-3 rounded bg-[#DBB9B3]"/>摄入</span><span><i className="mr-1 inline-block h-1.5 w-3 rounded bg-[#8aa096]"/>预计消耗</span></div>
    </div>
    <div className={classNames('rounded-2xl border p-4', card)}>
      <p className="text-xs font-medium">体重与体脂</p>
      {!!measurements.length && <MiniBodyTrend measurements={measurements} night={night}/>}
      <div className="mt-3 space-y-2">{[...measurements].reverse().slice(0, 14).map(item => <div key={item.id} className="flex items-center text-[10px]"><span className="w-20 opacity-45">{item.date}</span><span className="flex-1">{item.weight_kg} kg</span><span className="opacity-55">{item.body_fat_percent === null ? '—' : item.body_fat_percent + '%'}</span></div>)}</div>
      {!measurements.length && <p className={classNames('py-8 text-center text-xs', muted)}>最近{days}天还没有身体数据。</p>}
    </div>
  </div>
}

function MiniBodyTrend({ measurements, night }: { measurements: BodyMeasurement[]; night: boolean }) {
  if (measurements.length < 2) return null
  const values = measurements.map(item => item.weight_kg)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const points = values.map((value, index) => `${index / (values.length - 1) * 100},${36 - (value - min) / Math.max(1, max - min) * 28}`).join(' ')
  return <svg viewBox="0 0 100 42" role="img" aria-label="体重变化小图" className="mt-3 h-20 w-full overflow-visible"><polyline points={points} fill="none" stroke={night ? '#d8a872' : '#9b7067'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><text x="0" y="41" fontSize="4" fill="currentColor" opacity=".4">{measurements[0].date.slice(5)}</text><text x="100" y="41" textAnchor="end" fontSize="4" fill="currentColor" opacity=".4">{measurements.at(-1)?.date.slice(5)}</text></svg>
}

function BodyPanel(props: {
  night: boolean; card: string; field: string; muted: string; busy: boolean
  profile: ProfileDraft; setProfile: Dispatch<SetStateAction<ProfileDraft>>
  measurement: MeasurementDraft; setMeasurement: Dispatch<SetStateAction<MeasurementDraft>>
  saveProfile: () => void; saveMeasurement: () => void
}) {
  const { card, field, muted, busy, profile, setProfile, measurement, setMeasurement } = props
  const input = classNames('mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none', field)
  return <div className="space-y-3">
    <div className={classNames('rounded-2xl border p-4', card)}>
      <div className="flex items-center gap-2"><Scale size={14}/><p className="text-xs font-medium">记录身体数据</p></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[9px]">日期<input type="date" max={madridDateKey()} value={measurement.date} onChange={event => setMeasurement({ ...measurement, date: event.target.value })} className={input}/></label>
        <label className="text-[9px]">体重 kg<input inputMode="decimal" value={measurement.weight_kg} onChange={event => setMeasurement({ ...measurement, weight_kg: event.target.value })} className={input}/></label>
        <label className="text-[9px]">体脂率 %<input inputMode="decimal" value={measurement.body_fat_percent} onChange={event => setMeasurement({ ...measurement, body_fat_percent: event.target.value })} className={input}/></label>
      </div>
      <button onClick={props.saveMeasurement} disabled={busy || !measurement.weight_kg} className="mt-3 w-full rounded-xl bg-[#DBB9B3]/25 py-2.5 text-xs disabled:opacity-30">保存身体数据</button>
    </div>
    <div className={classNames('rounded-2xl border p-4', card)}>
      <p className="text-xs font-medium">计算资料</p><p className={classNames('mt-1 text-[9px]', muted)}>基础代谢与日常活动分开计算；Apple Health 的活动能量会另外加上。</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[9px]">身高 cm<input inputMode="decimal" value={profile.height_cm} onChange={event => setProfile({ ...profile, height_cm: event.target.value })} className={input}/></label>
        <label className="text-[9px]">出生日期<input type="date" value={profile.birth_date} onChange={event => setProfile({ ...profile, birth_date: event.target.value })} className={input}/></label>
        <label className="text-[9px]">公式选项<select value={profile.formula_sex} onChange={event => setProfile({ ...profile, formula_sex: event.target.value })} className={input}><option value="">暂不填写</option><option value="female">女性公式</option><option value="male">男性公式</option></select></label>
        <label className="text-[9px]">目标体重 kg<input inputMode="decimal" value={profile.goal_weight_kg} onChange={event => setProfile({ ...profile, goal_weight_kg: event.target.value })} className={input}/></label>
        <label className="col-span-2 text-[9px]">手动基础代谢 kcal（可空，不含走路和运动）<input inputMode="numeric" value={profile.manual_baseline_kcal} onChange={event => setProfile({ ...profile, manual_baseline_kcal: event.target.value })} className={input}/></label>
      </div>
      <button onClick={props.saveProfile} disabled={busy} className="mt-3 w-full rounded-xl bg-[#DBB9B3]/25 py-2.5 text-xs disabled:opacity-30">保存计算资料</button>
    </div>
  </div>
}

function EntryDialog(props: {
  night: boolean; field: string; muted: string; busy: boolean; draft: EntryDraft
  setDraft: (value: EntryDraft | null) => void; chooseName: (name: string) => void
  exerciseEstimate: number | null; weight: number | null; save: () => void
}) {
  const { night, field, muted, busy, draft, setDraft, chooseName, exerciseEstimate, weight } = props
  const input = classNames('w-full rounded-xl px-3 py-2 text-xs outline-none', field)
  const estimatedFood = Number(draft.amount) > 0 && Number(draft.kcal_per_100) >= 0 ? Math.round(Number(draft.amount) * Number(draft.kcal_per_100) / 100) : null
  const quickAmounts = draft.kind === 'food' ? [50, 100, 150, 200] : draft.kind === 'liquid' ? [250, 330, 500, 750] : [15, 30, 45, 60]
  const disabled = busy || !draft.name.trim() || (draft.kind === 'exercise'
    ? !draft.duration_minutes || (!draft.calories && (!draft.met || !weight))
    : !draft.amount || draft.kcal_per_100 === '')
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/35 p-3 sm:items-center">
    <button aria-label="关闭记录表单" onClick={() => setDraft(null)} className="absolute inset-0"/>
    <div role="dialog" aria-modal="true" aria-label={draft.id ? '编辑能量记录' : '新增能量记录'} className={classNames('relative z-10 max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl p-4 shadow-2xl', night ? 'bg-night-card' : 'chat-dialog')}>
      <div className="flex items-center"><p className="flex-1 text-sm font-medium">{draft.id ? '编辑' : '记一笔'} · {draft.kind === 'food' ? '饮食' : draft.kind === 'liquid' ? '液体' : '运动'}</p><button onClick={() => setDraft(null)}><X size={16}/></button></div>
      <div className="mt-4 space-y-2">
        <input type="date" max={madridDateKey()} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={input}/>
        <input list={draft.kind === 'exercise' ? 'energy-exercises' : 'energy-' + draft.kind} value={draft.name} onChange={event => chooseName(event.target.value)} placeholder={draft.kind === 'food' ? '食物名称' : draft.kind === 'liquid' ? '水、咖啡、奶茶…' : '运动名称'} className={input}/>
        <datalist id={'energy-' + draft.kind}>{ENERGY_CATALOG.filter(item => item.kind === draft.kind).map(item => <option key={item.name} value={item.name}/>)}</datalist>
        <datalist id="energy-exercises">{EXERCISE_CATALOG.map(item => <option key={item.name} value={item.name}/>)}</datalist>
        <div aria-label="常用选项" className="flex gap-1.5 overflow-x-auto pb-0.5">
          {quickNames[draft.kind].map(name => <button key={name} type="button" onClick={() => chooseName(name)} className={classNames('shrink-0 rounded-full px-2.5 py-1.5 text-[9px]', draft.name === name ? (night ? 'bg-night-amber/15 text-night-amber' : 'bg-[#DBB9B3]/35') : night ? 'bg-night-surface' : 'bg-black/[0.035]')}>{name}</button>)}
        </div>
        {draft.kind !== 'exercise' ? <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[9px]">{draft.kind === 'food' ? '克数 g' : '毫升 ml'}<input inputMode="decimal" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} className={classNames('mt-1', input)}/></label>
            <label className="text-[9px]">每100{draft.kind === 'food' ? 'g' : 'ml'}热量<input inputMode="decimal" value={draft.kcal_per_100} onChange={event => setDraft({ ...draft, kcal_per_100: event.target.value, source: 'manual' })} className={classNames('mt-1', input)}/></label>
          </div>
          <div className="flex gap-1.5">{quickAmounts.map(value => <button key={value} type="button" onClick={() => setDraft({ ...draft, amount: String(value) })} className={classNames('flex-1 rounded-lg py-1.5 text-[9px]', draft.amount === String(value) ? (night ? 'bg-night-amber/15 text-night-amber' : 'bg-[#DBB9B3]/35') : night ? 'bg-night-surface' : 'bg-black/[0.035]')}>{value}{draft.kind === 'food' ? 'g' : 'ml'}</button>)}</div>
          <select value={draft.meal} onChange={event => setDraft({ ...draft, meal: event.target.value as EntryDraft['meal'] })} className={input}>{Object.entries(MEAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <p className={classNames('px-1 text-[9px]', muted)}>预计 {estimatedFood ?? '—'} kcal</p>
        </> : <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[9px]">时长 分钟<input inputMode="numeric" value={draft.duration_minutes} onChange={event => setDraft({ ...draft, duration_minutes: event.target.value })} className={classNames('mt-1', input)}/></label>
            <label className="text-[9px]">MET<input inputMode="decimal" value={draft.met} onChange={event => setDraft({ ...draft, met: event.target.value })} className={classNames('mt-1', input)}/></label>
          </div>
          <div className="flex gap-1.5">{quickAmounts.map(value => <button key={value} type="button" onClick={() => setDraft({ ...draft, duration_minutes: String(value) })} className={classNames('flex-1 rounded-lg py-1.5 text-[9px]', draft.duration_minutes === String(value) ? (night ? 'bg-night-amber/15 text-night-amber' : 'bg-[#DBB9B3]/35') : night ? 'bg-night-surface' : 'bg-black/[0.035]')}>{value}分</button>)}</div>
          <label className="block text-[9px]">手动消耗 kcal（可空）<input inputMode="numeric" value={draft.calories} onChange={event => setDraft({ ...draft, calories: event.target.value })} className={classNames('mt-1', input)}/></label>
          <label className="flex items-center gap-2 rounded-xl px-2 py-2 text-[10px]"><input type="checkbox" checked={draft.not_in_health} onChange={event => setDraft({ ...draft, not_in_health: event.target.checked })}/>这次运动没有被 Apple Health 记录</label>
          <p className={classNames('px-1 text-[9px]', muted)}>按当前体重估算约 {exerciseEstimate ?? '—'} kcal；填写手动消耗会覆盖估值。</p>
        </>}
        <textarea value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} placeholder="备注（可空）" rows={2} maxLength={500} className={classNames(input, 'resize-none')}/>
        <button onClick={props.save} disabled={disabled} className="w-full rounded-xl bg-[#DBB9B3]/30 py-2.5 text-xs disabled:opacity-30">{busy ? '正在保存…' : '保存记录'}</button>
      </div>
    </div>
  </div>
}
