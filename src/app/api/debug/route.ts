import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || path.join(cwd, 'data')
  const appData = '/app/data'
  
  const info: Record<string, any> = {
    cwd,
    DATA_DIR_env: process.env.DATA_DIR || '(not set)',
    resolved_dataDir: dataDir,
    dataDir_exists: fs.existsSync(dataDir),
    appData_exists: fs.existsSync(appData),
  }

  if (fs.existsSync(appData)) {
    info.appData_contents = fs.readdirSync(appData)
    if (fs.existsSync(path.join(appData, 'diaries')))
      info.appData_diaries = fs.readdirSync(path.join(appData, 'diaries'))
    if (fs.existsSync(path.join(appData, 'notes')))
      info.appData_notes = fs.readdirSync(path.join(appData, 'notes'))
  }

  if (dataDir !== appData && fs.existsSync(dataDir)) {
    info.dataDir_contents = fs.readdirSync(dataDir)
  }

  return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } })
}
