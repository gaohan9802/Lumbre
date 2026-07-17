/**
 * Dependency-free EPUB + plain-text parsing into chapters.
 *
 * EPUB is a ZIP. We read the central directory (reliable even with data
 * descriptors), inflate entries with zlib, then walk the OPF spine to get
 * reading order and strip XHTML to plain text.
 */
import zlib from 'zlib'

type Entries = Record<string, Buffer>

/** Read a ZIP buffer via its central directory. Returns name → uncompressed bytes. */
function unzip(buf: Buffer): Entries {
  const entries: Entries = {}
  // Locate End Of Central Directory (scan backwards for 0x06054b50).
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP/EPUB 文件')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 10)

  let p = cdOffset
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const fnLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + fnLen).toString('utf-8')

    // Local header: recompute data start (its extra field length may differ).
    const lhFnLen = buf.readUInt16LE(localOffset + 26)
    const lhExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lhFnLen + lhExtraLen
    const raw = buf.slice(dataStart, dataStart + compSize)
    try {
      entries[name] = method === 0 ? raw : zlib.inflateRawSync(raw)
    } catch {
      entries[name] = Buffer.alloc(0)
    }
    p += 46 + fnLen + extraLen + commentLen
  }
  return entries
}

function decode(b?: Buffer): string {
  return b ? b.toString('utf-8') : ''
}

/** XHTML/HTML → readable plain text (block tags → newlines, strip the rest). */
function htmlToText(html: string): string {
  let s = html
  s = s.replace(/<\s*(script|style|head)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
  s = s.replace(/<\s*br\s*\/?>/gi, '\n')
  s = s.replace(/<\/\s*(p|div|h[1-6]|li|blockquote|tr)\s*>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
       .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

function titleFromHtml(html: string, fallback: string): string {
  const h = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (h) { const t = htmlToText(h[1]).trim(); if (t) return t.slice(0, 60) }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (t) { const v = htmlToText(t[1]).trim(); if (v) return v.slice(0, 60) }
  return fallback
}

/** Parse an EPUB buffer into { title, author, chapters }. */
export function parseEpub(buf: Buffer): { title: string; author: string; chapters: { title: string; content: string }[] } {
  const entries = unzip(buf)

  // 1. container.xml → OPF path
  const container = decode(entries['META-INF/container.xml'])
  const opfPath = (container.match(/full-path="([^"]+)"/i)?.[1]) || Object.keys(entries).find((k) => k.endsWith('.opf')) || ''
  const opf = decode(entries[opfPath])
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  // 2. metadata
  const bookTitle = htmlToText(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || '').trim() || '未命名'
  const bookAuthor = htmlToText(opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1] || '').trim()

  // 3. manifest id → href
  const manifest: Record<string, string> = {}
  for (const m of Array.from(opf.matchAll(/<item\b[^>]*>/gi))) {
    const tag = m[0]
    const id = tag.match(/\bid="([^"]+)"/i)?.[1]
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1]
    if (id && href) manifest[id] = decodeURIComponent(href)
  }

  // 4. spine order
  const spine: string[] = []
  for (const m of Array.from(opf.matchAll(/<itemref\b[^>]*>/gi))) {
    const idref = m[0].match(/\bidref="([^"]+)"/i)?.[1]
    if (idref && manifest[idref]) spine.push(manifest[idref])
  }
  const hrefs = spine.length ? spine : Object.values(manifest).filter((h) => /\.x?html?$/i.test(h))

  const chapters: { title: string; content: string }[] = []
  let n = 0
  for (const href of hrefs) {
    const key = (opfDir + href).replace(/^\.\//, '')
    const html = decode(entries[key] || entries[href])
    if (!html) continue
    const text = htmlToText(html)
    if (text.replace(/\s/g, '').length < 20) continue // skip cover / empty pages
    n++
    chapters.push({ title: titleFromHtml(html, `第 ${n} 章`), content: text })
  }
  if (chapters.length === 0) throw new Error('没能从 EPUB 里解析出正文章节')
  return { title: bookTitle, author: bookAuthor, chapters }
}

const HEADING_RE = /^\s*(第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回节卷篇]|Chapter\s+\d+|CHAPTER\s+\d+|卷[一二三四五六七八九十]+)\b.*$/

/** Split raw text into chapters by heading lines; fallback to size chunks. */
export function splitText(raw: string, fallbackTitle = '正文'): { title: string; content: string }[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const chapters: { title: string; content: string }[] = []
  let cur: { title: string; content: string } | null = null
  for (const line of lines) {
    if (HEADING_RE.test(line) && line.trim().length <= 40) {
      if (cur) chapters.push(cur)
      cur = { title: line.trim(), content: '' }
    } else {
      if (!cur) cur = { title: fallbackTitle, content: '' }
      cur.content += line + '\n'
    }
  }
  if (cur) chapters.push(cur)

  const meaningful = chapters.filter((c) => c.content.trim().length > 0)
  if (meaningful.length > 1) return meaningful.map((c) => ({ title: c.title, content: c.content.trim() }))

  // No headings found → chunk by ~4000 chars on paragraph boundaries.
  const text = raw.trim()
  if (text.length <= 4000) return [{ title: fallbackTitle, content: text }]
  const paras = text.split(/\n\s*\n/)
  const out: { title: string; content: string }[] = []
  let acc = ''
  let idx = 0
  for (const para of paras) {
    if (acc.length + para.length > 4000 && acc) {
      idx++
      out.push({ title: `第 ${idx} 节`, content: acc.trim() })
      acc = ''
    }
    acc += para + '\n\n'
  }
  if (acc.trim()) { idx++; out.push({ title: `第 ${idx} 节`, content: acc.trim() }) }
  return out
}
