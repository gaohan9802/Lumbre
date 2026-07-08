export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const dataDir = process.env.DATA_DIR || '/persistent'
  const bucketsDir = path.join(dataDir, 'buckets')
  const result: Record<string, unknown> = {
    dataDir,
    bucketsDir,
    cwd: process.cwd(),
    env_DATA_DIR: process.env.DATA_DIR || '(not set)',
    nodeVersion: process.version,
    platform: process.platform,
  }
  try {
    result.dataDirExists = fs.existsSync(dataDir)
    if (result.dataDirExists) {
      result.dataDirContents = fs.readdirSync(dataDir)
    }
    result.bucketsDirExists = fs.existsSync(bucketsDir)
    if (result.bucketsDirExists) {
      const all = fs.readdirSync(bucketsDir)
      const jsonFiles = all.filter(f => f.endsWith('.json') && f !== '_index.json')
      result.totalFiles = all.length
      result.jsonFiles = jsonFiles.length
      if (jsonFiles.length > 0) {
        const samplePath = path.join(bucketsDir, jsonFiles[0])
        const raw = fs.readFileSync(samplePath, 'utf-8')
        const parsed = JSON.parse(raw)
        result.sampleId = parsed.id
        result.sampleHasMetadata = !!parsed.metadata
      }
    }
  } catch (e: unknown) {
    result.error = e instanceof Error ? e.message : String(e)
    result.stack = e instanceof Error ? e.stack : undefined
  }
  return NextResponse.json(result)
}
