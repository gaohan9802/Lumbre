import { NextResponse } from 'next/server'
import { inspectSystemPromptSources } from '@/server/data/diagnostics'

export async function GET() {
  return NextResponse.json(inspectSystemPromptSources())
}
