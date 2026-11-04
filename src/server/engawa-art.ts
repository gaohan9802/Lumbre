export function isAllowedEngawaArtUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && url.hostname === 'openaccess-cdn.clevelandart.org'
  } catch { return false }
}
