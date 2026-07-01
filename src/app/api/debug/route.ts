import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || '/src/data'

  const info: Record<string, any> = {
    cwd,
    DATA_DIR_env: process.env.DATA_DIR || '(not set)',
    resolved_dataDir: dataDir,
    dataDir_exists: fs.existsSync(dataDir),
  }

  if (fs.existsSync(dataDir)) {
    info.contents = fs.readdirSync(dataDir)
    const diaryDir = path.join(dataDir, 'diaries')
    const notesDir = path.join(dataDir, 'notes')
    if (fs.existsSync(diaryDir))
      info.diary_count = fs.readdirSync(diaryDir).length
    if (fs.existsSync(notesDir))
      info.notes_count = fs.readdirSync(notesDir).length
  }

  // Persistence test
  const testFile = path.join(dataDir, '.persist-test')
  let prev = null
  if (fs.existsSync(testFile)) prev = fs.readFileSync(testFile, 'utf-8')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(testFile, new Date().toISOString())
  info.persist_test = { previous_write: prev, survived_redeploy: prev !== null }

  return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } })
}
