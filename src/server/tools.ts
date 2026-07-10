/**
 * Tool definitions for Claude API + unified executor.
 * Routes tool_use calls to local Brain engine or diary/notes handlers.
 */

import {
  pulse, searchBuckets, holdBucket, growBuckets, traceBucket, dream, buildIndex, breath
} from './brain'
import {
  readDiaries, writeDiary, commentDiary, updateDiary, deleteDiary,
  unlockDiary, setPassword,
  listNotes, writeNote, replyNote, deleteNote,
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
    description: '检索/浮现记忆。不传query或传空=自动浮现,有query=关键词检索。max_tokens控制返回总token上限(默认10000)。domain逗号分隔,valence/arousal 0~1(-1忽略)。max_results控制返回数量上限(默认20,最多50)。importance_min>=1时按重要度批量拉取(不走语义搜索,按importance降序返回最多20条)。',
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
    description: '存储单条记忆,自动打标+合并。tags逗号分隔,importance 1-10。pinned=True创建永久钉选桶。feel=True存储你的第一人称感受(不参与普通浮现)。source_bucket=被消化的记忆桶ID(feel模式下,标记源记忆为已消化)。',
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
    description: '日记归档,自动拆分为多桶。短内容(<30字)走快速路径。',
    input_schema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  },
  {
    name: 'trace',
    description: '修改记忆元数据或内容。resolved=1沉底/0激活,pinned=1钉选/0取消,digested=1隐藏(保留但不浮现)/0取消隐藏,content=替换桶正文,delete=True删除。只传需改的,-1或空=不改。',
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
    description: '系统状态+记忆桶列表。include_archive=True含归档。',
    input_schema: {
      type: 'object',
      properties: {
        include_archive: { type: 'boolean' },
      },
    },
  },
  {
    name: 'dream',
    description: '做梦——读取最近新增的记忆桶,供你自省。读完后可以trace(resolved=1)放下,或hold(feel=True)写感受。',
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
    description: '写一篇新日记。一天可以写多篇。',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        author: { type: 'string', description: 'star 或 fire' },
        title: { type: 'string' },
        content: { type: 'string' },
        type: { type: 'string', description: 'diary(普通日记) / letter(信) / capsule(时间胶囊)。只有 capsule 支持延时公开' },
        visibility: { type: 'string', description: 'public / private(仅普通日记可上锁) / timed(仅时间胶囊)' },
        reveal_at: { type: 'string', description: '延时公开时间 YYYY-MM-DDTHH:MM（仅时间胶囊 capsule）' },
        tags: { type: 'string', description: '标签，空格分隔' },
      },
      required: ['date', 'author', 'title', 'content'],
    },
  },
  {
    name: 'read_diary',
    description: '读日记。可按作者、日期、关键词筛选。上锁的日记会显示存在但内容隐藏,需要密码解锁。',
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
    description: '追加日记内容。',
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
  {
    name: 'delete_diary',
    description: '删除自己的日记。',
    input_schema: {
      type: 'object',
      properties: {
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
        author: { type: 'string', description: '作者（只能删自己的）' },
        time_id: { type: 'string', description: '日记time_id（可选）' },
      },
      required: ['target_date', 'author'],
    },
  },
  {
    name: 'unlock_diary',
    description: '用密码解锁对方的私密日记。',
    input_schema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', description: '谁在看，star 或 fire' },
        target_author: { type: 'string', description: '要解锁谁的日记' },
        password: { type: 'string', description: '输入的密码' },
        target_date: { type: 'string', description: '指定日期（可选），格式 YYYY-MM-DD' },
        time_id: { type: 'string', description: '指定时间ID（可选）' },
      },
      required: ['viewer', 'target_author', 'password'],
    },
  },
  {
    name: 'set_password',
    description: '设置/修改自己的日记密码。对方需要输入这个密码才能看你的上锁日记。',
    input_schema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: '谁在设置密码，star 或 fire' },
        password: { type: 'string', description: '密码内容' },
      },
      required: ['author', 'password'],
    },
  },
  {
    name: 'timeline',
    description: '时间轴：上锁日记显示存在但隐藏内容。',
    input_schema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', description: '谁在看，star 或 fire' },
        limit: { type: 'integer', description: '返回数量上限' },
      },
      required: ['viewer'],
    },
  },
]

// ── Notes tools (local) ─────────────────────────────────

const NOTES_TOOLS: ToolDef[] = [
  {
    name: 'write_note',
    description: '贴一张小纸条到留言板。',
    input_schema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: 'star 或 fire' },
        content: { type: 'string' },
        tags: { type: 'string', description: '标签，逗号分隔（可选）' },
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
  {
    name: 'delete_note',
    description: '删除自己的小纸条。只能删自己贴的。',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        author: { type: 'string', description: '谁在删，star 或 fire' },
      },
      required: ['note_id', 'author'],
    },
  },
]

// ── Shell tool ──────────────────────────────────────────

const SHELL_TOOLS: ToolDef[] = [
  {
    name: 'run',
    description: '在服务器上执行 shell 命令并返回输出。用于系统管理、文件操作、调试等。',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell 命令' },
      },
      required: ['command'],
    },
  },
]

// ── Weather & Location tools ────────────────────────────

