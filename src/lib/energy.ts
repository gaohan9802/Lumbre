export type EnergyActor = 'fire' | 'star'
export type EnergyEntryKind = 'food' | 'liquid' | 'exercise'
export type EnergyMeal = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type EnergySource = 'catalog' | 'database' | 'manual' | 'star'
export type FormulaSex = 'female' | 'male'

export interface EnergyProfile {
  height_cm: number | null
  birth_date: string | null
  formula_sex: FormulaSex | null
  goal_weight_kg: number | null
  manual_baseline_kcal: number | null
  updated_at: string | null
}

export interface BodyMeasurement {
  id: string
  date: string
  weight_kg: number
  body_fat_percent: number | null
  recorded_by: EnergyActor
  created_at: string
  updated_at: string | null
}

export interface EnergyEntry {
  id: string
  date: string
  kind: EnergyEntryKind
  name: string
  amount: number | null
  unit: 'g' | 'ml' | null
  kcal_per_100: number | null
  duration_minutes: number | null
  met: number | null
  calories: number
  meal: EnergyMeal | null
  not_in_health: boolean
  note: string
  source: EnergySource
  recorded_by: EnergyActor
  created_at: string
  updated_at: string | null
}

export interface EnergyCatalogItem {
  kind: 'food' | 'liquid'
  name: string
  aliases: string[]
  kcal_per_100: number
  source: 'catalog'
}

export interface ExerciseCatalogItem {
  name: string
  aliases: string[]
  met: number
}

export interface EnergyDaySummary {
  date: string
  intake_kcal: number
  food_kcal: number
  liquid_kcal: number
  liquid_ml: number
  exercise_kcal: number
  health_active_kcal: number | null
  total_burn_kcal: number | null
  deficit_kcal: number | null
  entries: EnergyEntry[]
  measurement: BodyMeasurement | null
}

export const MEAL_LABELS: Record<EnergyMeal, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐',
}

export const ENERGY_CATALOG: EnergyCatalogItem[] = [
  { kind: 'food', name: '熟米饭', aliases: ['米饭', '白米饭'], kcal_per_100: 116, source: 'catalog' },
  { kind: 'food', name: '熟糙米饭', aliases: ['糙米', '糙米饭'], kcal_per_100: 111, source: 'catalog' },
  { kind: 'food', name: '熟面条', aliases: ['面条', '面'], kcal_per_100: 138, source: 'catalog' },
  { kind: 'food', name: '馒头', aliases: [], kcal_per_100: 223, source: 'catalog' },
  { kind: 'food', name: '燕麦粥', aliases: ['燕麦'], kcal_per_100: 68, source: 'catalog' },
  { kind: 'food', name: '鸡蛋', aliases: ['水煮蛋', '煮鸡蛋'], kcal_per_100: 144, source: 'catalog' },
  { kind: 'food', name: '鸡胸肉', aliases: ['鸡胸'], kcal_per_100: 165, source: 'catalog' },
  { kind: 'food', name: '瘦牛肉', aliases: ['牛肉'], kcal_per_100: 250, source: 'catalog' },
  { kind: 'food', name: '猪里脊', aliases: ['里脊肉'], kcal_per_100: 143, source: 'catalog' },
  { kind: 'food', name: '三文鱼', aliases: ['鲑鱼'], kcal_per_100: 208, source: 'catalog' },
  { kind: 'food', name: '豆腐', aliases: ['北豆腐'], kcal_per_100: 76, source: 'catalog' },
  { kind: 'food', name: '西兰花', aliases: [], kcal_per_100: 34, source: 'catalog' },
  { kind: 'food', name: '番茄', aliases: ['西红柿'], kcal_per_100: 18, source: 'catalog' },
  { kind: 'food', name: '土豆', aliases: ['马铃薯'], kcal_per_100: 77, source: 'catalog' },
  { kind: 'food', name: '红薯', aliases: ['地瓜'], kcal_per_100: 86, source: 'catalog' },
  { kind: 'food', name: '香蕉', aliases: [], kcal_per_100: 89, source: 'catalog' },
  { kind: 'food', name: '苹果', aliases: [], kcal_per_100: 52, source: 'catalog' },
  { kind: 'food', name: '牛油果', aliases: ['鳄梨'], kcal_per_100: 160, source: 'catalog' },
  { kind: 'food', name: '混合坚果', aliases: ['坚果'], kcal_per_100: 607, source: 'catalog' },
  { kind: 'food', name: '橄榄油', aliases: ['食用油'], kcal_per_100: 884, source: 'catalog' },
  { kind: 'liquid', name: '水', aliases: ['白水', '矿泉水'], kcal_per_100: 0, source: 'catalog' },
  { kind: 'liquid', name: '气泡水', aliases: ['苏打水'], kcal_per_100: 0, source: 'catalog' },
  { kind: 'liquid', name: '美式咖啡', aliases: ['黑咖啡', '咖啡'], kcal_per_100: 2, source: 'catalog' },
  { kind: 'liquid', name: '全脂牛奶', aliases: ['牛奶'], kcal_per_100: 61, source: 'catalog' },
  { kind: 'liquid', name: '无糖豆浆', aliases: ['豆浆'], kcal_per_100: 33, source: 'catalog' },
  { kind: 'liquid', name: '橙汁', aliases: ['果汁'], kcal_per_100: 45, source: 'catalog' },
  { kind: 'liquid', name: '可乐', aliases: ['汽水'], kcal_per_100: 42, source: 'catalog' },
  { kind: 'liquid', name: '奶茶', aliases: [], kcal_per_100: 60, source: 'catalog' },
  { kind: 'liquid', name: '啤酒', aliases: [], kcal_per_100: 43, source: 'catalog' },
  { kind: 'liquid', name: '红酒', aliases: ['葡萄酒'], kcal_per_100: 85, source: 'catalog' },
]

