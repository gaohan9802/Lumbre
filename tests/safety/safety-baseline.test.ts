import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  isDebugApiPath,
  isTrustedInternalRequest,
  shouldBlockDebugApi,
  toolsForUnattendedWake,
  unattendedWakeDenial,
} from '../../src/server/safety-baseline'

test('production blocks every known debug API while development keeps them available', () => {
  for (const pathname of ['/api/debug', '/api/debug/tools', '/api/memory/breath-debug']) {
    assert.equal(isDebugApiPath(pathname), true)
    assert.equal(shouldBlockDebugApi(pathname, 'production'), true)
    assert.equal(shouldBlockDebugApi(pathname, 'development'), false)
  }
  assert.equal(shouldBlockDebugApi('/api/chat', 'production'), false)
})

test('unattended wake hides and denies destructive or external-write tools', () => {
  const tools = [
    { name: 'read_diary', description: 'read', input_schema: { type: 'object' as const, properties: {} } },
    { name: 'delete_diary', description: 'delete', input_schema: { type: 'object' as const, properties: {} } },
    { name: 'send_email', description: 'send', input_schema: { type: 'object' as const, properties: {} } },
    { name: 'trace', description: '修改,delete=True删除。', input_schema: { type: 'object' as const, properties: { delete: { type: 'boolean' } } } },
  ]
  const available = toolsForUnattendedWake(tools)
  assert.deepEqual(available.map(tool => tool.name), ['read_diary', 'trace'])
  assert.equal('delete' in available[1].input_schema.properties, false)
  assert.match(unattendedWakeDenial('delete_diary', {}) || '', /not allowed/)
  assert.match(unattendedWakeDenial('trace', { delete: true }) || '', /delete memory/)
  assert.equal(unattendedWakeDenial('trace', { resolved: 1 }), null)
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
