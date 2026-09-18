import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export type StoryShelf = 'moonlight' | 'undertow'
export type StoryStatus = 'draft' | 'complete'
export interface StorySection { id: string; text: string; chunk_key?: string; created_at: string; updated_at: string }
export interface Story {
  id: string
  title: string
  shelf: StoryShelf
  status: StoryStatus
  sections: StorySection[]
  favorite: boolean
  pinned: boolean
  story_key?: string
  created_at: string
  updated_at: string
}

interface StoryData { stories: Story[] }
const FILE = resolveDataPath(getDataDir(), 'stories', 'stories.json')
const options = {
  fallback: (): StoryData => ({ stories: [] }), fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object' && Array.isArray((value as StoryData).stories),
}
const now = () => new Date().toISOString()
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max)
const shelf = (value: unknown): StoryShelf => value === 'undertow' ? 'undertow' : 'moonlight'

function mutate<T>(fn: (data: StoryData) => T): T {
  let result!: T
  updateJsonFile(FILE, options, data => { result = fn(data); return data })
  return result
}

function find(data: StoryData, id: unknown): Story {
  const story = data.stories.find(item => item.id === id)
  if (!story) throw new Error('故事不存在')
  return story
}

export function listStories(): Array<Omit<Story, 'sections'> & { section_count: number; char_count: number }> {
  return readJsonFile(FILE, options).stories
    .map(({ sections, story_key: _storyKey, ...story }) => ({
      ...story, section_count: sections.length,
      char_count: sections.reduce((total, section) => total + section.text.length, 0),
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
}

export function getStory(id: string): Story {
  const story = readJsonFile(FILE, options).stories.find(item => item.id === id)
  if (!story) throw new Error('故事不存在')
  const { story_key: _storyKey, sections, ...publicStory } = story
  return { ...publicStory, sections: sections.map(({ chunk_key: _chunkKey, ...section }) => section) }
}

export function createStory(title: unknown, targetShelf: unknown, storyKey?: unknown): Story {
  const key = clean(storyKey, 160)
  return mutate(data => {
    const existing = key ? data.stories.find(item => item.story_key === key) : null
    if (existing) return existing
    const at = now()
    const story: Story = {
      id: randomUUID(), title: clean(title, 160) || '未题故事', shelf: shelf(targetShelf), status: 'draft',
      sections: [], favorite: false, pinned: false, ...(key ? { story_key: key } : {}), created_at: at, updated_at: at,
    }
    data.stories.unshift(story)
    return story
  })
}

export function appendStorySection(id: string, value: unknown, chunkKey?: unknown): { story: Story; section: StorySection; deduplicated: boolean } {
  const text = clean(value, 20_000)
  const key = clean(chunkKey, 160)
  if (!text) throw new Error('故事段落不能为空')
  let section!: StorySection
  let deduplicated = false
  const story = mutate(data => {
    const item = find(data, id)
    const existing = key ? item.sections.find(value => value.chunk_key === key) : null
    if (existing) { section = existing; deduplicated = true; return item }
    const at = now()
    section = { id: randomUUID(), text, ...(key ? { chunk_key: key } : {}), created_at: at, updated_at: at }
    item.sections.push(section)
    item.status = 'draft'
    item.updated_at = at
    return item
  })
  return { story, section, deduplicated }
}

export function updateStorySection(id: string, sectionId: string, value: unknown): Story {
  const text = clean(value, 20_000)
  if (!text) throw new Error('故事段落不能为空')
  return mutate(data => {
    const story = find(data, id)
    const section = story.sections.find(item => item.id === sectionId)
    if (!section) throw new Error('故事段落不存在')
    section.text = text
    section.updated_at = now()
    story.updated_at = section.updated_at
    return story
  })
}

export function replaceStoryBody(id: string, value: unknown): Story {
  const text = clean(value, 200_000)
  return mutate(data => {
    const story = find(data, id)
    const at = now()
    story.sections = text ? [{ id: randomUUID(), text, created_at: at, updated_at: at }] : []
    story.status = 'draft'
    story.updated_at = at
    return story
  })
}

export function updateStory(id: string, patch: Record<string, unknown>): Story {
  return mutate(data => {
    const story = find(data, id)
    if (patch.title !== undefined) story.title = clean(patch.title, 160) || '未题故事'
    if (patch.shelf !== undefined) story.shelf = shelf(patch.shelf)
    if (patch.favorite !== undefined) story.favorite = patch.favorite === true
    if (patch.pinned !== undefined) story.pinned = patch.pinned === true
    if (patch.status === 'draft') story.status = 'draft'
    if (patch.status === 'complete') {
      if (!story.sections.length) throw new Error('空故事不能标记为完成')
      story.status = 'complete'
    }
    story.updated_at = now()
    return story
  })
}

export function deleteStory(id: string): boolean {
  return mutate(data => {
    const before = data.stories.length
    data.stories = data.stories.filter(item => item.id !== id)
    return data.stories.length !== before
  })
}
