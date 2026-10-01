import { formatMadrid } from '@/lib/madrid-time'

const REDACTED_CONFIRMATION_TOKEN = /"token":"[^"]+",?/
const MAX_TOOL_RESULT_CHARS = 16_000
const TRUNCATED_SUFFIX = '\n…(truncated)'

function limitToolResult(result: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (result.length <= max) return result
  return result.slice(0, max - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX
}

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
      if (Array.isArray(list)) return limitToolResult(JSON.stringify(list.map(({ url: _url, ...rest }: any) => rest)))
    } catch {}
  }
  if (name === 'view_foto') {
    try {
      const { url: _url, ...rest } = JSON.parse(result)
      return limitToolResult(JSON.stringify(rest))
    } catch {}
  }
  return limitToolResult(result)
}

export function toolResultText(name: string, result: string): string {
  if (result.includes('"code":"CONFIRMATION_REQUIRED"')) {
    try {
      const payload = JSON.parse(result)
      if (payload?.confirmation) {
        const { token: _token, ...confirmation } = payload.confirmation
        return limitToolResult(JSON.stringify({ ...payload, confirmation }), 2000)
      }
    } catch {}
    return limitToolResult(result.replace(REDACTED_CONFIRMATION_TOKEN, ''), 2000)
  }
  if (name === 'read_foto' || name === 'view_foto') return toolResultForHistory(name, result)
  return limitToolResult(result)
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
