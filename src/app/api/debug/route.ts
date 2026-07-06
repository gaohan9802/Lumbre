import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || '/persistent'

  const check = (p: string) => {
    try {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        return { exists: true, type: 'dir', files: fs.readdirSync(p).length }
      }
      return { exists: true, type: 'file', size: stat.size }
    } catch {
      return { exists: false }
    }
  }

  return NextResponse.json({
    cwd,
    dataDir,
    __dirname,
    paths: {
      '/persistent': check('/persistent'),
      '/persistent/diaries': check('/persistent/diaries'),
      '/persistent/notes': check('/persistent/notes'),
      'cwd/src/seed': check(path.join(cwd, 'src', 'seed')),
      'cwd/src/seed/diaries.json': check(path.join(cwd, 'src', 'seed', 'diaries.json')),
      'cwd/src/seed/notes.json': check(path.join(cwd, 'src', 'seed', 'notes.json')),
      'dirname/../seed': check(path.join(__dirname, '..', '..', 'seed')),
    },
  })
}
