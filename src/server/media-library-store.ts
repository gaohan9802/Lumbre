import { randomUUID } from 'node:crypto'
import type {
  MediaActor, MediaComment, MediaEvent, MediaEventType, MediaKind, MediaNote,
  MediaNoteType, MediaStatus, MediaTimelineItem, MediaWork,
} from '@/lib/media-library'
import { MEDIA_KINDS, MEDIA_STATUSES } from '@/lib/media-library'
import { readMediaState, updateMediaState } from './data/repositories/media-library'

interface MediaState { version: 1; works: MediaWork[] }

export interface SaveMediaInput {
  work_id?: string
  kind?: MediaKind
  title?: string
  original_title?: string
  creators?: string[]
  cover_url?: string
  summary?: string
  publisher?: string
  published_date?: string
  page_count?: number
  isbn?: string
  directors?: string[]
  cast?: string[]
  countries?: string[]
  release_date?: string
  runtime_minutes?: number
  source?: { provider: string; id: string; url?: string }
  status?: MediaStatus
  rating?: number | null
  review?: string
}
export type DeleteMediaTarget =
  | { type: 'record'; work_id: string }
  | { type: 'note'; work_id: string; note_id: string }
  | { type: 'comment'; work_id: string; event_id: string; comment_id: string }
  | { type: 'work'; work_id: string }

const emptyState = (): MediaState => ({ version: 1, works: [] })
const actorOf = (value: unknown): MediaActor => value === 'star' ? 'star' : 'fire'
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const textList = (value: unknown, max = 12) => Array.isArray(value)
  ? value.map(item => text(item, 120)).filter(Boolean).slice(0, max)
  : []
const positiveInt = (value: unknown, max: number) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= max ? Number(value) : undefined

function normalizeState(raw: MediaState): MediaState {
  return { version: 1, works: Array.isArray(raw?.works) ? raw.works.filter(work => work && typeof work.id === 'string') : [] }
}

function readState(): MediaState { return normalizeState(readMediaState(emptyState)) }

function mutate<T>(operation: (state: MediaState) => { result: T; write: boolean }): T {
  let result!: T
  updateMediaState(emptyState, raw => {
    const state = normalizeState(raw)
    const outcome = operation(state)
    result = outcome.result
    return outcome.write ? state : undefined
  })
  return result
}

function event(actor: MediaActor, type: MediaEventType, detail?: string, target_id?: string): MediaEvent {
  return { id: randomUUID(), actor, type, detail: text(detail, 500) || undefined, target_id, comments: [], created_at: new Date().toISOString() }
}

function workHasOtherContent(work: MediaWork, actor: MediaActor): boolean {
  const other: MediaActor = actor === 'fire' ? 'star' : 'fire'
  return !!work.records[other]
    || work.notes.some(note => note.author === other)
    || work.events.some(item => item.actor === other || item.comments.some(comment => comment.author === other))
}

function statusEvent(status: MediaStatus): MediaEventType {
  return status === 'in_progress' ? 'started' : status === 'completed' ? 'finished' : 'planned'
}

export function listMediaLibrary(filters: { kind?: MediaKind; status?: MediaStatus; owner?: MediaActor; query?: string } = {}) {
  const query = text(filters.query, 160).toLocaleLowerCase()
  const works = readState().works.filter(work => {
    if (filters.kind && work.kind !== filters.kind) return false
    if (filters.owner && !work.records[filters.owner]) return false
    if (filters.status && !Object.values(work.records).some(record => record?.status === filters.status)) return false
    if (query && ![work.title, work.original_title, ...work.creators].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)) return false
    return true
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return { works }
}

export function getMediaWork(id: string): MediaWork | undefined {
  return readState().works.find(work => work.id === id)
}

export function listMediaTimeline(limit = 100): MediaTimelineItem[] {
  return readState().works.flatMap(work => work.events.map(item => ({
    ...item,
    work_id: work.id,
    work_title: work.title,
    work_kind: work.kind,
    cover_url: work.cover_url,
  }))).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Math.max(1, Math.min(300, limit)))
}

