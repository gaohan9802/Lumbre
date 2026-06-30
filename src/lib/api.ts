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
  send: (params: {
    messages: any[]
    system?: string
    model?: string
    thinking_budget?: number
    prompt_caching?: boolean
    api_profile?: { provider: 'anthropic' | 'openai-compatible'; baseUrl: string; apiKey: string }
  }) => post('/api/chat', params),
}

// ── Diary ───────────────────────────────────────────────
export const diary = {
  read:   (viewer: string, params: { keyword?: string; author_filter?: string; target_date?: string } = {}) =>
    post('/api/diary/read', { viewer, ...params }),
  write:  (entry: {
    date: string; author: string; title: string; content: string;
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
