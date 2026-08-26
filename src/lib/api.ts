// API client. All requests go through Next route handlers in /api/*,
// which proxy to the Ombre Brain / starfire-diary backend. Tokens stay server-side.

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest(path: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(path, { ...init, signal: controller.signal, cache: 'no-store' })
    const text = await res.text()
    let data: any = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
    if (!res.ok) {
      throw new ApiError(data?.error || data?.message || `请求失败 (${res.status})`, res.status)
    }
    return data
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new ApiError('请求超时，请检查网络后重试')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function post(path: string, body: any = {}) {
  return apiRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 25000)
}

// ── Chat ────────────────────────────────────────────────
export const chat = {
  models: (params: { provider: 'anthropic' | 'openai-compatible'; baseUrl: string; apiKey: string }) => post('/api/models', params),
  send: (params: {
    messages: any[]
    system?: string
    model?: string
    thinking_budget?: number
    temperature?: number
    prompt_caching?: boolean
    api_profile?: { provider: 'anthropic' | 'openai-compatible'; baseUrl: string; apiKey: string; modelId?: string }
  }) => post('/api/chat', params),
}

// ── Diary ───────────────────────────────────────────────
export const diary = {
  read:   (viewer: string, params: { keyword?: string; author_filter?: string; target_date?: string } = {}) =>
    post('/api/diary/read', { viewer, ...params }),
  write:  (entry: {
    date: string; author: string; title: string; content: string;
    type?: 'diary' | 'letter' | 'capsule';
    visibility: 'public' | 'private' | 'timed'; reveal_at?: string; tags?: string;
  }) => post('/api/diary/write', entry),
  comment: (data: { target_date: string; target_author: string; commenter: string; content: string; time_id?: string }) =>
    post('/api/diary/comment', data),
  unlock: (viewer: string, target_author: string, password: string, target_date?: string, time_id?: string) =>
    post('/api/diary/unlock', { viewer, target_author, password, target_date, time_id }),
  update: (data: { author: string; target_date: string; new_content: string; time_id?: string }) =>
    post('/api/diary/update', data),
  delete: (author: string, target_date: string, time_id?: string) =>
    post('/api/diary/delete', { author, target_date, time_id }),
}

// ── Notes ───────────────────────────────────────────────
export const notes = {
  read:   (params: { keyword?: string; limit?: number } = {}) => post('/api/notes/read', params),
  write:  (author: string, content: string, tags?: string) => post('/api/notes/write', { author, content, tags }),
  reply:  (note_id: string, author: string, content: string) => post('/api/notes/reply', { note_id, author, content }),
  delete: (note_id: string, author: string) => post('/api/notes/delete', { note_id, author }),
}

// ── Memory ──────────────────────────────────────────────
export const memory = {
  search: (query?: string, params: any = {}) => post('/api/memory/search', { query, ...params }),
  pulse:  () => post('/api/memory/pulse'),
}

// ── Photos ──────────────────────────────────────────────
async function get(path: string) {
  return apiRequest(path, {}, 15000)
}

export const photos = {
  list:    (opts?: { locked?: boolean }) => get('/api/photos/list' + (opts?.locked !== undefined ? `?locked=${opts.locked}` : '')),
  write:   (author: string, url: string, caption?: string, source?: string, locked?: boolean) => post('/api/photos/write', { author, url, caption, source, locked }),
  edit:    (id: string, caption?: string, locked?: boolean) => post('/api/photos/edit', { id, caption, locked }),
  delete:  (id: string) => post('/api/photos/delete', { id }),
  comment: (id: string, author: string, content: string) => post('/api/photos/comment', { id, author, content }),
  password: (action: 'set' | 'verify' | 'check', password?: string) => post('/api/photos/password', { action, password }),
}

// ── Todo ────────────────────────────────────────────────
export const todo = {
  list:    (date?: string) => get('/api/todo/list' + (date ? `?date=${date}` : '')),
  add:     (text: string, author: string, date?: string) => post('/api/todo/add', { text, author, date }),
  toggle:  (id: string, date?: string) => post('/api/todo/toggle', { id, date }),
  remove:  (id: string, date?: string) => post('/api/todo/remove', { id, date }),
  edit:    (id: string, text: string, date?: string) => post('/api/todo/edit', { id, text, date }),
  comment: (id: string, author: string, content: string, date?: string) => post('/api/todo/comment', { id, author, content, date }),
}


// ── Life Timeline ─────────────────────────────────────
export const timeline = {
  list: (from?: string, to?: string) => get('/api/timeline' + (from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}` : '')),
  current: () => get('/api/timeline'),
  start: (title: string, tags?: string | string[], note?: string, start_at?: string) => post('/api/timeline', { action: 'start', title, tags, note, start_at }),
  stop: (id?: string, end_note?: string, end_at?: string) => post('/api/timeline', { action: 'stop', id, end_note, end_at }),
  update: (id: string, patch: any) => post('/api/timeline', { action: 'update', id, patch }),
  remove: (id: string) => post('/api/timeline', { action: 'delete', id }),
  tags: () => get('/api/timeline'),
  setTags: (tags: string[]) => post('/api/timeline', { action: 'tags', tags }),
}

// ── Tesis (thesis progress) ─────────────────────────────
export const tesis = {
  list:    () => get('/api/thesis/list'),
  add:     (title: string, totalPages: number) => post('/api/thesis/add', { title, totalPages }),
  update:  (id: string, patch: { title?: string; totalPages?: number; currentPages?: number }) => post('/api/thesis/update', { id, ...patch }),
  remove:  (id: string) => post('/api/thesis/remove', { id }),
  comment: (author: string, content: string) => post('/api/thesis/comment', { author, content }),
}

// ── Wishlist (2026 愿望清单) ───────────────────────────
export const wish = {
  list: () => get('/api/wish/list'),
  add: (author: string, title: string, opts: { desc?: string; priority?: string } = {}) =>
    post('/api/wish/add', { author, title, ...opts }),
  edit: (id: string, patch: { title?: string; desc?: string; priority?: string; status?: string }) =>
    post('/api/wish/edit', { id, ...patch }),
  remove: (id: string) => post('/api/wish/delete', { id }),
  like: (id: string, author: string) => post('/api/wish/like', { id, author }),
  comment: (id: string, author: string, content: string) =>
    post('/api/wish/comment', { id, author, content }),
}


// ── Period tracking ───────────────────────────────────
export const period = {
  get: () => get('/api/period'),
  start: (date: string) => post('/api/period', { action: 'start', date }),
  end: (date: string) => post('/api/period', { action: 'end', date }),
  config: (cycle_days?: number, period_length?: number) =>
    post('/api/period', { action: 'config', cycle_days, period_length }),
}

export const encouragement = { list: () => get('/api/encouragement'), match: () => get('/api/encouragement?match=1'), create: (text:string, scope:'permanent'|'tags', tags:string[]) => post('/api/encouragement',{action:'create',text,scope,tags}), createMany:(items:any[])=>post('/api/encouragement',{action:'create_many',items}), update:(id:string,patch:any)=>post('/api/encouragement',{action:'update',id,patch}), remove:(id:string)=>post('/api/encouragement',{action:'delete',id}), setTags:(tags:string[])=>post('/api/encouragement',{action:'tags',tags}) }
