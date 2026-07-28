/**
 * Gmail API integration for Star (gris.sidereal@gmail.com)
 * Uses OAuth2 with automatic access token refresh.
 * No extra dependencies — uses native fetch + Gmail REST API.
 */

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || ''
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || ''
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || ''
const GMAIL_ADDRESS = 'gris.sidereal@gmail.com'

let cachedAccessToken = ''
let tokenExpiresAt = 0

/** Refresh the access token using the long-lived refresh token */
async function getAccessToken(): Promise<string> {
  console.log("[Gmail Debug] client_id length:", GMAIL_CLIENT_ID.length, "starts:", GMAIL_CLIENT_ID.slice(0,10))
  console.log("[Gmail Debug] client_secret length:", GMAIL_CLIENT_SECRET.length, "starts:", GMAIL_CLIENT_SECRET.slice(0,6))
  console.log("[Gmail Debug] refresh_token length:", GMAIL_REFRESH_TOKEN.length, "starts:", GMAIL_REFRESH_TOKEN.slice(0,6))
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  cachedAccessToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000
  return cachedAccessToken
}

/** Make an authenticated request to Gmail API */
async function gmailFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API error (${res.status}): ${text}`)
  }
  return res.json()
}

/** Decode base64url encoded content */
function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/** Encode content to base64url */
function encodeBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Extract header value from message headers */
function getHeader(headers: Array<{name: string, value: string}>, name: string): string {
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

/** Extract plain text body from message payload */
function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }
  if (payload.parts) {
    const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain')
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data)
    }
    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html')
    if (htmlPart?.body?.data) {
      const html = decodeBase64Url(htmlPart.body.data)
      return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    }
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part)
        if (nested) return nested
      }
    }
  }
  return ''
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface EmailSummary {
  id: string
  from: string
  subject: string
  snippet: string
  date: string
  unread: boolean
}

export interface EmailDetail {
  id: string
  threadId: string
  from: string
  to: string
  subject: string
  date: string
  body: string
  unread: boolean
}

/** Send an email */
export async function sendEmail(to: string, subject: string, body: string): Promise<{ok: boolean, messageId?: string, error?: string}> {
  try {
    const raw = [
      `From: ${GMAIL_ADDRESS}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n')

    const encoded = encodeBase64Url(raw)
    const result = await gmailFetch('messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: encoded }),
    })
    return { ok: true, messageId: result.id }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

/** Read recent emails from inbox */
export async function readEmails(maxResults: number = 10): Promise<EmailSummary[]> {
  const list = await gmailFetch(`messages?maxResults=${maxResults}&labelIds=INBOX`)
  if (!list.messages || list.messages.length === 0) return []

  const summaries: EmailSummary[] = []
  const ids = list.messages.slice(0, Math.min(maxResults, 15))
  for (const msg of ids) {
    const detail = await gmailFetch(`messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    const headers = detail.payload?.headers || []
    summaries.push({
      id: detail.id,
      from: getHeader(headers, 'From'),
      subject: getHeader(headers, 'Subject'),
      snippet: detail.snippet || '',
      date: getHeader(headers, 'Date'),
      unread: (detail.labelIds || []).includes('UNREAD'),
    })
  }
  return summaries
}

/** Search emails by query (Gmail search syntax) */
export async function searchEmails(query: string, maxResults: number = 10): Promise<EmailSummary[]> {
  const list = await gmailFetch(`messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`)
  if (!list.messages || list.messages.length === 0) return []

  const summaries: EmailSummary[] = []
  const ids = list.messages.slice(0, Math.min(maxResults, 15))
  for (const msg of ids) {
    const detail = await gmailFetch(`messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    const headers = detail.payload?.headers || []
    summaries.push({
      id: detail.id,
      from: getHeader(headers, 'From'),
      subject: getHeader(headers, 'Subject'),
      snippet: detail.snippet || '',
      date: getHeader(headers, 'Date'),
      unread: (detail.labelIds || []).includes('UNREAD'),
    })
  }
  return summaries
}

/** Read full detail of a specific email */
export async function readEmailDetail(messageId: string): Promise<EmailDetail> {
  const detail = await gmailFetch(`messages/${messageId}?format=full`)
  const headers = detail.payload?.headers || []
  const body = extractBody(detail.payload)

  return {
    id: detail.id,
    threadId: detail.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    body: body.slice(0, 4000),
    unread: (detail.labelIds || []).includes('UNREAD'),
  }
}

/** Reply to an email (same thread) */
export async function replyEmail(messageId: string, body: string): Promise<{ok: boolean, messageId?: string, error?: string}> {
  try {
    const original = await gmailFetch(`messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`)
    const headers = original.payload?.headers || []
    const originalFrom = getHeader(headers, 'From')
    const originalSubject = getHeader(headers, 'Subject')
    const messageIdHeader = getHeader(headers, 'Message-ID')

    const subject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`
    const raw = [
      `From: ${GMAIL_ADDRESS}`,
      `To: ${originalFrom}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      `In-Reply-To: ${messageIdHeader}`,
      `References: ${messageIdHeader}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n')

    const encoded = encodeBase64Url(raw)
    const result = await gmailFetch('messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: encoded, threadId: original.threadId }),
    })
    return { ok: true, messageId: result.id }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}
