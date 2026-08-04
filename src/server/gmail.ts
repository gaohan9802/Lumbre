/**
 * Gmail API integration for Star.
 * OAuth2 access tokens are refreshed automatically; requests use native fetch.
 */

const GMAIL_CLIENT_ID = (process.env.GMAIL_CLIENT_ID || '').trim()
const GMAIL_CLIENT_SECRET = (process.env.GMAIL_CLIENT_SECRET || '').trim()
const GMAIL_REFRESH_TOKEN = (process.env.GMAIL_REFRESH_TOKEN || '').trim()
const GMAIL_ADDRESS = (process.env.GMAIL_ADDRESS || 'gris.sidereal@gmail.com').trim()
const TOKEN_TIMEOUT_MS = 12_000
const API_TIMEOUT_MS = 15_000
const MAX_EMAILS = 15

let cachedAccessToken = ''
let tokenExpiresAt = 0
let refreshInFlight: Promise<string> | null = null

function assertConfigured() {
  const missing = [
    !GMAIL_CLIENT_ID && 'GMAIL_CLIENT_ID',
    !GMAIL_CLIENT_SECRET && 'GMAIL_CLIENT_SECRET',
    !GMAIL_REFRESH_TOKEN && 'GMAIL_REFRESH_TOKEN',
  ].filter(Boolean)
  if (missing.length) throw new Error(`Gmail 未配置：缺少 ${missing.join(', ')}`)
}

function safeGoogleError(status: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    const message = parsed?.error?.message || parsed?.error_description || parsed?.error || raw
    return `Gmail API ${status}: ${String(message).slice(0, 500)}`
  } catch {
    return `Gmail API ${status}: ${raw.slice(0, 500) || 'unknown error'}`
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function errorCause(err: any): string {
  return String(err?.cause?.code || err?.code || err?.name || err?.message || 'unknown')
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function refreshAccessToken(): Promise<string> {
  assertConfigured()
  const body = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    refresh_token: GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }, TOKEN_TIMEOUT_MS)
      const raw = await res.text()
      if (!res.ok) {
        const message = safeGoogleError(res.status, raw)
        if (!isRetryableStatus(res.status) || attempt === 1) throw new Error(message)
        lastError = message
      } else {
        const data = JSON.parse(raw)
        if (!data.access_token) throw new Error('Gmail token refresh 返回中缺少 access_token')
        cachedAccessToken = data.access_token
        tokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000
        return cachedAccessToken
      }
    } catch (err: any) {
      lastError = err?.name === 'AbortError'
        ? `Gmail token refresh 超时（${TOKEN_TIMEOUT_MS / 1000}s）`
        : err.message || String(err)
      if (attempt === 1 || /invalid_grant|invalid_client|未配置/i.test(lastError)) {
        throw new Error(lastError)
      }
    }
    await sleep(500 * (attempt + 1))
  }
  throw new Error(lastError || 'Gmail token refresh failed')
}

/** Refresh the access token, deduplicating simultaneous refresh requests. */
async function getAccessToken(force = false): Promise<string> {
  if (!force && cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) return cachedAccessToken
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

/** Make an authenticated request to Gmail API. GETs retry transient failures; 401 refreshes once. */
async function gmailFetch(path: string, options: RequestInit = {}): Promise<any> {
  const method = String(options.method || 'GET').toUpperCase()
  const maxAttempts = method === 'GET' ? 3 : 2
  let forceRefresh = false
  let lastError = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getAccessToken(forceRefresh)
    forceRefresh = false
    let res: Response
    try {
      res = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      }, API_TIMEOUT_MS)
    } catch (err: any) {
      lastError = err?.name === 'AbortError'
        ? `Gmail 请求超时（${API_TIMEOUT_MS / 1000}s）`
        : `Gmail 网络错误 (${errorCause(err)})`
      // Retrying a POST after a socket error may duplicate a sent email.
      if (method !== 'GET' || attempt === maxAttempts - 1) throw new Error(lastError)
      await sleep(500 * Math.pow(2, attempt))
      continue
    }

    if (res.ok) {
      if (res.status === 204) return null
      return res.json()
    }

    const raw = await res.text()
    lastError = safeGoogleError(res.status, raw)
    if (res.status === 401 && attempt === 0) {
      cachedAccessToken = ''
      tokenExpiresAt = 0
      forceRefresh = true
      continue
    }
    if (method === 'GET' && isRetryableStatus(res.status) && attempt < maxAttempts - 1) {
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * Math.pow(2, attempt))
      continue
    }
    throw new Error(lastError)
  }
  throw new Error(lastError || 'Gmail API 请求失败')
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

function encodeBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function getHeader(headers: Array<{name: string, value: string}>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

async function partData(messageId: string, part: any): Promise<string> {
  if (part?.body?.data) return decodeBase64Url(part.body.data)
  if (part?.body?.attachmentId) {
    const attachment = await gmailFetch(`messages/${messageId}/attachments/${part.body.attachmentId}`)
    return attachment?.data ? decodeBase64Url(attachment.data) : ''
  }
  return ''
}

/** Recursively extract body, including bodies stored as Gmail attachments. */
async function extractBody(messageId: string, payload: any): Promise<string> {
  const direct = await partData(messageId, payload)
  if (direct) return payload?.mimeType === 'text/html' ? htmlToPlainText(direct) : direct

  const parts: any[] = Array.isArray(payload?.parts) ? payload.parts : []
  for (const mime of ['text/plain', 'text/html']) {
    for (const part of parts) {
      if (part.mimeType === mime) {
        const data = await partData(messageId, part)
        if (data) return mime === 'text/html' ? htmlToPlainText(data) : data
      }
    }
  }
  for (const part of parts) {
    if (part.parts) {
      const nested = await extractBody(messageId, part)
      if (nested) return nested
    }
  }
  return ''
}

export interface EmailSummary {
  id: string
  from: string
  subject: string
  snippet: string
  date: string
  unread: boolean
}

export interface EmailDetail extends EmailSummary {
  threadId: string
  to: string
  body: string
}

function clampLimit(value: number | undefined, fallback = 10): number {
  const n = Number(value)
  return Math.max(1, Math.min(MAX_EMAILS, Number.isFinite(n) ? Math.floor(n) : fallback))
}

async function getSummary(messageId: string): Promise<EmailSummary> {
  const detail = await gmailFetch(`messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
  const headers = detail.payload?.headers || []
  return {
    id: detail.id,
    from: getHeader(headers, 'From'),
    subject: getHeader(headers, 'Subject') || '(无主题)',
    snippet: detail.snippet || '',
    date: getHeader(headers, 'Date'),
    unread: (detail.labelIds || []).includes('UNREAD'),
  }
}

/** Fetch summaries concurrently while preserving Gmail's result order. */
async function listSummaries(path: string, maxResults?: number): Promise<EmailSummary[]> {
  const limit = clampLimit(maxResults)
  const list = await gmailFetch(`${path}${path.includes('?') ? '&' : '?'}maxResults=${limit}`)
  const ids = (list.messages || []).slice(0, limit).map((m: any) => String(m.id))
  const settled = await Promise.allSettled(ids.map(getSummary))
  const rows: EmailSummary[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') rows.push(result.value)
    else console.error(`[Gmail] metadata failed for item ${index + 1}:`, result.reason?.message || result.reason)
  })
  if (ids.length && !rows.length) throw new Error('Gmail 邮件列表已取得，但邮件详情全部读取失败')
  return rows
}

export async function sendEmail(to: string, subject: string, body: string): Promise<{ok: boolean, messageId?: string, error?: string}> {
  try {
    if (!String(to || '').trim()) throw new Error('收件人不能为空')
    const raw = [
      `From: ${GMAIL_ADDRESS}`,
      `To: ${String(to).trim()}`,
      `Subject: =?UTF-8?B?${Buffer.from(String(subject || '(无主题)')).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      String(body || ''),
    ].join('\r\n')
    const result = await gmailFetch('messages/send', { method: 'POST', body: JSON.stringify({ raw: encodeBase64Url(raw) }) })
    return { ok: true, messageId: result.id }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function readEmails(maxResults = 10): Promise<EmailSummary[]> {
  return listSummaries('messages?labelIds=INBOX', maxResults)
}

export async function searchEmails(query: string, maxResults = 10): Promise<EmailSummary[]> {
  if (!String(query || '').trim()) throw new Error('搜索条件不能为空')
  return listSummaries(`messages?q=${encodeURIComponent(String(query).trim())}`, maxResults)
}

export async function readEmailDetail(messageId: string): Promise<EmailDetail> {
  if (!String(messageId || '').trim()) throw new Error('邮件 id 不能为空')
  const detail = await gmailFetch(`messages/${encodeURIComponent(messageId)}?format=full`)
  const headers = detail.payload?.headers || []
  const body = await extractBody(detail.id, detail.payload)
  return {
    id: detail.id,
    threadId: detail.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject') || '(无主题)',
    date: getHeader(headers, 'Date'),
    snippet: detail.snippet || '',
    body: body.slice(0, 12_000),
    unread: (detail.labelIds || []).includes('UNREAD'),
  }
}

export async function replyEmail(messageId: string, body: string): Promise<{ok: boolean, messageId?: string, error?: string}> {
  try {
    if (!String(messageId || '').trim()) throw new Error('邮件 id 不能为空')
    const original = await gmailFetch(`messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`)
    const headers = original.payload?.headers || []
    const replyTo = getHeader(headers, 'Reply-To') || getHeader(headers, 'From')
    const originalSubject = getHeader(headers, 'Subject') || '(无主题)'
    const messageIdHeader = getHeader(headers, 'Message-ID')
    const references = [getHeader(headers, 'References'), messageIdHeader].filter(Boolean).join(' ')
    if (!replyTo) throw new Error('原邮件没有可用的回复地址')

    const subject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`
    const raw = [
      `From: ${GMAIL_ADDRESS}`,
      `To: ${replyTo}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      messageIdHeader ? `In-Reply-To: ${messageIdHeader}` : '',
      references ? `References: ${references}` : '',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      String(body || ''),
    ].filter(Boolean).join('\r\n')
    const result = await gmailFetch('messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: encodeBase64Url(raw), threadId: original.threadId }),
    })
    return { ok: true, messageId: result.id }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

/** Lightweight diagnostics without exposing OAuth secrets. */
export async function checkGmailStatus(): Promise<Record<string, any>> {
  const configured = Boolean(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN)
  if (!configured) return { ok: false, configured, address: GMAIL_ADDRESS, error: 'Gmail OAuth 环境变量不完整' }
  try {
    const profile = await gmailFetch('profile')
    return {
      ok: true,
      configured: true,
      address: profile.emailAddress || GMAIL_ADDRESS,
      messages_total: profile.messagesTotal,
      threads_total: profile.threadsTotal,
      token_cached: Boolean(cachedAccessToken && Date.now() < tokenExpiresAt),
    }
  } catch (err: any) {
    return { ok: false, configured: true, address: GMAIL_ADDRESS, error: err.message }
  }
}
