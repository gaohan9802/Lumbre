import type { CoreadFormat, MediaActor } from './media-library'

export interface CoreadParagraph {
  idx: number
  chapter_id: string
  text: string
}

export interface CoreadChapter {
  id: string
  title: string
  start_idx: number
  end_idx: number
}

export interface CoreadBook {
  version: 1
  work_id: string
  file_name: string
  format: CoreadFormat
  checksum: string
  chapters: CoreadChapter[]
  paragraphs: CoreadParagraph[]
  created_at: string
}

export interface CoreadProgress {
  paragraph_idx: number
  offset: number
  updated_at: string
}

export interface CoreadAnnotation {
  id: string
  author: MediaActor
  paragraph_idx: number
  start_offset: number
  end_offset: number
  selected_text: string
  content: string
  reply_to?: string
  created_at: string
  updated_at: string
}

export interface CoreadState {
  version: 1
  progress: Partial<Record<MediaActor, CoreadProgress>>
  annotations: CoreadAnnotation[]
}