export const EXERCISE_CATALOG: ExerciseCatalogItem[] = [
  { name: '散步', aliases: ['慢走'], met: 3.5 },
  { name: '快走', aliases: ['健走'], met: 4.8 },
  { name: '跑步', aliases: ['慢跑'], met: 8.3 },
  { name: '骑车', aliases: ['骑行', '自行车'], met: 6.8 },
  { name: '游泳', aliases: [], met: 6 },
  { name: '力量训练', aliases: ['健身', '撸铁'], met: 5 },
  { name: '瑜伽', aliases: [], met: 2.5 },
  { name: '普拉提', aliases: [], met: 3 },
  { name: '跳舞', aliases: ['舞蹈'], met: 5.5 },
  { name: '爬楼梯', aliases: ['楼梯'], met: 8.8 },
]

export function findCatalogItem(query: string, kind?: 'food' | 'liquid') {
  const target = query.trim().toLocaleLowerCase()
  if (!target) return null
  return ENERGY_CATALOG.find(item => (!kind || item.kind === kind) && [item.name, ...item.aliases].some(name => name.toLocaleLowerCase() === target))
    || ENERGY_CATALOG.find(item => (!kind || item.kind === kind) && [item.name, ...item.aliases].some(name => name.toLocaleLowerCase().includes(target) || target.includes(name.toLocaleLowerCase())))
    || null
}

export function findExerciseItem(query: string) {
  const target = query.trim().toLocaleLowerCase()
  if (!target) return null
  return EXERCISE_CATALOG.find(item => [item.name, ...item.aliases].some(name => name.toLocaleLowerCase() === target))
    || EXERCISE_CATALOG.find(item => [item.name, ...item.aliases].some(name => name.toLocaleLowerCase().includes(target) || target.includes(name.toLocaleLowerCase())))
    || null
}

export function caloriesForAmount(amount: number, kcalPer100: number) {
  return Math.round(amount * kcalPer100) / 100
}

export function exerciseCalories(weightKg: number, minutes: number, met: number) {
  return Math.round(met * 3.5 * weightKg / 200 * minutes)
}

export function ageOnDate(birthDate: string, date: string) {
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const now = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(now.getTime()) || birth > now) return null
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--
  return age >= 18 && age <= 120 ? age : null
}

export function restingCalories(profile: EnergyProfile, weightKg: number, date: string) {
  if (!profile.height_cm || !profile.birth_date || !profile.formula_sex) return null
  const age = ageOnDate(profile.birth_date, date)
  if (age === null) return null
  return Math.round(10 * weightKg + 6.25 * profile.height_cm - 5 * age + (profile.formula_sex === 'male' ? 5 : -161))
}