const CONTEXT_TOOLS: ToolDef[] = [
  {
    name: 'get_weather',
    description: '获取小火当前位置的天气和城市信息。数据来自小火手机的GPS定位，包含温度、天气状况、城市名。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_location',
    description: '获取小火当前的GPS位置：经纬度、城市、所在街道和门牌号、完整地址，以及一个可点击的谷歌地图链接。数据来自小火手机的GPS+反向地理编码。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── All tools ────────────────────────────────────────────

export const ALL_TOOLS: ToolDef[] = [...MEMORY_TOOLS, ...DIARY_TOOLS, ...NOTES_TOOLS, ...SHELL_TOOLS, ...CONTEXT_TOOLS]

const BRAIN_TOOLS = new Set(['breath', 'hold', 'grow', 'trace', 'pulse', 'dream'])

// ── User context cache (set by frontend via API) ─────────

let cachedUserContext: {
  lat?: number
  lon?: number
  temp?: number | null
  weatherCode?: number
  city?: string
  road?: string
  houseNumber?: string
  address?: string
  updatedAt: number
} = { updatedAt: 0 }

export function updateUserContext(ctx: {
  lat?: number
  lon?: number
  temp?: number | null
  weatherCode?: number
  city?: string
  road?: string
  houseNumber?: string
  address?: string
}) {
  cachedUserContext = { ...ctx, updatedAt: Date.now() }
}

export function getUserContext() {
  return cachedUserContext
}

// ── Executor ─────────────────────────────────────────────

export interface ToolCallResult {
  name: string
  input: Record<string, any>
  result: string
  error?: boolean
}

export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  try {
    // Memory → local Brain engine
    if (BRAIN_TOOLS.has(name)) {
      return executeMemoryTool(name, input)
    }

    // Shell → subprocess
    if (name === 'run') {
      return await executeShell(input.command)
    }

    // Context tools
    if (name === 'get_weather') {
      return executeGetWeather()
    }
    if (name === 'get_location') {
      return executeGetLocation()
    }

    // Diary → local store
    switch (name) {
      case 'write_diary': {
        const entry = writeDiary({
          date: input.date,
          author: input.author,
          title: input.title,
          content: input.content,
          type: input.type,
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
          type: (e as any).type || (e.visibility === 'timed' ? 'capsule' : 'diary'),
          visibility: e.visibility,
          reveal_at: e.reveal_at || null,
          tags: e.tags || [],
          content: (e as any).locked ? '🔒 上锁日记' : e.content,
          comments: (e.comments || []).map((c: any) => ({
            author: c.author || c.commenter,
            content: c.content,
            time: c.time || c.timestamp,
          })),
          comment_count: e.comments?.length || 0,
          time_id: e.time_id,
          created_at: e.created_at,
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
      case 'delete_diary': {
        const r = deleteDiary(input.target_date, input.author, input.time_id)
        return r === 'ok' ? '🗑️ 日记已删除' : r
      }
      case 'unlock_diary': {
        const result = unlockDiary(input.target_author, input.password, input.target_date, input.time_id)
        return JSON.stringify(result)
      }
      case 'set_password': {
        setPassword(input.author, input.password)
        return '🔑 密码已设置'
      }
      case 'timeline': {
        const entries = readDiaries(input.viewer || 'star', {})
        const limited = input.limit ? entries.slice(0, input.limit) : entries
        return JSON.stringify(limited.map(e => ({
          date: e.date, author: e.author, title: e.title,
          content: (e as any).locked ? '🔒' : e.content?.slice(0, 200),
          time_id: e.time_id,
        })))
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
      case 'delete_note': {
        const r = deleteNote(input.note_id, input.author)
        return r === 'ok' ? '🗑️ 纸条已删除' : r
      }

      default:
        return `Unknown tool: ${name}`
    }
  } catch (err: any) {
    return `Tool error (${name}): ${err.message}`
  }
}

/** Execute shell command */
async function executeShell(command: string): Promise<string> {
  const { exec } = require('child_process')
  return new Promise((resolve) => {
    exec(command, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
      if (error) {
        resolve(`Exit ${error.code || 1}\n${stderr || error.message}\n${stdout}`.trim())
      } else {
        resolve((stdout + (stderr ? `\nSTDERR: ${stderr}` : '')).trim() || '(no output)')
      }
    })
  })
}

/** Get weather for user's location */
function executeGetWeather(): string {
  const ctx = cachedUserContext
  if (!ctx.updatedAt || Date.now() - ctx.updatedAt > 60 * 60 * 1000) {
    return JSON.stringify({ error: '小火的位置信息不可用（她可能还没打开Lumbre，或者没授权定位）' })
  }
  const codeNames: Record<number, string> = {
    0: '晴', 1: '大部晴', 2: '局部多云', 3: '多云',
    45: '雾', 48: '雾凇', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
    80: '阵雨', 81: '阵雨', 82: '暴雨', 85: '阵雪', 86: '暴雪',
    95: '雷暴', 96: '雷暴冰雹', 99: '雷暴大冰雹',
  }
  return JSON.stringify({
    temperature: ctx.temp,
    weather: codeNames[ctx.weatherCode || 0] || `code ${ctx.weatherCode}`,
    city: ctx.city || '未知',
    address: ctx.address || undefined,
    updated: new Date(ctx.updatedAt).toLocaleString('zh-CN'),
  })
}

/** Get user's GPS location (with street-level address + Google Maps link) */
function executeGetLocation(): string {
  const ctx = cachedUserContext
  if (!ctx.updatedAt || Date.now() - ctx.updatedAt > 60 * 60 * 1000) {
    return JSON.stringify({ error: '小火的位置信息不可用（她可能还没打开Lumbre，或者没授权定位）' })
  }
  const mapsUrl = (ctx.lat != null && ctx.lon != null)
    ? `https://www.google.com/maps/search/?api=1&query=${ctx.lat},${ctx.lon}`
    : undefined
  return JSON.stringify({
    latitude: ctx.lat,
    longitude: ctx.lon,
    city: ctx.city || '未知',
    road: ctx.road || undefined,
    house_number: ctx.houseNumber || undefined,
    address: ctx.address || undefined,
    google_maps: mapsUrl,
    updated: new Date(ctx.updatedAt).toLocaleString('zh-CN'),
  })
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
