import path from 'node:path'
import { DataPathError } from './errors'

const DEFAULT_DATA_DIR = '/persistent'

export function getDataDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = env.DATA_DIR?.trim() || DEFAULT_DATA_DIR
  if (!path.isAbsolute(configured)) {
    throw new DataPathError('DATA_DIR must be an absolute path')
  }
  return path.resolve(configured)
}
