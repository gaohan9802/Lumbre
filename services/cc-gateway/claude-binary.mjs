import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PINNED_CLAUDE_CODE_VERSION, extractVersion } from '../cc-probe/contract.mjs'

function versionOf(run, binary) {
  try {
    return extractVersion(run(binary, ['--version'], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64_000,
    }))
  } catch {
    return ''
  }
}

export function resolveClaudeBinary({ dataDir, run = execFileSync, env = process.env }) {
  const globalVersion = versionOf(run, 'claude')
  if (globalVersion === PINNED_CLAUDE_CODE_VERSION) {
    return { binary: 'claude', version: globalVersion }
  }

  const installDir = path.join(dataDir, 'claude-code', PINNED_CLAUDE_CODE_VERSION)
  const binary = path.join(installDir, 'node_modules', '.bin', 'claude')
  let version = versionOf(run, binary)
  if (version !== PINNED_CLAUDE_CODE_VERSION) {
    fs.mkdirSync(installDir, { recursive: true, mode: 0o700 })
    run('npm', [
      'install', '--prefix', installDir,
      '--cache', path.join(dataDir, 'npm-cache'),
      '--no-save', '--no-package-lock', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error',
      `@anthropic-ai/claude-code@${PINNED_CLAUDE_CODE_VERSION}`,
    ], { encoding: 'utf8', env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
    version = versionOf(run, binary)
  }

  if (version !== PINNED_CLAUDE_CODE_VERSION) {
    throw new Error(`Claude Code version mismatch: expected ${PINNED_CLAUDE_CODE_VERSION}, found ${version || globalVersion || 'unknown'}`)
  }
  return { binary, version }
}
