import { formatMadrid } from '@/lib/madrid-time'

const REDACTED_CONFIRMATION_TOKEN = /"token":"[^"]+",?/

export function localizeToolTimes(result: string): string {
  return result.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})/g, iso => {
    const date = new Date(iso)
    return isNaN(date.getTime()) ? iso : `${formatMadrid(date)}（马德里时间）`
  })
}

export function toolResultForHistory(name: string, result: string): string {
  if (name === 'read_foto') {
    try {
      const list = JSON.parse(result)
      if (Array.isArray(list)) return JSON.stringify(list.map(({ url: _url, ...rest }: any) => rest)).slice(0, 4000)
    } catch {}
  }
  if (name === 'view_foto') {
    try {
      const { url: _url, ...rest } = JSON.parse(result)
      return JSON.stringify(rest).slice(0, 4000)
    } catch {}
  }
  return result.slice(0, 4000)
}

export function toolResultText(name: string, result: string): string {
  if (result.includes('"code":"CONFIRMATION_REQUIRED"')) {
    try {
      const payload = JSON.parse(result)
      if (payload?.confirmation) {
        const { token: _token, ...confirmation } = payload.confirmation
        return JSON.stringify({ ...payload, confirmation }).slice(0, 2000)
      }
    } catch {}
    return result.replace(REDACTED_CONFIRMATION_TOKEN, '').slice(0, 2000)
  }
  if (['fetch_txt', 'fetch_markdown', 'fetch_html', 'fetch_json'].includes(name)) return result.slice(0, 6000)
  if (name === 'read_emails' || name === 'search_emails') return result.slice(0, 8000)
  if (name === 'read_email_detail') return result.slice(0, 14000)
  if (name === 'gmail_status') return result.slice(0, 2000)
  if (name === 'read_foto' || name === 'view_foto') return toolResultForHistory(name, result)
  if (result.length <= 300) return result
  return result.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 300) + '…(truncated)'
}

export function toolResultContent(name: string, result: string): Array<Record<string, unknown>> {
  const text = toolResultText(name, result)
  if (name !== 'view_foto') return [{ type: 'text', text }]
  try {
    const parsed = JSON.parse(result)
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(parsed?.url || ''))
    if (match) return [
      { type: 'text', text },
      { type: 'image', mimeType: match[1].toLowerCase(), data: match[2].replace(/\s/g, '') },
    ]
  } catch {}
  return [{ type: 'text', text }]
}