export function saveMediaEntry(actorValue: unknown, input: SaveMediaInput): MediaWork {
  const actor = actorOf(actorValue)
  return mutate(state => {
    const now = new Date().toISOString()
    let work = input.work_id ? state.works.find(item => item.id === input.work_id) : undefined
    const isNew = !work
    if (!work) {
      const kind = MEDIA_KINDS.includes(input.kind as MediaKind) ? input.kind as MediaKind : 'book'
      const title = text(input.title, 200)
      if (!title) throw new Error('title required')
      const sourceProvider = text(input.source?.provider, 40)
      const sourceId = text(input.source?.id, 180)
      work = {
        id: randomUUID(), kind, title, original_title: text(input.original_title, 200) || undefined,
        creators: textList(input.creators), cover_url: text(input.cover_url, 1000) || undefined,
        summary: text(input.summary, 4000) || undefined, publisher: text(input.publisher, 200) || undefined,
        published_date: text(input.published_date, 40) || undefined, page_count: positiveInt(input.page_count, 100000),
        isbn: text(input.isbn, 32) || undefined, directors: textList(input.directors), cast: textList(input.cast, 30),
        countries: textList(input.countries), release_date: text(input.release_date, 40) || undefined,
        runtime_minutes: positiveInt(input.runtime_minutes, 100000),
        source: sourceProvider && sourceId ? { provider: sourceProvider, id: sourceId, url: text(input.source?.url, 1000) || undefined } : undefined,
        records: {}, notes: [], events: [], created_by: actor, created_at: now, updated_at: now,
      }
      state.works.push(work)
    } else if (work.created_by === actor) {
      if (text(input.title, 200)) work.title = text(input.title, 200)
      for (const key of ['original_title', 'cover_url', 'summary', 'publisher', 'published_date', 'isbn', 'release_date'] as const) {
        if (typeof input[key] === 'string') (work as any)[key] = text(input[key], key === 'summary' ? 4000 : 1000) || undefined
      }
      if (input.creators) work.creators = textList(input.creators)
      if (input.directors) work.directors = textList(input.directors)
      if (input.cast) work.cast = textList(input.cast, 30)
      if (input.countries) work.countries = textList(input.countries)
      if (input.page_count !== undefined) work.page_count = positiveInt(input.page_count, 100000)
      if (input.runtime_minutes !== undefined) work.runtime_minutes = positiveInt(input.runtime_minutes, 100000)
    }

    const prior = work.records[actor]
    const status = MEDIA_STATUSES.includes(input.status as MediaStatus) ? input.status as MediaStatus : prior?.status || 'planned'
    const rating = input.rating === null ? undefined : Number.isInteger(input.rating) && Number(input.rating) >= 1 && Number(input.rating) <= 5 ? Number(input.rating) : prior?.rating
    const review = typeof input.review === 'string' ? text(input.review, 8000) || undefined : prior?.review
    work.records[actor] = {
      status, rating, review,
      started_at: status === 'in_progress' ? prior?.started_at || now : prior?.started_at,
      finished_at: status === 'completed' ? prior?.finished_at || now : status === 'planned' ? undefined : prior?.finished_at,
      updated_at: now,
    }
    if (isNew) work.events.push(event(actor, 'added'))
    if (!prior || prior.status !== status) work.events.push(event(actor, statusEvent(status)))
    if (rating !== prior?.rating && rating) work.events.push(event(actor, 'rated', `${rating} 星`))
    if (review !== prior?.review && review) work.events.push(event(actor, 'reviewed', review.slice(0, 160)))
    work.updated_at = now
    return { result: work, write: true }
  })
}

export function writeMediaNote(actorValue: unknown, workId: string, input: { note_id?: string; type?: MediaNoteType; content: string; locator?: string }): MediaNote {
  const actor = actorOf(actorValue)
  const content = text(input.content, 12000)
  if (!content) throw new Error('content required')
  return mutate(state => {
    const work = state.works.find(item => item.id === workId)
    if (!work) throw new Error('work not found')
    const now = new Date().toISOString()
    let note = input.note_id ? work.notes.find(item => item.id === input.note_id && item.author === actor) : undefined
    if (input.note_id && !note) throw new Error('note not found or not owned')
    if (note) {
      note.content = content
      note.locator = text(input.locator, 100) || undefined
      note.type = input.type === 'quote' ? 'quote' : 'note'
      note.updated_at = now
    } else {
      note = { id: randomUUID(), author: actor, type: input.type === 'quote' ? 'quote' : 'note', content, locator: text(input.locator, 100) || undefined, created_at: now, updated_at: now }
      work.notes.push(note)
      work.events.push(event(actor, note.type, note.locator || content.slice(0, 160), note.id))
    }
    work.updated_at = now
    return { result: note, write: true }
  })
}

export function commentMediaEvent(actorValue: unknown, workId: string, eventId: string, contentValue: string): MediaComment {
  const actor = actorOf(actorValue)
  const content = text(contentValue, 3000)
  if (!content) throw new Error('content required')
  return mutate(state => {
    const work = state.works.find(item => item.id === workId)
    const target = work?.events.find(item => item.id === eventId)
    if (!work || !target) throw new Error('event not found')
    const comment = { id: randomUUID(), author: actor, content, created_at: new Date().toISOString() }
    target.comments.push(comment)
    work.updated_at = comment.created_at
    return { result: comment, write: true }
  })
}

export function deleteMediaContent(actorValue: unknown, target: DeleteMediaTarget): 'ok' | 'not_found' | 'shared_content' {
  const actor = actorOf(actorValue)
  return mutate(state => {
    const workIndex = state.works.findIndex(item => item.id === target.work_id)
    if (workIndex < 0) return { result: 'not_found' as const, write: false }
    const work = state.works[workIndex]
    if (target.type === 'work') {
      if (work.created_by !== actor || workHasOtherContent(work, actor)) return { result: 'shared_content' as const, write: false }
      state.works.splice(workIndex, 1)
      return { result: 'ok' as const, write: true }
    }
    if (target.type === 'record') {
      if (!work.records[actor]) return { result: 'not_found' as const, write: false }
      delete work.records[actor]
      work.notes = work.notes.filter(note => note.author !== actor)
      work.events = work.events.filter(item => item.actor !== actor).map(item => ({ ...item, comments: item.comments.filter(comment => comment.author !== actor) }))
      if (!workHasOtherContent(work, actor) && work.created_by === actor) state.works.splice(workIndex, 1)
      else work.updated_at = new Date().toISOString()
      return { result: 'ok' as const, write: true }
    }
    if (target.type === 'note') {
      const before = work.notes.length
      work.notes = work.notes.filter(note => !(note.id === target.note_id && note.author === actor))
      if (before === work.notes.length) return { result: 'not_found' as const, write: false }
      work.events = work.events.filter(item => item.target_id !== target.note_id)
      work.updated_at = new Date().toISOString()
      return { result: 'ok' as const, write: true }
    }
    const targetEvent = work.events.find(item => item.id === target.event_id)
    if (!targetEvent) return { result: 'not_found' as const, write: false }
    const before = targetEvent.comments.length
    targetEvent.comments = targetEvent.comments.filter(comment => !(comment.id === target.comment_id && comment.author === actor))
    if (before === targetEvent.comments.length) return { result: 'not_found' as const, write: false }
    work.updated_at = new Date().toISOString()
    return { result: 'ok' as const, write: true }
  })
}
