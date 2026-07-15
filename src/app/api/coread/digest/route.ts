export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getDigest, setDigest, getStoryArc } from '@/server/coread-store'

// POST /api/coread/digest — get/set digest, or get story arc
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, bookId, chapterNum, digest } = body

    if (action === 'arc') {
      if (!bookId) return NextResponse.json({ error: 'missing bookId' }, { status: 400 })
      const arc = getStoryArc(bookId, chapterNum || 999)
      return NextResponse.json({ arc })
    }

    if (action === 'set') {
      if (!bookId || !chapterNum || !digest) return NextResponse.json({ error: 'missing params' }, { status: 400 })
      setDigest(bookId, chapterNum, digest)
      return NextResponse.json({ success: true })
    }

    // Default: get
    if (!bookId || !chapterNum) return NextResponse.json({ error: 'missing params' }, { status: 400 })
    const d = getDigest(bookId, chapterNum)
    return NextResponse.json({ digest: d })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
