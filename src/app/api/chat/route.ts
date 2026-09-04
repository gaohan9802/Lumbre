import type { NextRequest } from 'next/server'
import { handleChatRequest } from '@/server/chat/orchestrator'

export const runtime = 'nodejs'
export const maxDuration = 300

/** The route is intentionally thin; all provider and tool-loop work lives in the server gateway. */
export async function POST(req: NextRequest) {
  return handleChatRequest(req)
}
