export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getBook, getAnnotations, readCoreadNotes } from '@/server/coread-store'

export async function GET(req: NextRequest) {
  const bookId = req.nextUrl.searchParams.get('bookId') || ''
  const format = req.nextUrl.searchParams.get('format') || 'markdown'
  const data = getBook(bookId)
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const anns = getAnnotations(bookId)
  const notes = readCoreadNotes({ bookId, limit: 200 })
  if (format === 'json') {
    return new Response(JSON.stringify({ book: data.book, annotations: anns, notes }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="coread-${bookId}.json"` },
    })
  }
  const rows = [`# 《${data.book.title}》阅读笔记`, '', `作者：${data.book.author || '未知'}`, `进度：${Math.round(data.book.progress || 0)}%`, '']
  for (const ann of anns.sort((a, b) => a.chapterNum - b.chapterNum || a.createdAt.localeCompare(b.createdAt))) {
    rows.push(`## 第 ${ann.chapterNum} 章 · ${ann.kind === 'highlight' ? '划线' : ann.kind === 'bookmark' ? '书签' : '批注'}`)
    if (ann.originalText) rows.push('', `> ${ann.originalText.replace(/\n/g, '\n> ')}`)
    if (ann.annotation) rows.push('', `${ann.author === 'star' ? '🐆 星星' : '🦦 小火'}：${ann.annotation}`)
    for (const r of ann.replies || []) rows.push('', `- ${r.author === 'star' ? '🐆 星星' : '🦦 小火'}回复：${r.content}`)
    rows.push('')
  }
  if (notes.length) {
    rows.push('# 独立阅读笔记', '')
    for (const n of notes) rows.push(`## ${n.date} · 第 ${n.chapterNum} 章 · ${n.progress}%`, '', `${n.author === 'star' ? '🐆 星星' : '🦦 小火'}：${n.content}`, '')
  }
  return new Response(rows.join('\n'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(data.book.title)}-阅读笔记.md` },
  })
}
