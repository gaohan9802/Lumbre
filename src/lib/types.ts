// Core types

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  thinking?: string
}

export interface DiaryEntry {
  date: string
  author: 'star' | 'fire'
  title: string
  content: string
  visibility: 'public' | 'private' | 'timed'
  reveal_at?: string
  comments?: Comment[]
  time_id?: string
}

export interface Comment {
  commenter: 'star' | 'fire'
  content: string
  timestamp: string
}

export interface Note {
  id: string
  author: 'star' | 'fire'
  content: string
  tags?: string
  replies?: NoteReply[]
  created_at: string
}

export interface NoteReply {
  author: 'star' | 'fire'
  content: string
  timestamp: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  assignee?: 'star' | 'fire'
  created_at: string
}

export interface TodoReceipt {
  date: string
  items: TodoItem[]
  receipt_no: string
}

export interface Anniversary {
  id: string
  title: string
  date: string // YYYY-MM-DD
  recurring: boolean
  emoji?: string
}

export interface MemoryBucket {
  id: string
  name: string
  content: string
  tags: string[]
  domain: string
  importance: number
  valence: number
  arousal: number
  pinned: boolean
  created_at: string
}
