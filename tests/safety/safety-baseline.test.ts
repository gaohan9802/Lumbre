import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  isDebugApiPath,
  isTrustedInternalRequest,
  shouldBlockDebugApi,
} from '../../src/server/safety-baseline'

test('production blocks every known debug API while development keeps them available', () => {
  for (const pathname of ['/api/debug', '/api/debug/tools', '/api/memory/breath-debug']) {
    assert.equal(isDebugApiPath(pathname), true)
    assert.equal(shouldBlockDebugApi(pathname, 'production'), true)
    assert.equal(shouldBlockDebugApi(pathname, 'development'), false)
  }
  assert.equal(shouldBlockDebugApi('/api/chat', 'production'), false)
})

test('Next.js discovers the safety middleware alongside the src app directory', () => {
  assert.equal(existsSync(new URL('../../src/middleware.ts', import.meta.url)), true)
  assert.equal(existsSync(new URL('../../middleware.ts', import.meta.url)), false)
})

test('internal wake credentials fail closed', () => {
  const env = { NODE_ENV: 'test', LUMBRE_INTERNAL_SECRET: 'correct-secret' } as NodeJS.ProcessEnv
  assert.equal(isTrustedInternalRequest('correct-secret', env), true)
  assert.equal(isTrustedInternalRequest('wrong-secret', env), false)
  assert.equal(isTrustedInternalRequest(null, env), false)
  assert.equal(isTrustedInternalRequest('anything', { NODE_ENV: 'test' } as NodeJS.ProcessEnv), false)
})

test('retired Galatea integration is absent from source and tool registration', () => {
  assert.equal(existsSync(new URL('../../src/server/galatea.ts', import.meta.url)), false)
  const source = readFileSync(new URL('../../src/server/tools.ts', import.meta.url), 'utf8')
  assert.equal(/GALATEA_TOKEN|GALATEA_URL|executeGalatea|name:\s*['"]galatea['"]/.test(source), false)
})
