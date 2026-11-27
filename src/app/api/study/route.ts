import { NextRequest, NextResponse } from 'next/server'
import {
  addStudyComment, addStudyQuestionReply, createStudyField, createStudyNote, createStudySection, getStudyNote, listStudyActivity, listStudyOverview,
  listStudyQuestions, moveStudyField, moveStudyNote, readStudyQuickNote, saveStudyNote, saveStudyQuickNote, searchStudy, setStudyQuestionStatus, updateStudyField, updateStudySection,
} from '@/server/study-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get('mode') || 'overview'
    if (mode === 'note') return NextResponse.json({ note: getStudyNote(request.nextUrl.searchParams.get('id')) })
    if (mode === 'search') return NextResponse.json({ results: searchStudy(request.nextUrl.searchParams.get('q')) })
    if (mode === 'questions') return NextResponse.json({ questions: listStudyQuestions(request.nextUrl.searchParams.get('status')) })
    if (mode === 'activity') return NextResponse.json(listStudyActivity())
    if (mode === 'quick-note') return NextResponse.json({ note: readStudyQuickNote() })
    return NextResponse.json(listStudyOverview(request.nextUrl.searchParams.get('archived') === '1'))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'study_error' }, { status: 404 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action === 'create_field') return NextResponse.json({ field: createStudyField(body.name) })
    if (body.action === 'update_field') return NextResponse.json({ field: updateStudyField(body.id, body.patch || {}) })
    if (body.action === 'move_field') return NextResponse.json({ fields: moveStudyField(body.id, body.direction) })
    if (body.action === 'create_section') return NextResponse.json({ section: createStudySection(body.field_id, body.name) })
    if (body.action === 'update_section') return NextResponse.json({ section: updateStudySection(body.id, body.patch || {}) })
    if (body.action === 'create_note') return NextResponse.json({ note: createStudyNote(body.field_id, body.title, body.section_id) })
    if (body.action === 'move_note') return NextResponse.json({ note: moveStudyNote(body.id, body.expected_updated_at, body.field_id, body.section_id) })
    if (body.action === 'save_note') return NextResponse.json({ note: saveStudyNote(body.id, body.expected_updated_at, body.patch || {}) })
    if (body.action === 'save_quick_note') return NextResponse.json({ note: saveStudyQuickNote(body.content, body.expected_updated_at) })
    if (body.action === 'question_status') return NextResponse.json({ note: setStudyQuestionStatus(body.note_id, body.question_id, body.status) })
    if (body.action === 'question_reply') return NextResponse.json({ reply: addStudyQuestionReply(body.note_id, body.question_id, body.content) })
    if (body.action === 'comment') return NextResponse.json({ comment: addStudyComment(body.note_id, body.content, { actor: 'fire', block_id: body.block_id, quote: body.quote }) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'study_error' }, { status: 400 })
  }
}
