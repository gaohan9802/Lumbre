#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const dataDir = mkdtempSync(path.join(tmpdir(), 'lumbre-build-data-'))
const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')

try {
  const result = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
