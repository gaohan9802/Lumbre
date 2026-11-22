import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export interface NurseryEvent {
  id: string
  kind: string
  text: string
  voice: string
  detail: string
  ts: number
  receivedAt: string
}

interface NurseryEventStore { events: NurseryEvent[] }

const FILE = resolveDataPath(getDataDir(), 'nursery-events.json')
const fallback = (): NurseryEventStore => ({ events: [] })
const options = {
  fallback,
  fallbackOnInvalid: true,
  validate: (value: unknown): value is NurseryEventStore => !!value && typeof value === 'object' && Array.isArray((value as NurseryEventStore).events),
}

const text = (value: unknown, max = 600) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''

export function saveNurseryEvent(input: Record<string, unknown>): boolean {
  const id = text(input.idempotency_key || input.source_event_id, 240)
  const kind = text(input.kind, 80)
  if (!id || !kind) throw new Error('Nursery event is missing its identity')
  let added = false
  updateJsonFile<NurseryEventStore>(FILE, options, store => {
    if (store.events.some(event => event.id === id)) return store
    added = true
    return {
      events: [...store.events, {
        id,
        kind,
        text: text(input.text),
        voice: text(input.voice),
        detail: text(input.detail, 160),
        ts: Number(input.ts) || Date.now() / 1000,
        receivedAt: new Date().toISOString(),
      }].slice(-200),
    }
  })
  return added
}

export function readNurseryEvents(limit = 30): NurseryEvent[] {
  return readJsonFile(FILE, options).events.slice(-Math.max(1, Math.min(100, Math.floor(limit) || 30))).reverse()
}
