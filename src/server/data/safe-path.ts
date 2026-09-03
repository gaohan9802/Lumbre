import path from 'node:path'
import { DataPathError } from './errors'

function assertSafeSegment(segment: string): void {
  if (
    !segment
    || segment === '.'
    || segment === '..'
    || segment.includes('\0')
    || segment.includes('/')
    || segment.includes('\\')
    || path.isAbsolute(segment)
  ) {
    throw new DataPathError(`Unsafe data path segment: ${JSON.stringify(segment)}`)
  }
}

/** Resolve static directory names and validated identifiers without allowing traversal. */
export function resolveDataPath(root: string, ...segments: string[]): string {
  if (!path.isAbsolute(root)) throw new DataPathError('Data root must be absolute')
  for (const segment of segments) assertSafeSegment(segment)

  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, ...segments)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new DataPathError('Resolved path escaped the data root')
  }
  return resolved
}

export function assertIdentifier(value: string, pattern: RegExp, label = 'identifier'): string {
  if (!pattern.test(value)) throw new DataPathError(`Invalid ${label}`)
  return value
}

export function assertDateKey(value: string, label = 'date'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DataPathError(`Invalid ${label}`)
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new DataPathError(`Invalid ${label}`)
  }
  return value
}
