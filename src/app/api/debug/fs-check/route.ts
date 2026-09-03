export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { inspectDataFilesystem } from '@/server/data/diagnostics'

export async function GET() {
  return NextResponse.json(inspectDataFilesystem())
}
