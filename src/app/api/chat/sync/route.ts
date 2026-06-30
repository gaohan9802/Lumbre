import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Chat sync API — local-first architecture.
 *
 * GET  /api/chat/sync?user=fire&after=<ISO timestamp>
 *   → returns messages newer than `after` for the user's active session
 *
 * POST /api/chat/sync
 *   → pushes new messages from client to server
 *   Body: { user, messages: [{ id, role, content, thinking?, tokens?, createdAt }] }
 *
 * This keeps iPad and iPhone in sync without WebSocket complexity.
 */

// GET — pull messages from server
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const user = searchParams.get('user') || 'fire'
  const after = searchParams.get('after') // ISO string

  // Get or create active session
  let session = await prisma.chatSession.findFirst({
    where: { user },
    orderBy: { updatedAt: 'desc' },
  })

  if (!session) {
    session = await prisma.chatSession.create({
      data: { user },
    })
  }

  const where: any = { sessionId: session.id }
  if (after) {
    where.createdAt = { gt: new Date(after) }
  }

  const messages = await prisma.chatMessage.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: 500,
  })

  // Also return settings
  const config = await prisma.chatConfig.findUnique({ where: { user } })

  return NextResponse.json({
    sessionId: session.id,
    messages,
    config,
  })
}

// POST — push messages to server
export async function POST(req: NextRequest) {
  const { user = 'fire', messages = [], settings } = await req.json()

  // Get or create active session
  let session = await prisma.chatSession.findFirst({
    where: { user },
    orderBy: { updatedAt: 'desc' },
  })

  if (!session) {
    session = await prisma.chatSession.create({ data: { user } })
  }

  // Upsert messages (skip duplicates by id)
  let pushed = 0
  for (const msg of messages) {
    const existing = await prisma.chatMessage.findUnique({ where: { id: msg.id } })
    if (!existing) {
      await prisma.chatMessage.create({
        data: {
          id: msg.id,
          sessionId: session.id,
          role: msg.role,
          content: msg.content,
          thinking: msg.thinking || null,
          inputTokens: msg.inputTokens || msg.input_tokens || null,
          outputTokens: msg.outputTokens || msg.output_tokens || null,
          cacheReadTokens: msg.cacheReadTokens || msg.cache_read_tokens || null,
          cacheCreationTokens: msg.cacheCreationTokens || msg.cache_creation_tokens || null,
          createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(msg.timestamp || Date.now()),
        },
      })
      pushed++
    }
  }

  // Update session timestamp
  await prisma.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  })

  // Sync settings if provided
  if (settings) {
    await prisma.chatConfig.upsert({
      where: { user },
      update: {
        systemPrompt: settings.systemPrompt ?? '',
        contextLength: settings.contextLength ?? 30,
        model: settings.model ?? 'claude-opus-4-5',
        thinkingBudget: settings.thinkingBudget ?? 8000,
        promptCaching: settings.promptCaching ?? true,
      },
      create: {
        user,
        systemPrompt: settings.systemPrompt ?? '',
        contextLength: settings.contextLength ?? 30,
        model: settings.model ?? 'claude-opus-4-5',
        thinkingBudget: settings.thinkingBudget ?? 8000,
        promptCaching: settings.promptCaching ?? true,
      },
    })
  }

  return NextResponse.json({ ok: true, pushed, sessionId: session.id })
}
