/**
 * Trio store — the "three-way" room: 小火 + 星星K + 星星L.
 * A single shared transcript plus the pasted K-seed live in localStorage.
 * L-seed is pulled live from the main Star chat session, so it is not stored here.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TrioSpeaker = 'fire' | 'K' | 'L'

export interface TrioMsg {
  id: string
  speaker: TrioSpeaker
  content: string
  ts: number
}

export interface SeedMsg {
  role: 'user' | 'assistant'
  content: string
}

/** How many seed turns and how many rolling transcript turns each instance carries. */
export const SEED_LIMIT = 30
export const ROLL_LIMIT = 30

interface TrioStore {
  kSeedText: string
  transcript: TrioMsg[]
  setKSeedText: (t: string) => void
  addMsg: (m: TrioMsg) => void
  clear: () => void
}

export const useTrioStore = create<TrioStore>()(
  persist(
    (set) => ({
      kSeedText: '',
      transcript: [],
      setKSeedText: (t) => set({ kSeedText: t }),
      addMsg: (m) => set((s) => ({ transcript: [...s.transcript, m] })),
      clear: () => set({ transcript: [] }),
    }),
    { name: 'lumbre-trio', version: 1 },
  ),
)

/* ── seed parsing / perspective mapping (pure) ───────────────── */

const USER_LABELS = ['小火', '用户', 'user', 'me', '我', 'fire', 'h']
const ASST_LABELS = ['星星', 'star', 'assistant', 'ai', '助手', 'k', 'l', '星星k', '星星l', 'a']

function labelRole(label: string): 'user' | 'assistant' | null {
  const key = label.trim().toLowerCase()
  if (USER_LABELS.indexOf(key) >= 0) return 'user'
  if (ASST_LABELS.indexOf(key) >= 0) return 'assistant'
  return null
}

/**
 * Parse pasted K-seed text into role-tagged turns.
 * Recognizes line-leading `标签:` / `标签：` markers (小火:/星星:/user:/...).
 * If no markers are found at all, the whole text becomes one user context block.
 */
export function parseSeedText(text: string): SeedMsg[] {
  const raw = (text || '').replace(/\r/g, '')
  if (!raw.trim()) return []
  const lines = raw.split('\n')
  const turns: SeedMsg[] = []
  let cur: SeedMsg | null = null
  let sawMarker = false

  for (const line of lines) {
    const m = /^\s*([^:：\n]{1,12})[:：]\s*(.*)$/.exec(line)
    const role = m ? labelRole(m[1]) : null
    if (m && role) {
      sawMarker = true
      if (cur) turns.push(cur)
      cur = { role, content: m[2] }
    } else if (cur) {
      cur.content += (cur.content ? '\n' : '') + line
    }
  }
  if (cur) turns.push(cur)

  if (!sawMarker) {
    return [{ role: 'user', content: '【进群前的对话背景】\n' + raw.trim() }]
  }
  return turns
    .map((t) => ({ role: t.role, content: t.content.trim() }))
    .filter((t) => t.content.length > 0)
}

const SPEAKER_LABEL: Record<TrioSpeaker, string> = { fire: '小火', K: '星星K', L: '星星L' }

/** Merge consecutive same-role turns and guarantee the array opens on a user turn. */
function normalize(msgs: SeedMsg[]): SeedMsg[] {
  const out: SeedMsg[] = []
  for (const m of msgs) {
    if (!m.content.trim()) continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += '\n\n' + m.content
    else out.push({ role: m.role, content: m.content })
  }
  if (out.length && out[0].role === 'assistant') {
    out.unshift({ role: 'user', content: '（我们继续聊）' })
  }
  return out
}

/**
 * Build the messages array from one instance's point of view.
 * seed = that instance's own pre-group 1:1 history (roles as-is).
 * transcript = shared group chat; self→assistant, everyone else→user with a 【名字】 prefix.
 */
export function buildPerspective(self: 'K' | 'L', seed: SeedMsg[], transcript: TrioMsg[]): SeedMsg[] {
  const seedPart = seed.slice(-SEED_LIMIT)
  const rollPart = transcript.slice(-ROLL_LIMIT).map<SeedMsg>((e) => {
    if (e.speaker === self) return { role: 'assistant', content: e.content }
    return { role: 'user', content: `【${SPEAKER_LABEL[e.speaker]}】${e.content}` }
  })
  return normalize([...seedPart, ...rollPart])
}
