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
