import { NextResponse } from 'next/server'
import { listPhotos } from '@/server/photo-store'
export const dynamic = 'force-dynamic'
export async function GET() {
  return NextResponse.json({ photos: listPhotos() })
}
