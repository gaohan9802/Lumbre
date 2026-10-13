'use client'

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Activity, ChevronLeft, ChevronRight, Droplets, Flame, Pencil, Plus, Scale, Share2, Trash2, Utensils, X } from 'lucide-react'
import { energy as energyApi } from '@/lib/api'
import {
  ENERGY_CATALOG, EXERCISE_CATALOG, MEAL_LABELS, exerciseCalories, findCatalogItem, findExerciseItem,
  type BodyMeasurement, type EnergyDaySummary, type EnergyEntry, type EnergyEntryKind, type EnergyProfile,
} from '@/lib/energy'
import { addMadridDays, madridDateKey } from '@/lib/madrid-time'
import { shareToChat } from '@/lib/share'
import { useTheme } from '@/lib/theme'

interface Dashboard {
  profile: EnergyProfile
  current_measurement: BodyMeasurement | null
  measurements: BodyMeasurement[]
  days: EnergyDaySummary[]
  today: EnergyDaySummary
}
type Tab = 'today' | 'trend' | 'body'
type ProfileDraft = { height_cm: string; birth_date: string; formula_sex: string; goal_weight_kg: string; manual_baseline_kcal: string }
type MeasurementDraft = { date: string; weight_kg: string; body_fat_percent: string }
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
const signed = (value: number | null) => value === null ? '—' : (value < 0 ? '＋' : '') + Math.abs(Math.round(value))

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

  const load = async (target = date) => {
    setLoading(true)
    setError('')
    try {
      const result = await energyApi.dashboard(target, 7) as Dashboard
      setData(result)
      const p = result.profile
      setProfile({
        height_cm: p.height_cm?.toString() || '', birth_date: p.birth_date || '', formula_sex: p.formula_sex || '',
        goal_weight_kg: p.goal_weight_kg?.toString() || '', manual_baseline_kcal: p.manual_baseline_kcal?.toString() || '',
      })
      setMeasurement(current => ({
        ...current, date: target,
        weight_kg: result.current_measurement?.weight_kg?.toString() || current.weight_kg,
        body_fat_percent: result.current_measurement?.body_fat_percent?.toString() || '',
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '能量手账没有打开成功')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = data?.today
  const weight = data?.current_measurement?.weight_kg || null
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
  const share = () => {
    if (!current) return
    shareToChat({
      kind: 'energy-day', title: '🍽️ ' + current.date + ' 能量手账',
      subtitle: '摄入 ' + current.intake_kcal + ' kcal · 预计消耗 ' + (current.total_burn_kcal ?? '—') + ' kcal',
      body: [
        '饮食 ' + current.food_kcal + ' kcal',
        '液体 ' + current.liquid_ml + ' ml / ' + current.liquid_kcal + ' kcal',
        '运动约 ' + current.exercise_kcal + ' kcal',
        current.deficit_kcal === null ? '身体资料还不足，暂时无法计算缺口' : '当日缺口约 ' + current.deficit_kcal + ' kcal',
      ].join('\n'),
      metadata: {
        date: current.date, intake_kcal: current.intake_kcal, liquid_ml: current.liquid_ml,
        exercise_kcal: current.exercise_kcal, total_burn_kcal: current.total_burn_kcal, deficit_kcal: current.deficit_kcal,
      },
    })
  }

  const card = night ? 'border-night-border/60 bg-night-card' : 'border-[#8d5e55]/10 bg-white/55'
  const field = night ? 'bg-night-surface' : 'chat-dialog-field'
  const muted = night ? 'text-night-muted' : 'text-[#765953]/55'
  const entries = current?.entries || []

  return <div className={classNames('h-full overflow-y-auto px-4 pb-12 pt-2', night ? 'text-night-text' : 'text-[#59433f]')}>
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <div className={classNames('flex flex-1 rounded-xl p-1', night ? 'bg-night-surface' : 'bg-[#DBB9B3]/14')}>
          {([['today', '今天'], ['trend', '7天趋势'], ['body', '身体']] as const).map(([value, label]) =>
            <button key={value} onClick={() => setTab(value)} className={classNames('flex-1 rounded-lg py-2 text-xs', tab === value ? (night ? 'bg-night-card text-night-amber' : 'bg-white/80 shadow-sm') : 'opacity-45')}>{label}</button>)}
        </div>
        <button onClick={share} aria-label="分享能量手账到 Chat" title="分享到 Chat" className="grid h-8 w-8 place-items-center rounded-full opacity-45"><Share2 size={14}/></button>
      </div>

      {error && <div role="alert" className="flex items-center justify-between rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-500"><span>{error}</span><button onClick={() => setError('')}><X size={13}/></button></div>}

      {tab === 'today' && <>
        <div className="flex items-center justify-center gap-3 text-xs">
          <button onClick={() => setDate(value => addMadridDays(value, -1))} aria-label="前一天"><ChevronLeft size={15}/></button>
          <input type="date" value={date} onChange={event => setDate(event.target.value)} className="bg-transparent text-center outline-none"/>
          <button onClick={() => setDate(value => addMadridDays(value, 1))} disabled={date >= madridDateKey()} aria-label="后一天" className="disabled:opacity-20"><ChevronRight size={15}/></button>
        </div>
        <div className={classNames('grid grid-cols-3 gap-2 rounded-2xl border p-3', card)}>
          <Summary icon={<Utensils size={13}/>} label="摄入" value={loading ? '…' : String(current?.intake_kcal || 0)} suffix="kcal"/>
          <Summary icon={<Flame size={13}/>} label="预计消耗" value={loading ? '…' : current?.total_burn_kcal?.toString() || '—'} suffix="kcal"/>
          <Summary icon={<Activity size={13}/>} label="缺口" value={loading ? '…' : signed(current?.deficit_kcal ?? null)} suffix="kcal"/>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <AddButton card={card} onClick={() => setDraft(blankEntry('food', date))} icon={<Utensils size={12}/>} label="饮食"/>
          <AddButton card={card} onClick={() => setDraft(blankEntry('liquid', date))} icon={<Droplets size={12}/>} label="液体"/>
          <AddButton card={card} onClick={() => setDraft(blankEntry('exercise', date))} icon={<Activity size={12}/>} label="运动"/>
        </div>
        <div className={classNames('flex items-center justify-between rounded-xl border px-3 py-2 text-[10px]', card)}>
          <span><Droplets size={11} className="mr-1 inline"/>液体 {current?.liquid_ml || 0} ml</span>
          <span className={muted}>其中 {current?.liquid_kcal || 0} kcal</span>
        </div>
        <div className="space-y-2">
          {!loading && !entries.length && <p className={classNames('py-10 text-center text-xs', muted)}>今天还没有记录，吃喝运动都可以慢慢记。</p>}
          {entries.map(entry => <div key={entry.id} className={classNames('rounded-xl border p-3', card)}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5">{entry.kind === 'food' ? '🍚' : entry.kind === 'liquid' ? '🥤' : '🏃'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-1.5"><span className="text-xs font-medium">{entry.name}</span><span className={classNames('text-[9px]', muted)}>{entry.kind === 'exercise' ? entry.duration_minutes + ' 分钟' : entry.amount + ' ' + entry.unit}</span></div>
                <p className={classNames('mt-1 text-[9px]', muted)}>{entry.kind === 'exercise'
                  ? '消耗约 ' + Math.round(entry.calories) + ' kcal' + (entry.not_in_health ? ' · 未计入健康数据' : '')
                  : (entry.meal ? MEAL_LABELS[entry.meal] + ' · ' : '') + '约 ' + Math.round(entry.calories) + ' kcal · ' + (entry.source === 'catalog' ? '常用食物估值' : entry.recorded_by === 'star' ? '星星记录' : '手动值')}</p>
                {entry.note && <p className="mt-1.5 whitespace-pre-wrap text-[10px] opacity-70">{entry.note}</p>}
              </div>
              <button onClick={() => edit(entry)} aria-label={'编辑' + entry.name} className="p-1 opacity-35"><Pencil size={11}/></button>
              <button onClick={() => setDeleteId(entry.id)} aria-label={'删除' + entry.name} className="p-1 text-red-400/60"><Trash2 size={11}/></button>
            </div>
            {deleteId === entry.id && <div className="mt-2 flex items-center gap-2 text-[9px]"><span className="mr-auto opacity-50">确定删除这条记录？</span><button onClick={() => setDeleteId(null)}>取消</button><button disabled={busy} onClick={() => void remove(entry.id)} className="text-red-500">删除</button></div>}
          </div>)}
        </div>
      </>}

      {tab === 'trend' && <TrendPanel data={data} card={card} muted={muted}/>}
      {tab === 'body' && <BodyPanel night={night} card={card} field={field} muted={muted} busy={busy} profile={profile} setProfile={setProfile} measurement={measurement} setMeasurement={setMeasurement} saveProfile={saveProfile} saveMeasurement={saveMeasurement}/>}
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

function TrendPanel({ data, card, muted }: { data: Dashboard | null; card: string; muted: string }) {
  const max = Math.max(...(data?.days || []).map(item => Math.max(item.intake_kcal, item.total_burn_kcal || 0)), 1)
  return <div className="space-y-3">
    <div className={classNames('rounded-2xl border p-4', card)}>
      <p className="text-xs font-medium">最近7天</p><p className={classNames('mt-1 text-[10px]', muted)}>单日是估值，更值得看一周平均。</p>
      <div className="mt-4 space-y-3">{(data?.days || []).map(day => <div key={day.date} className="grid grid-cols-[58px_1fr_52px] items-center gap-2 text-[9px]">
        <span>{day.date.slice(5)}</span><div className="space-y-1"><div className="h-1.5 rounded-full bg-black/5"><div className="h-full rounded-full bg-[#DBB9B3]" style={{ width: Math.min(100, day.intake_kcal / max * 100) + '%' }}/></div><div className="h-1.5 rounded-full bg-black/5"><div className="h-full rounded-full bg-[#8aa096]" style={{ width: Math.min(100, (day.total_burn_kcal || 0) / max * 100) + '%' }}/></div></div><span className={day.deficit_kcal !== null && day.deficit_kcal >= 0 ? 'text-[#718b80]' : 'text-[#b46d65]'}>{day.deficit_kcal === null ? '—' : signed(day.deficit_kcal)}</span>
      </div>)}</div>
      <div className={classNames('mt-4 flex gap-4 text-[8px]', muted)}><span><i className="mr-1 inline-block h-1.5 w-3 rounded bg-[#DBB9B3]"/>摄入</span><span><i className="mr-1 inline-block h-1.5 w-3 rounded bg-[#8aa096]"/>预计消耗</span></div>
    </div>
    <div className={classNames('rounded-2xl border p-4', card)}>
      <p className="text-xs font-medium">体重与体脂</p>
      <div className="mt-3 space-y-2">{(data?.measurements || []).slice(0, 14).map(item => <div key={item.id} className="flex items-center text-[10px]"><span className="w-20 opacity-45">{item.date}</span><span className="flex-1">{item.weight_kg} kg</span><span className="opacity-55">{item.body_fat_percent === null ? '—' : item.body_fat_percent + '%'}</span></div>)}</div>
      {!data?.measurements?.length && <p className={classNames('py-8 text-center text-xs', muted)}>还没有身体数据。</p>}
    </div>
  </div>
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
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label className="text-[9px]">日期<input type="date" value={measurement.date} onChange={event => setMeasurement({ ...measurement, date: event.target.value })} className={input}/></label>
        <label className="text-[9px]">体重 kg<input inputMode="decimal" value={measurement.weight_kg} onChange={event => setMeasurement({ ...measurement, weight_kg: event.target.value })} className={input}/></label>
        <label className="text-[9px]">体脂率 %<input inputMode="decimal" value={measurement.body_fat_percent} onChange={event => setMeasurement({ ...measurement, body_fat_percent: event.target.value })} className={input}/></label>
      </div>
      <button onClick={props.saveMeasurement} disabled={busy || !measurement.weight_kg} className="mt-3 w-full rounded-xl bg-[#DBB9B3]/25 py-2.5 text-xs disabled:opacity-30">保存身体数据</button>
    </div>
    <div className={classNames('rounded-2xl border p-4', card)}>
      <p className="text-xs font-medium">计算资料</p><p className={classNames('mt-1 text-[9px]', muted)}>只用于估算静息消耗，也可以直接填写基础消耗覆盖公式。</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[9px]">身高 cm<input inputMode="decimal" value={profile.height_cm} onChange={event => setProfile({ ...profile, height_cm: event.target.value })} className={input}/></label>
        <label className="text-[9px]">出生日期<input type="date" value={profile.birth_date} onChange={event => setProfile({ ...profile, birth_date: event.target.value })} className={input}/></label>
        <label className="text-[9px]">公式选项<select value={profile.formula_sex} onChange={event => setProfile({ ...profile, formula_sex: event.target.value })} className={input}><option value="">暂不填写</option><option value="female">女性公式</option><option value="male">男性公式</option></select></label>
        <label className="text-[9px]">目标体重 kg<input inputMode="decimal" value={profile.goal_weight_kg} onChange={event => setProfile({ ...profile, goal_weight_kg: event.target.value })} className={input}/></label>
        <label className="col-span-2 text-[9px]">手动基础消耗 kcal（可空，不含额外活动）<input inputMode="numeric" value={profile.manual_baseline_kcal} onChange={event => setProfile({ ...profile, manual_baseline_kcal: event.target.value })} className={input}/></label>
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
  const disabled = busy || !draft.name.trim() || (draft.kind === 'exercise'
    ? !draft.duration_minutes || (!draft.calories && (!draft.met || !weight))
    : !draft.amount || draft.kcal_per_100 === '')
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/35 p-3 sm:items-center">
    <button aria-label="关闭记录表单" onClick={() => setDraft(null)} className="absolute inset-0"/>
    <div role="dialog" aria-modal="true" aria-label={draft.id ? '编辑能量记录' : '新增能量记录'} className={classNames('relative z-10 w-full max-w-md rounded-3xl p-4 shadow-2xl', night ? 'bg-night-card' : 'chat-dialog')}>
      <div className="flex items-center"><p className="flex-1 text-sm font-medium">{draft.id ? '编辑' : '记一笔'} · {draft.kind === 'food' ? '饮食' : draft.kind === 'liquid' ? '液体' : '运动'}</p><button onClick={() => setDraft(null)}><X size={16}/></button></div>
      <div className="mt-4 space-y-2">
        <input type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={input}/>
        <input list={draft.kind === 'exercise' ? 'energy-exercises' : 'energy-' + draft.kind} value={draft.name} onChange={event => chooseName(event.target.value)} placeholder={draft.kind === 'food' ? '食物名称' : draft.kind === 'liquid' ? '水、咖啡、奶茶…' : '运动名称'} className={input}/>
        <datalist id={'energy-' + draft.kind}>{ENERGY_CATALOG.filter(item => item.kind === draft.kind).map(item => <option key={item.name} value={item.name}/>)}</datalist>
        <datalist id="energy-exercises">{EXERCISE_CATALOG.map(item => <option key={item.name} value={item.name}/>)}</datalist>
        {draft.kind !== 'exercise' ? <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[9px]">{draft.kind === 'food' ? '克数 g' : '毫升 ml'}<input inputMode="decimal" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} className={classNames('mt-1', input)}/></label>
            <label className="text-[9px]">每100{draft.kind === 'food' ? 'g' : 'ml'}热量<input inputMode="decimal" value={draft.kcal_per_100} onChange={event => setDraft({ ...draft, kcal_per_100: event.target.value, source: 'manual' })} className={classNames('mt-1', input)}/></label>
          </div>
          <select value={draft.meal} onChange={event => setDraft({ ...draft, meal: event.target.value as EntryDraft['meal'] })} className={input}>{Object.entries(MEAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <p className={classNames('px-1 text-[9px]', muted)}>预计 {estimatedFood ?? '—'} kcal</p>
        </> : <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[9px]">时长 分钟<input inputMode="numeric" value={draft.duration_minutes} onChange={event => setDraft({ ...draft, duration_minutes: event.target.value })} className={classNames('mt-1', input)}/></label>
            <label className="text-[9px]">MET<input inputMode="decimal" value={draft.met} onChange={event => setDraft({ ...draft, met: event.target.value })} className={classNames('mt-1', input)}/></label>
          </div>
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
