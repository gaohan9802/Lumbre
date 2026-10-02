import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MediaCatalogItem, MediaKind } from '@/lib/media-library'
import { getDataDir } from '@/server/data/config'
import { resolveDataPath } from '@/server/data/safe-path'

const clean = (value: unknown, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const strings = (value: unknown, max = 20) => Array.isArray(value) ? value.map(item => clean(item, 160)).filter(Boolean).slice(0, max) : []
const integer = (value: unknown) => Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined

const decodeEntities = (value: string) => value
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")

const htmlText = (value: string) => decodeEntities(value
  .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()

export function parseDoubanBookUrl(value: string): { id: string; url: URL } {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('请粘贴有效的豆瓣读书链接') }
  const match = /^\/subject\/(\d+)\/?$/.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'book.douban.com' || !match || url.username || url.password) {
    throw new Error('只支持 https://book.douban.com/subject/数字/ 格式的链接')
  }
  url.search = ''; url.hash = ''
  return { id: match[1], url }
}

export function parseDoubanCoverUrl(value: string): URL {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('豆瓣封面链接无效') }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.doubanio.com') || !url.pathname.startsWith('/view/subject/') || url.username || url.password) {
    throw new Error('豆瓣封面链接无效')
  }
  url.search = ''; url.hash = ''
  return url
}

const meta = (html: string, property: string) => {
  const tag = html.match(new RegExp(`<meta[^>]+property=["']${property.replace(':', '\\:')}["'][^>]*>`, 'i'))?.[0] || ''
  return clean(decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] || ''), 4000)
}

