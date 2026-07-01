import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || path.join(cwd, 'data')

  const info = {
    cwd,
    DATA_DIR_env: process.env.DATA_DIR || '(not set)',
    resolved_dataDir: dataDir,
    dataDir_exists: fs.existsSync(dataDir),
    contents: null as string[] | null,
    diary_count: 0,
    notes_count: 0,
    persist_test: { previous_write: null as string | null, survived_redeploy: false },
    write_error: null as string | null,
    all_root_dirs: null as string[] | null,
    src_contents: null as string[] | null,
    path_checks: {} as Record<string, boolean>,
  }

  // List root dirs
  try {
    info.all_root_dirs = fs.readdirSync('/')
  } catch (e) {
    info.all_root_dirs = [`error: ${e}`]
  }

  // List /src contents
  try {
    info.src_contents = fs.readdirSync('/src')
  } catch (e) {
    info.src_contents = [`error: ${e}`]
  }

  // Check common mount paths
  const checkPaths = ['/persistent', '/data', '/src/data', '/src/persistent', '/mnt/data', '/var/data', '/tmp']
  for (const p of checkPaths) {
    info.path_checks[p] = fs.existsSync(p)
    if (fs.existsSync(p)) {
      try {
        const contents = fs.readdirSync(p)
        info.path_checks[p + '_contents'] = contents as unknown as boolean
      } catch {}
    }
  }

  if (fs.existsSync(dataDir)) {
    info.contents = fs.readdirSync(dataDir)
    const diaryDir = path.join(dataDir, 'diaries')
    const notesDir = path.join(dataDir, 'notes')
    if (fs.existsSync(diaryDir)) info.diary_count = fs.readdirSync(diaryDir).length
    if (fs.existsSync(notesDir)) info.notes_count = fs.readdirSync(notesDir).length
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const testFile = path.join(dataDir, '.persist-test')
    if (fs.existsSync(testFile)) info.persist_test.previous_write = fs.readFileSync(testFile, 'utf-8')
    info.persist_test.survived_redeploy = info.persist_test.previous_write !== null
    fs.writeFileSync(testFile, new Date().toISOString())
  } catch (e) {
    info.write_error = `${e}`
  }

  return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } })
}
