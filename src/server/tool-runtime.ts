/**
 * Compatibility runtime for the existing 66 tool handlers and schemas.
 * New callers must use server/agent/registry + server/agent/executor so policy,
 * confirmation and audit checks cannot be skipped accidentally.
 */

import { addMadridDays, madridCalendarDayDiff, madridDateKey, parseMadridDateTime } from '@/lib/madrid-time'
import { sendEmail, readEmails, searchEmails, readEmailDetail, replyEmail, checkGmailStatus } from "./gmail"
import {
  pulse, searchBuckets, holdBucket, growBuckets, traceBucket, dream, buildIndex, breath
} from './brain'
import {
  readDiaries, writeDiary, commentDiary, updateDiary, deleteDiary,
  unlockDiary, setPassword,
  listNotes, writeNote, replyNote, deleteNote,
} from './diary-store'
import { listPhotos, getPhoto, editPhoto, deletePhoto, commentPhoto } from './photo-store'

/** Format an epoch/Date as Madrid local time (Europe/Madrid, auto DST). */
function madridTime(d: Date | number = new Date()): string {
  const date = typeof d === 'number' ? new Date(d) : d
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}
import { getTodos, commentTodo, addTodo, editTodo, removeTodo } from './todo-store'
import { getCurrentActivity, listActivities, timelineDurationSeconds, getTimelineTags, startActivity, stopActivity } from './timeline-store'
import { createManyEncouragements, listEncouragements, updateEncouragement, deleteEncouragement, matchingEncouragements } from './encouragement-store'
import { getThesis, commentThesis } from './thesis-store'
import { getWishes, addWish, editWish, deleteWish, likeWish, commentWish } from './wish-store'
import { scheduleWake } from './autowake'
import { getPeriodState, recordPeriodStart, recordPeriodEnd, updatePeriodConfig } from './period-store'
import { addSharedBookmark, editSharedBookmark, listSharedBookmarks } from './bookmark-store'
import { listCoupons, createCoupon, signCoupon, updateCoupon, useCoupon, requestVoid, confirmVoid, couponContext } from './coupon-store'
import { executeSafeFetch } from './agent/tools/web-fetch'
import { getUserContext as readUserContext } from './agent/tools/user-context'
export { getUserContext, updateUserContext } from './agent/tools/user-context'

const BRAIN_TOOLS = new Set(['breath', 'hold', 'grow', 'trace', 'pulse', 'dream'])

// ── Executor ─────────────────────────────────────────────

export interface ToolCallResult {
  name: string
  input: Record<string, any>
  result: string
  error?: boolean
}

