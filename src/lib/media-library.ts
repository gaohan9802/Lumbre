export type MediaActor = 'fire' | 'star'
export type MediaKind = 'book' | 'movie' | 'tv'
export type MediaStatus = 'planned' | 'in_progress' | 'completed'
export type MediaNoteType = 'note' | 'quote'

export interface MediaComment {
  id: string
  author: MediaActor
  content: string
  created_at: string
}

export interface MediaRecord {
  status: MediaStatus
  rating?: number
  review?: string
  started_at?: string
  finished_at?: string
  updated_at: string
}

export interface MediaNote {
  id: string
  author: MediaActor
  type: MediaNoteType
  content: string
  locator?: string
  created_at: string
  updated_at: string
}

export type MediaEventType = 'added' | 'planned' | 'started' | 'finished' | 'rated' | 'reviewed' | 'note' | 'quote'

export interface MediaEvent {
  id: string
  actor: MediaActor
  type: MediaEventType
  detail?: string
  target_id?: string
  comments: MediaComment[]
  created_at: string
}

export interface MediaWork {
  id: string
  kind: MediaKind
  title: string
  original_title?: string
  creators: string[]
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
  records: Partial<Record<MediaActor, MediaRecord>>
  notes: MediaNote[]
  events: MediaEvent[]
  created_by: MediaActor
  created_at: string
  updated_at: string
}

export interface MediaTimelineItem extends MediaEvent {
  work_id: string
  work_title: string
  work_kind: MediaKind
  cover_url?: string
}

export interface MediaCatalogItem {
  key: string
  kind: MediaKind
  title: string
  original_title?: string
  creators: string[]
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
  source: { provider: string; id: string; url?: string }
}

export const MEDIA_KINDS: MediaKind[] = ['book', 'movie', 'tv']
export const MEDIA_STATUSES: MediaStatus[] = ['planned', 'in_progress', 'completed']
