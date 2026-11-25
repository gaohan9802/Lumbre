import { NextRequest, NextResponse } from 'next/server'
import { writeStudyAsset } from '@/server/study-store'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    return NextResponse.json({ asset: writeStudyAsset(body.kind, body.data_url, body.caption, body.strokes) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'study_asset_error' }, { status: 400 })
  }
}
