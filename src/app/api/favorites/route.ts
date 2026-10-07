export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { listFavorites, removeFavorite, toggleFavorite } from '@/server/star-memory'

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'favorite_error' }, { status: 400 })
}

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(listFavorites(req.nextUrl.searchParams.get('kind') || undefined))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'toggle') return NextResponse.json(toggleFavorite(body.favorite, body.actor || 'fire'))
    if (body.action === 'remove') return NextResponse.json({ removed: removeFavorite(body.id, body.actor || 'fire') })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error) {
    return failure(error)
  }
}
