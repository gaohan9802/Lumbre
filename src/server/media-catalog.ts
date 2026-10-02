import type { MediaCatalogItem, MediaKind } from '@/lib/media-library'

const clean = (value: unknown, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const strings = (value: unknown, max = 20) => Array.isArray(value) ? value.map(item => clean(item, 160)).filter(Boolean).slice(0, max) : []
const integer = (value: unknown) => Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined

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
