/**
 * Tool definitions for Claude API + unified executor.
 * Routes tool_use calls to local Brain engine or diary/notes handlers.
 */

import {
  pulse, searchBuckets, holdBucket, growBuckets, traceBucket, dream, buildIndex, breath
} from './brain'
import {
  readDiaries, writeDiary, commentDiary, updateDiary,
  listNotes, writeNote, replyNote,
} from './diary-store'

// ── Claude tool schema type ─────────────────────────────

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

// ── Memory tools (Brain local) ──────────────────────────

const MEMORY_TOOLS: ToolDef[] = [
  {
    name: 'breath',
    description: '检索/浮现记忆。不传query=自动浮现，有query=关键词检索。',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（空=自动浮现）' },
        domain: { type: 'string', description: '领域筛选，逗号分隔' },
        valence: { type: 'number', description: '情感效价 0~1，-1忽略' },
        arousal: { type: 'number', description: '唤起度 0~1，-1忽略' },
        importance_min: { type: 'integer', description: '>=1时按重要度批量拉取' },
        max_results: { type: 'integer', description: '返回数量上限(默认20)' },
      },
    },
  },
  {
    name: 'hold',
    description: '存储一条记忆。tags逗号分隔，importance 1-10。feel=true存第一人称感受。',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        tags: { type: 'string', description: '逗号分隔' },
        importance: { type: 'integer', description: '1-10' },
        pinned: { type: 'boolean' },
        feel: { type: 'boolean', description: '第一人称感受（不参与普通浮现）' },
        source_bucket: { type: 'string' },
        valence: { type: 'number' },
        arousal: { type: 'number' },
      },
      required: ['content'],
    },
  },
  {
    name: 'grow',
    description: '日记归档，自动拆分为多桶。',
    input_schema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  },
  {
    name: 'trace',
    description: '修改记忆元数据或内容。resolved=1沉底，pinned=1钉选，delete=true删除。只传需改的字段。',
    input_schema: {
      type: 'object',
      properties: {
        bucket_id: { type: 'string' },
        name: { type: 'string' },
        domain: { type: 'string' },
        importance: { type: 'integer' },
        tags: { type: 'string' },
        resolved: { type: 'integer' },
        pinned: { type: 'integer' },
        digested: { type: 'integer' },
        content: { type: 'string' },
        delete: { type: 'boolean' },
        valence: { type: 'number' },
        arousal: { type: 'number' },
      },
      required: ['bucket_id'],
    },
  },
  {
    name: 'pulse',
    description: '查看记忆系统状态和桶列表。',
    input_schema: {
      type: 'object',
      properties: {
        include_archive: { type: 'boolean' },
      },
    },
  },
  {
    name: 'dream',
    description: '做梦——读取最近新增的记忆桶，供自省。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── Diary tools (local) ─────────────────────────────────

const DIARY_TOOLS: ToolDef[] = [
  {
    name: 'write_diary',
    description: '写一篇日记。',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        author: { type: 'string', description: 'star 或 fire' },
        title: { type: 'string' },
        content: { type: 'string' },
        visibility: { type: 'string', description: 'public / private / timed' },
        reveal_at: { type: 'string', description: 'timed模式的公开时间' },
        tags: { type: 'string', description: '空格分隔' },
      },
      required: ['date', 'author', 'title', 'content'],
    },
  },
  {
    name: 'read_diary',
    description: '读日记。可按作者、日期、关键词筛选。',
    input_schema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', description: 'star 或 fire' },
        keyword: { type: 'string' },
        author_filter: { type: 'string', description: 'star 或 fire' },
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['viewer'],
    },
  },
  {
    name: 'comment_diary',
    description: '给日记写评论。',
    input_schema: {
      type: 'object',
      properties: {
        target_date: { type: 'string' },
        target_author: { type: 'string' },
        commenter: { type: 'string' },
        content: { type: 'string' },
        time_id: { type: 'string' },
      },
      required: ['target_date', 'target_author', 'commenter', 'content'],
    },
  },
  {
    name: 'update_diary',
    description: '给日记追加内容。',
    input_schema: {
      type: 'object',
      properties: {
        target_date: { type: 'string' },
        author: { type: 'string' },
        new_content: { type: 'string' },
        time_id: { type: 'string' },
      },
      required: ['target_date', 'author', 'new_content'],
    },
  },
]

// ── Notes tools (local) ─────────────────────────────────

