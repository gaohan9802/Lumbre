import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || '/persistent'
  const diaryDir = path.join(dataDir, 'diaries')
  const notesDir = path.join(dataDir, 'notes')

  const check = (p: string) => {
    try {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        const files = fs.readdirSync(p)
        return { exists: true, type: 'dir', count: files.length, files: files.slice(0, 10) }
      }
      return { exists: true, type: 'file', size: stat.size }
    } catch {
      return { exists: false }
    }
  }

  // Try to read a diary file directly
  let sampleDiary = null
  try {
    const files = fs.readdirSync(diaryDir).filter(f => f.endsWith('.json'))
    if (files.length > 0) {
      const content = fs.readFileSync(path.join(diaryDir, files[0]), 'utf-8')
      sampleDiary = { filename: files[0], content: content.slice(0, 200) }
    }
  } catch (e: any) {
    sampleDiary = { error: e.message }
  }

  return NextResponse.json({
    cwd,
    dataDir,
    diaryDir,
    notesDir,
    persistent: check(dataDir),
    diaries: check(diaryDir),
    notes: check(notesDir),
    seedDir: check(path.join(cwd, 'src', 'seed')),
    bucketsDir: check(path.join(dataDir, 'buckets')),
    bucketsSeedCandidates: {
      inData: fs.existsSync(path.join(dataDir, 'buckets.json')),
      inSeed: fs.existsSync(path.join(cwd, 'src', 'seed', 'buckets.json')),
      inStandalone: fs.existsSync(path.join(cwd, '.next', 'server', 'seed', 'buckets.json')),
    },
    sampleDiary,
  })
}
