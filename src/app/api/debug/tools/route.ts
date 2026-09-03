import { NextResponse } from 'next/server'
import { ALL_TOOLS } from '@/server/agent/registry'

export async function GET() {
  return NextResponse.json({
    count: ALL_TOOLS.length,
    tools: ALL_TOOLS.map(t => t.name),
  })
}
