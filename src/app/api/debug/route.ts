import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || '/app/data'

  const info: Record<string, any> = {
    cwd,
    DATA_DIR_env: process.env.DATA_DIR || '(not set)',
    resolved_dataDir: dataDir,
    dataDir_exists: fs.existsSync(dataDir),
    appData_exists: fs.existsSync('/app/data'),
    cwdData_exists: fs.existsSync(path.join(cwd, 'data')),
  }

  // Check /app/data
  if (fs.existsSync('/app/data')) {
    info.appData_contents = fs.readdirSync('/app/data')
    const diaryDir = '/app/data/diaries'
    const notesDir = '/app/data/notes'
    if (fs.existsSync(diaryDir))
      info.diary_count = fs.readdirSync(diaryDir).length
    if (fs.existsSync(notesDir))
      info.notes_count = fs.readdirSync(notesDir).length
  }

  // Check cwd/data if different
  const cwdData = path.join(cwd, 'data')
  if (cwdData !== '/app/data' && fs.existsSync(cwdData)) {
    info.cwdData_contents = fs.readdirSync(cwdData)
    info.WARNING = 'Data exists in cwd/data but volume is at /app/data!'
  }

  // Write a test file to verify persistence
  const testFile = path.join(dataDir, '.persist-test')
  const now = new Date().toISOString()
  let previousWrite = null
  if (fs.existsSync(testFile)) {
    previousWrite = fs.readFileSync(testFile, 'utf-8')
  }
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(testFile, now)
  info.persist_test = {
    current_write: now,
    previous_write: previousWrite,
    survived_redeploy: previousWrite !== null,
  }

  return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } })
}
