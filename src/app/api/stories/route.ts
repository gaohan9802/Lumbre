import { NextRequest, NextResponse } from 'next/server'
import {
  appendStorySection, createStory, deleteStory, getStory, listStories, replaceStoryBody,
  updateStory, updateStorySection,
} from '@/server/story-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  try { return NextResponse.json(id ? { story: getStory(id) } : { stories: listStories() }) }
  catch (error: any) { return NextResponse.json({ error: error?.message || 'story_error' }, { status: 404 }) }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action === 'create') return NextResponse.json({ story: createStory(body.title, body.shelf) })
    if (body.action === 'append') return NextResponse.json(appendStorySection(body.id, body.text))
    if (body.action === 'replace_section') return NextResponse.json({ story: updateStorySection(body.id, body.section_id, body.text) })
    if (body.action === 'replace_body') return NextResponse.json({ story: replaceStoryBody(body.id, body.text) })
    if (body.action === 'update') return NextResponse.json({ story: updateStory(body.id, body.patch || {}) })
    if (body.action === 'delete') return NextResponse.json({ ok: deleteStory(body.id) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'story_error' }, { status: 400 })
  }
}
