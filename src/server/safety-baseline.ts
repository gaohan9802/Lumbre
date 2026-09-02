import type { ToolDef } from './tools'

const DEBUG_API_PREFIXES = ['/api/debug', '/api/memory/breath-debug']

/** Debug endpoints are useful locally, but must not exist in production. */
export function isDebugApiPath(pathname: string): boolean {
  return DEBUG_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function shouldBlockDebugApi(pathname: string, nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === 'production' && isDebugApiPath(pathname)
}

const UNATTENDED_WAKE_BLOCKED_TOOLS = new Set([
  'delete_diary',
  'delete_note',
  'delete_foto',
  'delete_timeline_encouragement',
  'remove_todo',
  'delete_wish',
  'send_email',
  'reply_email',
])

export function unattendedWakeDenial(name: string, input: Record<string, any>): string | null {
  if (UNATTENDED_WAKE_BLOCKED_TOOLS.has(name)) {
    return `Unattended wake is not allowed to execute ${name}`
  }
  // trace normally edits a memory bucket and can also delete it via a flag.
  if (name === 'trace' && input?.delete === true) {
    return 'Unattended wake is not allowed to delete memory buckets'
  }
  return null
}

/** Hide forbidden capabilities from the wake model as well as denying at runtime. */
export function toolsForUnattendedWake(tools: ToolDef[]): ToolDef[] {
  return tools
    .filter(tool => !UNATTENDED_WAKE_BLOCKED_TOOLS.has(tool.name))
    .map(tool => {
      if (tool.name !== 'trace' || !tool.input_schema.properties.delete) return tool
      const { delete: _delete, ...properties } = tool.input_schema.properties
      return {
        ...tool,
        description: tool.description.replace(/,delete=True删除。?/, '。'),
        input_schema: { ...tool.input_schema, properties },
      }
    })
}

export function isTrustedInternalRequest(
  suppliedSecret: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.LUMBRE_INTERNAL_SECRET || env.LUMBRE_AUTH_SECRET || env.LUMBRE_ACCESS_PASSWORD || ''
  if (!expected || !suppliedSecret || expected.length !== suppliedSecret.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ suppliedSecret.charCodeAt(i)
  return mismatch === 0
}