export async function executeRegisteredToolHandler(
  name: string,
  input: Record<string, any>,
): Promise<string> {
  try {
    // Memory → local Brain engine
    if (BRAIN_TOOLS.has(name)) {
      return executeMemoryTool(name, input)
    }

    // Context tools
    if (name === 'get_weather') {
      return executeGetWeather()
    }
    if (name === 'get_location') {
      return executeGetLocation()
    }

    // Period tracking
    if (name === 'update_period') {
      const { action, date, cycle_days, period_length } = input
      if (action === 'start' && date) return JSON.stringify(recordPeriodStart(date))
      if (action === 'end' && date) return JSON.stringify(recordPeriodEnd(date))
      if (action === 'config') return JSON.stringify(updatePeriodConfig(cycle_days, period_length))
      return JSON.stringify({ error: 'Invalid action or missing date' })
    }
    if (name === 'read_period') {
      const state = getPeriodState()
      const today = madridDateKey()
      const result: any = { ...state }
      if (state.last_period_start) {
        const daysSince = madridCalendarDayDiff(today, state.last_period_start) + 1
        const active = daysSince >= 1 && daysSince <= state.period_length + 2 && !state.last_period_end
        result.current_day = daysSince
        result.is_active = active
        if (!active) {
          const expected = addMadridDays(state.last_period_start, state.cycle_days)
          result.next_expected = expected
          result.days_until_next = madridCalendarDayDiff(expected, today)
        }
      }
      return JSON.stringify(result)
    }


    // World-book bookmarks. Deletion is deliberately not exposed.
    if (name === 'read_bookmarks') return JSON.stringify(listSharedBookmarks())
    if (name === 'add_bookmark') return JSON.stringify({ ok: true, bookmark: addSharedBookmark(input) })
    if (name === 'edit_bookmark') {
      const { id, ...patch } = input
      return JSON.stringify({ ok: true, bookmark: editSharedBookmark(String(id || ''), patch) })
    }

    // Gmail tools
    if (name === "gmail_status") {
      return JSON.stringify(await checkGmailStatus())
    }
    if (name === "send_email") {
      const r = await sendEmail(input.to, input.subject, input.body)
      return JSON.stringify(r)
    }
    if (name === "read_emails") {
      const emails = await readEmails(input.limit || 10)
      return JSON.stringify(emails)
    }
    if (name === "search_emails") {
      const emails = await searchEmails(input.query, input.limit || 10)
      return JSON.stringify(emails)
    }
    if (name === "read_email_detail") {
      const detail = await readEmailDetail(input.id)
      return JSON.stringify(detail)
    }
    if (name === "reply_email") {
      const r = await replyEmail(input.id, input.body)
      return JSON.stringify(r)
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

      // Photos → local store
      case 'read_foto': {
        // Text-only: never carries the base64 image, so it can't blow up the
        // request payload / get terminated by a relay. Use view_foto to see one.
        const photos = listPhotos({ limit: input.limit || 20 })
        return JSON.stringify(photos.map(ph => ({
          id: ph.id, author: ph.author, caption: ph.caption,
          comments: (ph.comments || []).map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
          created_at: ph.created_at,
        })))
      }
      case 'view_foto': {
        const ph = getPhoto(input.id)
        if (!ph) return JSON.stringify({ error: 'not_found', id: input.id })
        // Include url so the chat route injects the actual image (single photo →
        // bounded payload). The text history strips it.
        return JSON.stringify({
          id: ph.id, author: ph.author, caption: ph.caption, url: ph.url,
          comments: (ph.comments || []).map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
          created_at: ph.created_at,
        })
      }
      case 'edit_foto': {
        const r = editPhoto(input.id, { caption: input.caption })
        return r === 'ok' ? '🖊️ 照片说明已更新' : r
      }
      case 'delete_foto': {
        const r = deletePhoto(input.id)
        return r === 'ok' ? '🗑️ 照片已删除' : r
      }
      case 'comment_foto': {
        const r = commentPhoto(input.id, input.author || 'star', input.content)
        return r === 'ok' ? '💬 评论成功' : r
      }


      case 'write_timeline_encouragements': return JSON.stringify({ created: createManyEncouragements(input.items || []) })
      case 'read_timeline_encouragements': { const c=getCurrentActivity(); return JSON.stringify({ tags:getTimelineTags(), all:listEncouragements(), matching:matchingEncouragements(c?.tags||[]) }) }
      case 'edit_timeline_encouragement': return JSON.stringify(updateEncouragement(input.id, input))
      case 'delete_timeline_encouragement': return deleteEncouragement(input.id) ? '已删除鼓励话' : '鼓励话不存在'

      // Life timeline → read-only for 星星
      case 'read_life_timeline': {
        const madridDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
        const madridMidnight = (day: string) => {
          const [y, m, d] = day.split('-').map(Number)
          let guess = Date.UTC(y, m - 1, d, 0, 0, 0)
          const parts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
          }).formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)])) as Record<string, number>
          // Two passes also handle the CET/CEST boundary without a hard-coded offset.
          for (let i = 0; i < 2; i++) {
            const p = parts(guess)
            const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second)
            guess += Date.UTC(y, m - 1, d, 0, 0, 0) - represented
          }
          return guess
        }
        const bounds = (day: string, days = 1) => {
          const [y, m, d] = day.split('-').map(Number)
          const start = madridMidnight(day)
          const endDate = new Date(Date.UTC(y, m - 1, d + days))
          const endDay = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`
          return [new Date(start).toISOString(), new Date(madridMidnight(endDay)).toISOString()]
        }
        let from = input.from, to = input.to
        if (input.week_start) [from, to] = bounds(input.week_start, 7)
        else if (input.date) [from, to] = bounds(input.date, 1)
        else if (!from && !to) [from, to] = bounds(madridDay(new Date()), 1)
        const records = listActivities(from, to)
        const current = getCurrentActivity()
        return JSON.stringify({
          range: { from, to },
          current: current ? { ...current, duration_seconds: timelineDurationSeconds(current) } : null,
          records: records.map(r => ({
            id: r.id, title: r.title, tags: r.tags, note: r.note, end_note: r.end_note,
            start_at: r.start_at, end_at: r.end_at || null,
            duration_seconds: timelineDurationSeconds(r),
            duration_minutes: Math.round(timelineDurationSeconds(r) / 60),
          })),
        })
      }

      // Todo → local store
      case 'read_todo': {
        const day = getTodos(input.date)
        return JSON.stringify({
          date: day.date,
          items: day.items.map(it => ({
            id: it.id, text: it.text, done: it.done,
            by: it.author === 'fire' ? '🦦 小火' : '🐆 星星',
            author: it.author,
            carried: !!it.carried,
            comments: (it.comments || []).map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
          })),
        })
      }
      case 'add_todo': {
        const item = addTodo(input.text, input.author || 'star', input.date)
        return JSON.stringify({ ok: true, id: item.id, text: item.text })
      }
      case 'edit_todo': {
        const r = editTodo(input.id, input.text, input.date)
        return r === 'ok' ? '✏️ 待办已修改' : r
      }
      case 'remove_todo': {
        const r = removeTodo(input.id, input.date)
        return r === 'ok' ? '🗑️ 待办已删除' : r
      }
      case 'comment_todo': {
        const r = commentTodo(input.id, input.author || 'star', input.content, input.date)
        return r === 'ok' ? '💬 已点评' : r
      }

      // Coupon promise wallet
      case 'read_coupons': return JSON.stringify(listCoupons())
      case 'create_coupon': return JSON.stringify({ok:true,coupon:createCoupon(input, 'star')})
      case 'sign_coupon': return JSON.stringify({ok:true,coupon:signCoupon(input.id, 'star')})
      case 'edit_coupon': return JSON.stringify({ok:true,coupon:updateCoupon(input.id, input, 'star')})
      case 'use_coupon': return JSON.stringify({ok:true,coupon:useCoupon(input.id, 'fire')})
      case 'void_coupon': return JSON.stringify({ok:true,coupon:requestVoid(input.id, 'star')})
      case 'confirm_void_coupon': return JSON.stringify({ok:true,coupon:confirmVoid(input.id, 'fire')})

      // Tesis (thesis) → local store
      case 'read_thesis': {
        const t = getThesis()
        return JSON.stringify({
          totals: t.totals,
          chapters: t.chapters.map((c: any) => ({
            id: c.id, title: c.title,
            totalPages: c.totalPages, currentPages: c.currentPages,
            percent: c.totalPages > 0 ? Math.round((c.currentPages / c.totalPages) * 100) : 0,
          })),
          progress: t.progress,
          comments: t.comments.map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
        })
      }
      case 'comment_thesis': {
        const r = commentThesis(input.author || 'star', input.content)
        return r === 'ok' ? '💬 已在论文区留下评论' : r
      }

      // Wishlist (2026 愿望清单) → local store
      case 'view_wish': {
        const s = getWishes()
        return JSON.stringify({
          wishes: s.wishes.map((w) => ({
            id: w.id,
            author: w.author,
            by: w.author === 'fire' ? '🦦 小火' : '🐆 星星',
            title: w.title,
            desc: w.desc || null,
            priority: w.priority,
            status: w.status,
            likes: w.likes || [],
            comments: (w.comments || []).map((c) => ({ author: c.author, content: c.content, time: c.time })),
            created_at: w.created_at,
          })),
        })
      }
      case 'write_wish': {
        const w = addWish(input.author || 'star', input.title, { desc: input.desc, priority: input.priority })
        return JSON.stringify({ ok: true, id: w.id })
      }
      case 'edit_wish': {
        const patch: any = {}
        if (typeof input.title === 'string') patch.title = input.title
        if (typeof input.desc === 'string') patch.desc = input.desc
        if (input.priority) patch.priority = input.priority
        if (input.status) patch.status = input.status
        const r = editWish(input.id, patch)
        return r === 'ok' ? '✨ 愿望已更新' : r
      }
      case 'delete_wish': {
        const r = deleteWish(input.id)
        return r === 'ok' ? '🗑️ 愿望已删除' : r
      }
      case 'like_wish': {
        const r = likeWish(input.id, input.author || 'star')
        return r === 'ok' ? '❤️ 已切换“我也想要”' : r
      }
      case 'comment_wish': {
        const r = commentWish(input.id, input.author || 'star', input.content)
        return r === 'ok' ? '💬 已评论' : r
      }

      // Wake alarm
      case 'wake_me': {
        let at = 0
        if (typeof input.time === 'number') at = input.time
        else if (typeof input.time === 'string') {
          const n = Number(input.time)
          at = isFinite(n) && n > 1e12 ? n : (parseMadridDateTime(input.time)?.getTime() || NaN)
        }
        if (!at || isNaN(at)) return '时间格式无法识别，请用 ISO 格式，如 2026-07-16T09:00'
        if (at <= Date.now()) return '闹钟时间必须在未来'
        const alarm = scheduleWake(at, input.note)
        return JSON.stringify({ ok: true, wake_at: madridTime(alarm.at), note: alarm.note || null })
      }

      // Web fetch
      case 'fetch_txt':
      case 'fetch_markdown':
      case 'fetch_html':
      case 'fetch_json':
        return await executeSafeFetch(name, input.url, input.headers)

      default:
        return `Unknown tool: ${name}`
    }
  } catch (err: any) {
    return `Tool error (${name}): ${err.message}`
  }
}

/** Get weather for user's location */
function executeGetWeather(): string {
  const ctx = readUserContext()
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
    updated: madridTime(ctx.updatedAt),
  })
}

/** Get user's GPS location (with street-level address + Google Maps link) */
function executeGetLocation(): string {
  const ctx = readUserContext()
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
    updated: madridTime(ctx.updatedAt),
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
