// API client. All requests go through Next route handlers in /api/*,
// which proxy to the Ombre Brain / starfire-diary backend. Tokens stay server-side.

async function post(path: string, body: any = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
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
  const res = await fetch(path)
  return res.json()
}

export const photos = {
  list:    () => get('/api/photos/list'),
  write:   (author: string, url: string, caption?: string, source?: string) => post('/api/photos/write', { author, url, caption, source }),
  edit:    (id: string, caption: string) => post('/api/photos/edit', { id, caption }),
  delete:  (id: string) => post('/api/photos/delete', { id }),
  comment: (id: string, author: string, content: string) => post('/api/photos/comment', { id, author, content }),
}

// ── Todo ────────────────────────────────────────────────
export const todo = {
  list:    (date?: string) => get('/api/todo/list' + (date ? `?date=${date}` : '')),
  add:     (text: string, author: string, date?: string) => post('/api/todo/add', { text, author, date }),
  toggle:  (id: string, date?: string) => post('/api/todo/toggle', { id, date }),
  remove:  (id: string, date?: string) => post('/api/todo/remove', { id, date }),
  comment: (id: string, author: string, content: string, date?: string) => post('/api/todo/comment', { id, author, content, date }),
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

// ── CoReading (共读) ──────────────────────────────────
export const coread = {
  books: () => get('/api/coread/books'),
  chapters: (bookId: string) => post('/api/coread/books', { bookId }),
  chapter: (bookId: string, chapterNum: number) => post('/api/coread/chapter', { bookId, chapterNum }),
  import: (data: { type: string; title: string; author?: string; content?: string; chapters?: { title: string; content: string }[] }) =>
    post('/api/coread/import', data),
  chatHistory: (bookId: string) => get(`/api/coread/chat?bookId=${bookId}`),
  annotate: (data: { bookId: string; chapterNum: number; originalText?: string; annotation: string }) =>
    post('/api/coread/annotate', data),
  deleteAnnotation: (bookId: string, annId: string) =>
    post('/api/coread/annotate', { action: 'delete', bookId, annId }),
  deleteBook: (bookId: string) => post('/api/coread/delete', { bookId }),
  digest: (bookId: string, chapterNum: number) => post('/api/coread/digest', { bookId, chapterNum }),
  storyArc: (bookId: string, chapterNum: number) => post('/api/coread/digest', { action: 'arc', bookId, chapterNum }),
}
