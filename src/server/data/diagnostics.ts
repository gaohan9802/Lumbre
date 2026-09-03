import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './config'
import { resolveDataPath } from './safe-path'

const DATA_DIR = getDataDir()
const BUCKETS_DIR = resolveDataPath(DATA_DIR, 'buckets')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function inspectPath(target: string) {
  try {
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      const files = fs.readdirSync(target)
      return { exists: true, type: 'dir', count: files.length, files: files.slice(0, 10) }
    }
    return { exists: true, type: 'file', size: stat.size }
  } catch {
    return { exists: false }
  }
}

export function inspectDataFilesystem(): Record<string, unknown> {
  const result: Record<string, unknown> = {
    dataDir: DATA_DIR,
    bucketsDir: BUCKETS_DIR,
    cwd: process.cwd(),
    env_DATA_DIR: process.env.DATA_DIR || '(not set)',
    nodeVersion: process.version,
    platform: process.platform,
  }
  try {
    result.dataDirExists = fs.existsSync(DATA_DIR)
    if (result.dataDirExists) result.dataDirContents = fs.readdirSync(DATA_DIR)
    result.bucketsDirExists = fs.existsSync(BUCKETS_DIR)
    if (result.bucketsDirExists) {
      const all = fs.readdirSync(BUCKETS_DIR)
      const jsonFiles = all.filter(file => /^[0-9a-f]{12}\.json$/i.test(file))
      result.totalFiles = all.length
      result.jsonFiles = jsonFiles.length
      if (jsonFiles.length > 0) {
        const parsed = JSON.parse(fs.readFileSync(resolveDataPath(BUCKETS_DIR, jsonFiles[0]), 'utf8'))
        result.sampleId = parsed.id
        result.sampleHasMetadata = !!parsed.metadata
      }
    }
  } catch (error) {
    result.error = errorMessage(error)
    result.stack = error instanceof Error ? error.stack : undefined
  }
  return result
}

export function inspectLegacyChatRaw(): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  try {
    const text = fs.readFileSync(resolveDataPath(DATA_DIR, 'chat-sync.json'), 'utf8')
    output.fileSize = text.length
    output.head = text.slice(0, 800)
    output.tail = text.slice(-400)
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch (error) { output.parseError = errorMessage(error) }
    if (parsed && typeof parsed === 'object') {
      output.topKeys = Object.keys(parsed).map(key => {
        const value = parsed[key]
        const type = Array.isArray(value) ? `array[${value.length}]` : typeof value
        let jsonLength: number | undefined
        try { jsonLength = JSON.stringify(value).length } catch {}
        return { key, type, jsonLen: jsonLength }
      })
    }
  } catch (error) {
    output.error = errorMessage(error)
  }
  return output
}

export function inspectLegacyChatSessions(): Record<string, unknown> {
  const output: Record<string, any> = { source: null, count: 0, sessions: [] }
  for (const file of ['chat-sync.json', 'chat-sync.bak']) {
    try {
      const raw = JSON.parse(fs.readFileSync(resolveDataPath(DATA_DIR, file), 'utf8'))
      const sessions = Array.isArray(raw.sessions) ? raw.sessions : []
      output.source = file
      output.count = sessions.length
      output.sessions = sessions.map((session: any) => ({
        id: session.id,
        title: session.title,
        messages: Array.isArray(session.messages) ? session.messages.length : 0,
        updatedAt: session.updatedAt,
        firstMsg: Array.isArray(session.messages) && session.messages[0]
          ? String(session.messages[0].content || '').slice(0, 40)
          : '',
      }))
      break
    } catch {}
  }
  try {
    output.snapshots = fs.readdirSync(DATA_DIR)
      .filter(file => /^chat-sync\.\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .sort()
  } catch { output.snapshots = [] }
  return output
}

export function inspectPersistentData(): Record<string, unknown> {
  const cwd = process.cwd()
  const diaryDir = resolveDataPath(DATA_DIR, 'diaries')
  const notesDir = resolveDataPath(DATA_DIR, 'notes')
  let sampleDiary: unknown = null
  try {
    const files = fs.readdirSync(diaryDir).filter(file => file.endsWith('.json'))
    if (files.length > 0) {
      const content = fs.readFileSync(resolveDataPath(diaryDir, files[0]), 'utf8')
      sampleDiary = { filename: files[0], content: content.slice(0, 200) }
    }
  } catch (error) {
    sampleDiary = { error: errorMessage(error) }
  }

  let chatSync: Record<string, unknown> = inspectPath(resolveDataPath(DATA_DIR, 'chat-sync.json'))
  try {
    const marker = resolveDataPath(DATA_DIR, '.write-probe')
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(marker, String(Date.now()))
    fs.unlinkSync(marker)
    chatSync = { ...chatSync, writable: true }
  } catch (error) {
    chatSync = { ...chatSync, writable: false, writeError: errorMessage(error) }
  }

  return {
    version: 'v3-tool-debug-20260707',
    cwd,
    dataDir: DATA_DIR,
    diaryDir,
    notesDir,
    chatSync,
    chatSyncBak: inspectPath(resolveDataPath(DATA_DIR, 'chat-sync.bak')),
    persistent: inspectPath(DATA_DIR),
    diaries: inspectPath(diaryDir),
    notes: inspectPath(notesDir),
    seedDir: inspectPath(path.join(cwd, 'src', 'seed')),
    bucketsDir: inspectPath(BUCKETS_DIR),
    sampleDiary,
  }
}

export function inspectSystemPromptSources(): Record<string, unknown> {
  const candidates = [
    path.join(process.cwd(), 'src/app/api/chat/route.ts'),
    path.join(process.cwd(), '.next/server/app/api/chat/route.js'),
  ]
  const results: Record<string, unknown> = {}
  for (const candidate of candidates) {
    try {
      const content = fs.readFileSync(candidate, 'utf8')
      results[candidate] = {
        exists: true,
        size: content.length,
        has_DEFAULT_SYSTEM_PROMPT: content.includes('DEFAULT_SYSTEM_PROMPT'),
        has_effectiveSystem: content.includes('effectiveSystem'),
        has_tools_enabled: content.includes('tools_enabled'),
        has_ALL_TOOLS: content.includes('ALL_TOOLS'),
      }
    } catch (error) {
      results[candidate] = { exists: false, error: errorMessage(error) }
    }
  }
  return results
}
