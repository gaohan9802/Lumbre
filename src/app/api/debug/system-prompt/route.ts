import { NextResponse } from 'next/server'

export async function GET() {
  // Import the actual route module to check if DEFAULT_SYSTEM_PROMPT exists
  // Instead, just check the file content
  const fs = require('fs')
  const path = require('path')
  
  // Check multiple possible locations for the route file
  const candidates = [
    path.join(process.cwd(), 'src/app/api/chat/route.ts'),
    path.join(process.cwd(), '.next/server/app/api/chat/route.js'),
  ]
  
  const results: any = {}
  for (const p of candidates) {
    try {
      const content = fs.readFileSync(p, 'utf-8')
      results[p] = {
        exists: true,
        size: content.length,
        has_DEFAULT_SYSTEM_PROMPT: content.includes('DEFAULT_SYSTEM_PROMPT'),
        has_effectiveSystem: content.includes('effectiveSystem'),
        has_tools_enabled: content.includes('tools_enabled'),
        has_ALL_TOOLS: content.includes('ALL_TOOLS'),
      }
    } catch (e: any) {
      results[p] = { exists: false, error: e.message }
    }
  }
  
  return NextResponse.json(results)
}
