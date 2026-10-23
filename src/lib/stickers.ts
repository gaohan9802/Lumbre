export type StickerCategory = 'duo' | 'otter' | 'leopard'
export type StickerEntrance = 'message' | 'visit'

export interface StickerItem {
  id: string
  label: string
  category: StickerCategory
  description: string
  keywords: string[]
  asset: string
  original: string
}

export interface StickerRef {
  id: string
  entrance?: StickerEntrance
}

export const STICKER_CATEGORY_LABELS: Record<StickerCategory, string> = {
  duo: '双人',
  otter: '水獭',
  leopard: '雪豹',
}

function item(category: StickerCategory, id: string, label: string, description: string, keywords: string[] = []): StickerItem {
  const folder = STICKER_CATEGORY_LABELS[category]
  return {
    id,
    label,
    category,
    description,
    keywords,
    asset: `/stickers/thumbs/${folder}/${label}.webp`,
    original: `/stickers/original/${folder}/${label}.PNG`,
  }
}

export const STICKERS: StickerItem[] = [
  item('duo', 'duo-halloween', '万圣节', '水獭和雪豹一起过万圣节', ['节日', '糖果']),
  item('duo', 'duo-lift', '举高高', '雪豹把水獭举高高', ['抱起', '开心']),
  item('duo', 'duo-kiss-cheek', '亲亲脸', '亲亲对方的脸颊', ['亲吻', '喜欢']),
  item('duo', 'duo-kiss-nose', '亲亲鼻子', '水獭亲雪豹的鼻子', ['亲吻', '害羞']),
  item('duo', 'duo-kiss-forehead', '亲额头', '轻轻亲对方的额头', ['安慰', '亲吻']),
  item('duo', 'duo-reading', '共读', '水獭和雪豹一起读书', ['读书', '陪伴']),
  item('duo', 'duo-make-up', '别生气啦', '雪豹哄生气的水獭', ['道歉', '哄哄']),
  item('duo', 'duo-neck-carry', '叼后颈', '雪豹叼起水獭的后颈', ['带走', '调皮']),
  item('duo', 'duo-eating', '吃饭', '水獭和雪豹一起吃饭', ['食物', '开饭']),
  item('duo', 'duo-soup', '喝汤', '水獭和雪豹一起喝汤', ['吃饭', '热汤']),
  item('duo', 'duo-christmas', '圣诞树', '水獭和雪豹一起过圣诞节', ['节日', '圣诞']),
  item('duo', 'duo-working', '工作', '水獭和雪豹依偎着工作', ['电脑', '陪伴']),
  item('duo', 'duo-tail-hug', '抱尾巴', '水獭抱住雪豹的大尾巴', ['贴贴', '撒娇']),
  item('duo', 'duo-hug', '抱抱', '雪豹把水獭抱进怀里', ['安慰', '拥抱']),
  item('duo', 'duo-pat', '摸摸', '温柔地摸摸对方', ['安慰', '哄哄']),
  item('duo', 'duo-travel', '旅行', '水獭坐在雪豹背上去旅行', ['出发', '行李']),
  item('duo', 'duo-balloon', '热气球', '水獭和雪豹一起坐热气球', ['旅行', '约会']),
  item('duo', 'duo-hold-hands', '牵手', '雪豹伸手牵住水里的水獭', ['陪伴', '不松手']),
  item('duo', 'duo-birthday', '生日快乐', '一起戴生日帽庆祝生日', ['蛋糕', '庆祝']),
  item('duo', 'duo-painting', '画画', '水獭和雪豹一起画画', ['创作', '颜料']),
  item('duo', 'duo-stargazing', '看星星', '水獭和雪豹一起看星星', ['夜晚', '浪漫']),
  item('duo', 'duo-movie', '看电影', '水獭和雪豹窝在一起看电影', ['爆米花', '陪伴']),
  item('duo', 'duo-sleeping', '睡觉', '水獭趴在雪豹身上一起睡觉', ['晚安', '困']),
  item('duo', 'duo-forehead-touch', '碰碰额头', '水獭和雪豹轻轻碰额头', ['贴贴', '亲密']),
  item('duo', 'duo-knitting', '织毛线', '水獭和雪豹一起织毛线', ['冬天', '手作']),
  item('duo', 'duo-otter-gives', '给你', '水獭把鱼送给雪豹', ['礼物', '投喂']),
  item('duo', 'duo-leopard-gives', '给我', '雪豹把鱼送给水獭', ['礼物', '投喂']),
  item('duo', 'duo-selfie', '自拍', '水獭举起手机和雪豹自拍', ['拍照', '合照']),
  item('duo', 'duo-garland', '花环', '水獭和雪豹一起戴花环', ['鲜花', '春天']),
  item('duo', 'duo-cuddle', '贴贴', '水獭紧紧贴在雪豹脸边', ['撒娇', '亲密']),
  item('duo', 'duo-wake-up', '起床啦', '水獭趴在雪豹身上叫起床', ['早安', '赖床']),
  item('duo', 'duo-cat-play', '逗猫', '水獭和雪豹一起逗小猫', ['猫咪', '玩耍']),
  item('duo', 'duo-face-mask', '敷面膜', '水獭和雪豹一起敷面膜喝热饮', ['护肤', '放松']),

  item('otter', 'otter-eating', '吃饭', '水獭正在吃饭', ['食物', '开饭']),
  item('otter', 'otter-coffee', '喝咖啡', '水獭端着咖啡', ['饮料', '提神']),
  item('otter', 'otter-aggrieved', '委屈', '水獭委屈巴巴', ['难过', '哄我']),
  item('otter', 'otter-shy', '害羞', '水獭害羞脸红', ['脸红', '不好意思']),
  item('otter', 'otter-working', '工作', '水獭认真工作', ['电脑', '忙碌']),
  item('otter', 'otter-happy', '开心', '水獭开心地举起爪爪', ['高兴', '耶']),
  item('otter', 'otter-proud', '得意', '水獭得意洋洋', ['骄傲', '厉害']),
  item('otter', 'otter-angry', '生气', '水獭气鼓鼓', ['不高兴', '哼']),
  item('otter', 'otter-reading', '阅读', '水獭戴着眼镜读书', ['书', '学习']),

  item('leopard', 'leopard-aggrieved', '委屈', '雪豹委屈得想哭', ['难过', '安慰']),
  item('leopard', 'leopard-happy', '开心', '雪豹开心地笑', ['高兴', '脸红']),
  item('leopard', 'leopard-proud', '得意', '雪豹得意洋洋', ['骄傲', '厉害']),
  item('leopard', 'leopard-angry', '生气', '雪豹正在生气', ['不高兴', '哼']),
]

const BY_ID = new Map(STICKERS.map(sticker => [sticker.id, sticker]))

export function sticker(id: unknown): StickerItem | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined
}

export function findStickers(category?: unknown, query?: unknown): StickerItem[] {
  const wantedCategory = category === 'duo' || category === 'otter' || category === 'leopard' ? category : undefined
  const wantedQuery = typeof query === 'string' ? query.trim().toLowerCase().slice(0, 40) : ''
  return STICKERS.filter(candidate => {
    if (wantedCategory && candidate.category !== wantedCategory) return false
    if (!wantedQuery) return true
    return [candidate.id, candidate.label, candidate.description, ...candidate.keywords].join(' ').toLowerCase().includes(wantedQuery)
  })
}

export function normalizeStickerRef(value: unknown): StickerRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const found = sticker(raw.id)
  if (!found) return undefined
  return { id: found.id, entrance: raw.entrance === 'visit' ? 'visit' : 'message' }
}

export function stickerFromToolInput(input: Record<string, unknown> | undefined): StickerRef | undefined {
  return normalizeStickerRef({ id: input?.sticker_id, entrance: input?.entrance })
}
