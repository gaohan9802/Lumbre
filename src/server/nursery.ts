const SERVICE_URL = (process.env.NURSERY_SERVICE_URL || 'http://nursery:8800').replace(/\/$/, '')
const SERVICE_TOKEN = process.env.NURSERY_BRIDGE_TOKEN || ''

type NurseryResponse = { ok?: boolean; result?: string; error?: string; [key: string]: unknown }

async function request(path: string, init?: RequestInit): Promise<NurseryResponse> {
  if (SERVICE_TOKEN.length < 32) throw new Error('Nursery 尚未配置')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch(`${SERVICE_URL}${path}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
    const value = await response.json().catch(() => ({})) as NurseryResponse
    if (!response.ok || value.ok === false) throw new Error(String(value.error || `Nursery ${response.status}`))
    return value
  } finally {
    clearTimeout(timer)
  }
}

export async function readNurseryStatus(): Promise<string> {
  const value = await request('/v1/status')
  return String(value.result || '')
}

export async function readNurseryHealth(): Promise<NurseryResponse> {
  const response = await fetch(`${SERVICE_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  const value = await response.json().catch(() => ({})) as NurseryResponse
  if (!response.ok) throw new Error('Nursery 暂时没有醒来')
  return value
}

export async function executeNurseryCommand(command: string): Promise<string> {
  const value = await request('/v1/command', { method: 'POST', body: JSON.stringify({ command }) })
  return String(value.result || '')
}

export async function executeNurseryMama(action: string, args: string[] = []): Promise<NurseryResponse> {
  return request('/v1/mama', { method: 'POST', body: JSON.stringify({ action, args }) })
}

export async function birthNurseryChild(name = ''): Promise<string> {
  const value = await request('/v1/birth', { method: 'POST', body: JSON.stringify({ name }) })
  return String(value.result || '')
}
