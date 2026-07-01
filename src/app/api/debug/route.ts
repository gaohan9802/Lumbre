import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = process.env.DATA_DIR || path.join(cwd, 'data')

  const info: Record<string, unknown> = {
    cwd,
    DATA_DIR_env: process.env.DATA_DIR || '(not set)',
    resolved_dataDir: dataDir,
  }

  // Node.js fs test
  info.fs_existsSync = fs.existsSync('/persistent')
  info.fs_existsSync_dataDir = fs.existsSync(dataDir)

  // Shell test - bypass Node.js fs
  try {
    info.shell_ls_root = execSync('ls -d /persistent 2>&1').toString().trim()
  } catch (e: unknown) {
    info.shell_ls_root = `error: ${(e as Error).message}`
  }

  try {
    info.shell_ls_persistent = execSync('ls /persistent/ 2>&1').toString().trim()
  } catch (e: unknown) {
    info.shell_ls_persistent = `error: ${(e as Error).message}`
  }

  try {
    info.shell_mount = execSync('mount | grep persistent 2>&1').toString().trim()
  } catch (e: unknown) {
    info.shell_mount = `error: ${(e as Error).message}`
  }

  try {
    info.shell_stat = execSync('stat /persistent 2>&1').toString().trim()
  } catch (e: unknown) {
    info.shell_stat = `error: ${(e as Error).message}`
  }

  // Direct read attempt (not existsSync, just try to read)
  try {
    const files = fs.readdirSync('/persistent')
    info.fs_readdir_persistent = files
  } catch (e: unknown) {
    info.fs_readdir_persistent_error = `${(e as Error).message}`
  }

  // Data dir contents
  if (fs.existsSync(dataDir)) {
    info.dataDir_contents = fs.readdirSync(dataDir)
  }

  return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } })
}
