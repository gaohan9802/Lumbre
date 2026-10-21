import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export interface FutureLetterParagraph {
  id: string
  content: string
  created_at: string
  updated_at: string
  operation_key: string
}

interface FutureLetterData {
  paragraphs: FutureLetterParagraph[]
}

const FILE = resolveDataPath(getDataDir(), 'future-letter.json')
const fallback = (): FutureLetterData => ({ paragraphs: [] })
const isParagraph = (value: unknown): value is FutureLetterParagraph => {
  const paragraph = value as Partial<FutureLetterParagraph> | null
  return !!paragraph && typeof paragraph.id === 'string' && typeof paragraph.content === 'string'
    && typeof paragraph.created_at === 'string' && typeof paragraph.updated_at === 'string'
    && typeof paragraph.operation_key === 'string'
}
const options = {
  fallback,
  fallbackOnInvalid: true,
  validate: (value: unknown) => {
    const data = value as Partial<FutureLetterData> | null
    return !!data && typeof data === 'object' && Array.isArray(data.paragraphs) && data.paragraphs.every(isParagraph)
  },
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${label}不能为空`)
  if (Array.from(text).length > max) throw new Error(`${label}最多${max}个字`)
  return text
}

export function readFutureLetter(): FutureLetterData {
  return readJsonFile(FILE, options)
}

export function appendFutureLetterParagraph(contentValue: unknown, operationKeyValue: unknown) {
  const content = requiredText(contentValue, '段落', 5_000)
  const operationKey = requiredText(operationKeyValue, 'operation_key', 160)
  let paragraph!: FutureLetterParagraph
  let deduplicated = false
  updateJsonFile(FILE, options, data => {
    const existing = data.paragraphs.find(item => item.operation_key === operationKey)
    if (existing) {
      paragraph = existing
      deduplicated = true
      return undefined
    }
    const now = new Date().toISOString()
    paragraph = {
      id: `p-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      content,
      created_at: now,
      updated_at: now,
      operation_key: operationKey,
    }
    return { paragraphs: [...data.paragraphs, paragraph] }
  })
  return { paragraph, deduplicated }
}

export function editFutureLetterParagraph(idValue: unknown, contentValue: unknown): FutureLetterParagraph {
  const id = requiredText(idValue, '段落 id', 100)
  const content = requiredText(contentValue, '段落', 5_000)
  let paragraph!: FutureLetterParagraph
  updateJsonFile(FILE, options, data => {
    const index = data.paragraphs.findIndex(item => item.id === id)
    if (index < 0) throw new Error('没有找到这段话')
    const current = data.paragraphs[index]
    paragraph = current.content === content ? current : { ...current, content, updated_at: new Date().toISOString() }
    if (paragraph === current) return undefined
    const paragraphs = [...data.paragraphs]
    paragraphs[index] = paragraph
    return { paragraphs }
  })
  return paragraph
}