export function parseDoubanBookHtml(html: string, id: string, sourceUrl = `https://book.douban.com/subject/${id}/`): MediaCatalogItem {
  const jsonLd = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    .map(match => { try { return JSON.parse(match[1]) } catch { return null } })
    .find(value => value?.['@type'] === 'Book')
  const title = clean(jsonLd?.name || meta(html, 'og:title'), 200)
  if (!title) throw new Error('没有从豆瓣页面读到书籍资料')
  const info = htmlText(html.match(/<div[^>]+id=["']info["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')
  const field = (label: string, max = 200) => clean(info.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'))?.[1], max) || undefined
  const authors = Array.isArray(jsonLd?.author) ? strings(jsonLd.author.map((value: any) => value?.name)) : []
  const summaryHtml = html.slice(Math.max(0, html.search(/id=["']link-report["']/i))).match(/<div[^>]+class=["'][^"']*intro[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
  const cover = meta(html, 'og:image')
  let coverUrl: string | undefined
  try {
    const parsed = new URL(cover)
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.doubanio.com')) coverUrl = parsed.toString()
  } catch {}
  return {
    key: `douban-book:${id}`, kind: 'book', title,
    creators: authors.length ? authors : field('作者')?.split(/[\/、]/).map(value => value.trim()).filter(Boolean) || [],
    cover_url: coverUrl, summary: clean(htmlText(summaryHtml) || meta(html, 'og:description'), 4000) || undefined,
    publisher: field('出版社'), published_date: field('出版年', 40), page_count: integer(Number(field('页数', 20)?.match(/\d+/)?.[0])),
    isbn: clean(jsonLd?.isbn || field('ISBN', 32), 32) || undefined,
    source: { provider: 'douban-book', id, url: sourceUrl },
  }
}

async function readBoundedBytes(response: Response, maxBytes: number, errorMessage: string): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') || 0)
  if (length > maxBytes) throw new Error(errorMessage)
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel(); throw new Error(errorMessage) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

const readBoundedText = async (response: Response) => new TextDecoder().decode(await readBoundedBytes(response, 512 * 1024, '豆瓣页面过大，无法导入'))

function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
}

export async function readDoubanCover(idValue: string, urlValue: string): Promise<{ bytes: Uint8Array; type: string }> {
  const id = clean(idValue, 40)
  if (!/^\d+$/.test(id)) throw new Error('豆瓣书籍编号无效')
  const url = parseDoubanCoverUrl(urlValue)
  const file = resolveDataPath(getDataDir(), 'media-library', 'covers', `douban-${id}.img`)
  try {
    const bytes = new Uint8Array(await readFile(file))
    const type = imageMime(bytes)
    if (type) return { bytes, type }
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error }

  const response = await fetch(url, {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg', Referer: `https://book.douban.com/subject/${id}/`, 'User-Agent': 'Mozilla/5.0 (Lumbre private library)' },
  })
  if (!response.ok) throw new Error(`豆瓣封面读取失败（${response.status}）`)
  const bytes = await readBoundedBytes(response, 2 * 1024 * 1024, '豆瓣封面过大，无法保存')
  const type = imageMime(bytes)
  if (!type) throw new Error('豆瓣返回了无法识别的封面格式')
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, bytes)
  await rename(temporary, file)
  return { bytes, type }
}

export async function importDoubanBook(value: string): Promise<MediaCatalogItem> {
  const { id, url } = parseDoubanBookUrl(value)
  const response = await fetch(url, {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9', 'User-Agent': 'Mozilla/5.0 (Lumbre private library)' },
  })
  if (!response.ok) throw new Error(`豆瓣页面读取失败（${response.status}）`)
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) throw new Error('豆瓣返回了无法识别的内容')
  return parseDoubanBookHtml(await readBoundedText(response), id, url.toString())
}

async function json(url: URL, headers?: HeadersInit): Promise<any> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!response.ok) throw new Error(`catalog request failed (${response.status})`)
  return response.json()
}

function normalizedKey(item: MediaCatalogItem): string {
  return item.isbn || `${item.title.toLocaleLowerCase()}|${item.creators[0]?.toLocaleLowerCase() || ''}`
}

async function searchGoogleBooks(query: string): Promise<MediaCatalogItem[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim()
  if (!key) return []
  const isbn = query.replace(/[^0-9Xx]/g, '')
  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.searchParams.set('q', isbn.length === 10 || isbn.length === 13 ? `isbn:${isbn}` : query)
  url.searchParams.set('langRestrict', 'zh')
  url.searchParams.set('printType', 'books')
  url.searchParams.set('maxResults', '12')
  url.searchParams.set('key', key)
  const data = await json(url)
  return Array.isArray(data?.items) ? data.items.map((item: any): MediaCatalogItem | null => {
    const info = item?.volumeInfo || {}
    const title = clean(info.title, 200)
    if (!title || !item?.id) return null
    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : []
    const isbn13 = identifiers.find((value: any) => value?.type === 'ISBN_13')?.identifier
    const isbn10 = identifiers.find((value: any) => value?.type === 'ISBN_10')?.identifier
    const cover = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail
    return {
      key: `google-books:${item.id}`, kind: 'book', title,
      original_title: clean(info.subtitle, 200) || undefined,
      creators: strings(info.authors), cover_url: typeof cover === 'string' ? cover.replace(/^http:/, 'https:') : undefined,
      summary: clean(info.description, 4000) || undefined, publisher: clean(info.publisher, 200) || undefined,
      published_date: clean(info.publishedDate, 40) || undefined, page_count: integer(info.pageCount),
      isbn: clean(isbn13 || isbn10, 32) || undefined,
      source: { provider: 'google-books', id: String(item.id), url: clean(info.infoLink, 1000) || undefined },
    }
  }).filter((item: MediaCatalogItem | null): item is MediaCatalogItem => !!item) : []
}

async function searchOpenLibrary(query: string): Promise<MediaCatalogItem[]> {
  const isbn = query.replace(/[^0-9Xx]/g, '')
  const url = new URL('https://openlibrary.org/search.json')
  if (isbn.length === 10 || isbn.length === 13) url.searchParams.set('isbn', isbn)
  else url.searchParams.set('q', query)
  url.searchParams.set('lang', 'zh')
  url.searchParams.set('limit', '12')
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,publisher,isbn,number_of_pages_median,cover_i')
  const data = await json(url, { 'User-Agent': 'Lumbre/1.0 (private two-person library)' })
  return Array.isArray(data?.docs) ? data.docs.map((doc: any): MediaCatalogItem | null => {
    const title = clean(doc?.title, 200)
    const id = clean(doc?.key, 180).replace(/^\/works\//, '')
    if (!title || !id) return null
    const foundIsbn = strings(doc.isbn, 30).find(value => value.length === 13) || strings(doc.isbn, 30)[0]
    return {
      key: `open-library:${id}`, kind: 'book', title, creators: strings(doc.author_name),
      cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
      publisher: strings(doc.publisher, 1)[0], published_date: integer(doc.first_publish_year)?.toString(),
      page_count: integer(doc.number_of_pages_median), isbn: foundIsbn,
      source: { provider: 'open-library', id, url: `https://openlibrary.org/works/${encodeURIComponent(id)}` },
    }
  }).filter((item: MediaCatalogItem | null): item is MediaCatalogItem => !!item) : []
}

async function tmdb(path: string, params: Record<string, string>): Promise<any> {
  const token = process.env.TMDB_API_READ_TOKEN?.trim()
  if (!token) throw new Error('TMDB_API_READ_TOKEN is not configured')
  const url = new URL(`https://api.themoviedb.org/3/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return json(url, { Authorization: `Bearer ${token}`, accept: 'application/json' })
}

async function searchTmdb(kind: 'movie' | 'tv', query: string): Promise<MediaCatalogItem[]> {
  const data = await tmdb(`search/${kind}`, { query, language: 'zh-CN', include_adult: 'false', page: '1' })
  return Array.isArray(data?.results) ? data.results.slice(0, 12).map((item: any): MediaCatalogItem | null => {
    const id = String(item?.id || '')
    const title = clean(kind === 'movie' ? item?.title : item?.name, 200)
    if (!id || !title) return null
    const original = clean(kind === 'movie' ? item?.original_title : item?.original_name, 200)
    const release = clean(kind === 'movie' ? item?.release_date : item?.first_air_date, 40)
    return {
      key: `tmdb:${kind}:${id}`, kind, title, original_title: original && original !== title ? original : undefined,
      creators: [], cover_url: item?.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
      summary: clean(item?.overview, 4000) || undefined, release_date: release || undefined,
      source: { provider: 'tmdb', id, url: `https://www.themoviedb.org/${kind}/${id}` },
    }
  }).filter((item: MediaCatalogItem | null): item is MediaCatalogItem => !!item) : []
}

export async function searchMediaCatalog(kind: MediaKind, queryValue: string): Promise<{ items: MediaCatalogItem[]; providers: string[]; warning?: string }> {
  const query = clean(queryValue, 160)
  if (!query) return { items: [], providers: [] }
  if (kind !== 'book') {
    try { return { items: await searchTmdb(kind, query), providers: ['TMDB'] } }
    catch (error: any) { return { items: [], providers: [], warning: error?.message || '影视资料搜索暂不可用' } }
  }
  const settled = await Promise.allSettled([searchGoogleBooks(query), searchOpenLibrary(query)])
  const items = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const unique = Array.from(new Map(items.map(item => [normalizedKey(item), item])).values()).slice(0, 20)
  const providers = Array.from(new Set(unique.map(item => item.source.provider === 'google-books' ? 'Google Books' : 'Open Library')))
  return { items: unique, providers, warning: unique.length ? undefined : '没有匹配资料，可以手动添加' }
}

export async function readTmdbDetails(kind: 'movie' | 'tv', idValue: string): Promise<MediaCatalogItem> {
  const id = clean(idValue, 40)
  if (!/^\d+$/.test(id)) throw new Error('invalid TMDB id')
  const data = await tmdb(`${kind}/${id}`, { language: 'zh-CN', append_to_response: 'credits' })
  const title = clean(kind === 'movie' ? data?.title : data?.name, 200)
  if (!title) throw new Error('TMDB item not found')
  const credits = data?.credits || {}
  const directors = kind === 'movie'
    ? (Array.isArray(credits.crew) ? credits.crew.filter((person: any) => person?.job === 'Director').map((person: any) => person?.name) : [])
    : (Array.isArray(data.created_by) ? data.created_by.map((person: any) => person?.name) : [])
  const release = clean(kind === 'movie' ? data?.release_date : data?.first_air_date, 40)
  const runtime = kind === 'movie' ? integer(data?.runtime) : integer(data?.episode_run_time?.[0])
  return {
    key: `tmdb:${kind}:${id}`, kind, title,
    original_title: clean(kind === 'movie' ? data?.original_title : data?.original_name, 200) || undefined,
    creators: strings(directors), directors: strings(directors), cast: Array.isArray(credits.cast) ? strings(credits.cast.map((person: any) => person?.name), 12) : [],
    countries: Array.isArray(data.production_countries) ? strings(data.production_countries.map((country: any) => country?.name)) : [],
    cover_url: data?.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
    summary: clean(data?.overview, 4000) || undefined, release_date: release || undefined, runtime_minutes: runtime,
    source: { provider: 'tmdb', id, url: `https://www.themoviedb.org/${kind}/${id}` },
  }
}
