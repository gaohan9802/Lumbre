import { NextResponse } from 'next/server'
const BUILD_VERSION = '2026-07-07T23-tool-debug'
export async function GET() {
  return NextResponse.json({ version: BUILD_VERSION, timestamp: Date.now() })
}