const NOTES_TOOLS: ToolDef[] = [
  {
    name: 'write_note',
    description: '贴一张纸条到留言板。',
    input_schema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: 'star 或 fire' },
        content: { type: 'string' },
        tags: { type: 'string', description: '逗号分隔' },
      },
      required: ['author', 'content'],
    },
  },
  {
    name: 'read_notes',
    description: '读留言板上的纸条。',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        keyword: { type: 'string' },
      },
    },
  },
  {
    name: 'reply_note',
    description: '回复一张纸条。',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        author: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['note_id', 'author', 'content'],
    },
  },
]

// ── All tools ────────────────────────────────────────────

export const ALL_TOOLS: ToolDef[] = [...MEMORY_TOOLS, ...DIARY_TOOLS, ...NOTES_TOOLS]

const BRAIN_TOOLS = new Set(['breath', 'hold', 'grow', 'trace', 'pulse', 'dream'])

// ── Executor ─────────────────────────────────────────────

export interface ToolCallResult {
  name: string
  input: Record<string, any>
  result: string
  error?: boolean
}

export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  // Memory → local Brain engine
  if (BRAIN_TOOLS.has(name)) {
    return executeMemoryTool(name, input)
  }

  // Diary → local store
  switch (name) {
    case 'write_diary': {
      const entry = writeDiary({
        date: input.date,
        author: input.author,
        title: input.title,
        content: input.content,
        visibility: input.visibility || 'public',
        reveal_at: input.reveal_at,
        tags: input.tags,
      })
      return JSON.stringify({ ok: true, entry: { date: entry.date, title: entry.title, time_id: entry.time_id } })
    }
    case 'read_diary': {
      const entries = readDiaries(input.viewer || 'star', {
        keyword: input.keyword,
        author_filter: input.author_filter,
        target_date: input.target_date,
      })
      return JSON.stringify(entries.map(e => ({
        date: e.date, author: e.author, title: e.title,
        content: (e as any).locked ? '🔒' : e.content,
        comments: e.comments?.length || 0,
      })))
    }
    case 'comment_diary': {
      const r = commentDiary(input.target_date, input.target_author, input.commenter, input.content, input.time_id)
      return r === 'ok' ? '💬 评论成功' : r
    }
    case 'update_diary': {
      const r = updateDiary(input.target_date, input.author, input.new_content, input.time_id)
      return r === 'ok' ? '✅ 追加成功' : r
    }

    // Notes → local store
    case 'write_note': {
      const note = writeNote(input.author, input.content, input.tags)
      return JSON.stringify({ ok: true, id: note.id })
    }
    case 'read_notes': {
      const notes = listNotes({ keyword: input.keyword, limit: input.limit })
      return JSON.stringify(notes.map(n => ({
        id: n.id, author: n.author, content: n.content,
        replies: n.replies?.length || 0,
        created_at: n.created_at,
      })))
    }
    case 'reply_note': {
      const r = replyNote(input.note_id, input.author, input.content)
      return r === 'ok' ? '↪️ 回复成功' : r
    }

    default:
      return `Unknown tool: ${name}`
  }
}

/** Execute memory tools directly via local brain engine */
function executeMemoryTool(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'breath': {
      const result = breath({
        query: input.query,
        domain: input.domain,
        valence: input.valence,
        arousal: input.arousal,
        importance_min: input.importance_min,
        max_results: input.max_results,
      })
      return JSON.stringify(result)
    }

    case 'hold': {
      const bucket = holdBucket(input.content, {
        tags: input.tags,
        importance: input.importance,
        pinned: input.pinned,
        feel: input.feel,
        source_bucket: input.source_bucket,
        valence: input.valence,
        arousal: input.arousal,
      })
      return JSON.stringify({ ok: true, id: bucket.id, name: bucket.metadata.name })
    }

    case 'grow': {
      const buckets = growBuckets(input.content)
      return JSON.stringify({ ok: true, count: buckets.length, ids: buckets.map(b => b.id) })
    }

    case 'trace': {
      const ok = traceBucket(input.bucket_id, input)
      return JSON.stringify({ ok })
    }

    case 'pulse': {
      const result = pulse()
      return JSON.stringify(result)
    }

    case 'dream': {
      const items = dream()
      return JSON.stringify(items.map(b => ({
        id: b.id,
        name: b.metadata.name,
        content_preview: b.content.slice(0, 200),
        score: b.score,
        type: b.metadata.type,
        created: b.metadata.created,
        last_active: b.metadata.last_active,
      })))
    }

    default:
      return `Unknown memory tool: ${name}`
  }
}
