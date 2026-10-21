import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export interface OpeningMessage {
  text: string
  updated_at: string
}

interface OpeningMessageData {
  current: OpeningMessage | null
  history: OpeningMessage[]
}

const FILE = resolveDataPath(getDataDir(), 'opening-message.json')
const fallback = (): OpeningMessageData => ({ current: null, history: [] })
const isMessage = (value: unknown): value is OpeningMessage => {
  const message = value as Partial<OpeningMessage> | null
  return !!message && typeof message.text === 'string' && typeof message.updated_at === 'string'
}
const options = {
  fallback,
  fallbackOnInvalid: true,
  validate: (value: unknown) => {
    const data = value as Partial<OpeningMessageData> | null
    return !!data && typeof data === 'object'
      && (data.current === null || isMessage(data.current))
      && Array.isArray(data.history) && data.history.every(isMessage)
  },
}

function normalizeText(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) throw new Error('开屏语不能为空')
  if (text.split(/\r?\n/).length > 2) throw new Error('开屏语最多两行')
  if (Array.from(text).length > 80) throw new Error('开屏语最多80个字')
  return text
}

export function getOpeningMessage(): OpeningMessage | null {
  return readJsonFile(FILE, options).current
}

export function writeOpeningMessage(value: unknown): OpeningMessage {
  const text = normalizeText(value)
  let result!: OpeningMessage
  updateJsonFile(FILE, options, data => {
    if (data.current?.text === text) {
      result = data.current
      return undefined
    }
    result = { text, updated_at: new Date().toISOString() }
    return {
      current: result,
      history: data.current ? [data.current, ...data.history].slice(0, 50) : data.history,
    }
  })
  return result
}

export function clearOpeningMessage(): null {
  updateJsonFile(FILE, options, data => data.current ? {
    current: null,
    history: [data.current, ...data.history].slice(0, 50),
  } : undefined)
  return null
}

export function openingMessageContext(): string {
  const current = getOpeningMessage()
  return current
    ? `【当前开屏语】你现在留给小火的是：${JSON.stringify(current.text)}。它会显示在 Lumbre 开屏上；想换时使用 write_opening_message，想清空时使用 clear_opening_message。`
    : '【当前开屏语】目前没有开屏语。想给小火留一句话时使用 write_opening_message。'
}
