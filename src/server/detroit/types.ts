export type DetroitDifficulty = 'casual' | 'experienced' | 'hardcore'

export interface DetroitChoice {
  id: string
  text: string
}

export interface DetroitNode {
  id: string
  phase?: string
  type?: string
  condition?: unknown
  player_facing: Record<string, any>
  system?: Record<string, any>
}

export interface DetroitChapter {
  _meta?: Record<string, any>
  chapter: {
    id: string
    title?: string
    title_zh?: string
    chapter_number: number
    protagonist: string | string[]
  }
  system_prompt?: { content?: string }
  state?: { initial?: Record<string, any> }
  nodes: DetroitNode[]
  endings: Record<string, Record<string, any>>
  campaign?: Record<string, any>
}

export interface DetroitDecision {
  node_id: string
  phase?: string
  context: string
  choices: DetroitChoice[]
  choice_id: string | null
  choice_text: string | null
  reasoning: string | null
  resolution: string | null
}

export interface DetroitScene {
  node_index: number
  node_id: string
  phase?: string
  context: string
  choices: DetroitChoice[]
}

export interface DetroitActiveChapter {
  chapter_id: string
  cursor: number
  state: Record<string, any>
  decisions: DetroitDecision[]
  ended_tracks: string[]
  collected_endings: string[]
  current: DetroitScene | null
}

export interface DetroitCompletedChapter {
  index: number
  chapter_id: string
  title: string
  ending: Record<string, any>
  all_endings: Record<string, any>[]
  decisions: DetroitDecision[]
  finished_at: string
}

export interface DetroitCampaign {
  schema_version: 1
  campaign_id: string
  difficulty: DetroitDifficulty
  status: 'playing' | 'between_chapters' | 'complete'
  chapter_index: number
  active: DetroitActiveChapter | null
  completed_chapters: DetroitCompletedChapter[]
  cross_chapter_state: Record<string, any>
  memory_segments: string[]
  created_at: string
  updated_at: string
}
