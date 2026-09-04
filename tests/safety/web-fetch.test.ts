import assert from 'node:assert/strict'
import test from 'node:test'

import { assertPublicHttpUrl, executeSafeFetch, isPrivateAddress } from '../../src/server/agent/tools/web-fetch'

test('web fetch rejects local, private, link-local, reserved and non-http targets', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1', '2001:db8::1']) {
    assert.equal(isPrivateAddress(address), true, address)
  }
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), /http/)
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1/admin'), /内网|保留/)
  await assert.rejects(() => assertPublicHttpUrl('http://metadata.google.internal/latest'), /不允许/)
  await assert.rejects(
    () => assertPublicHttpUrl('https://private.example/path', async () => [{ address: '10.20.30.40', family: 4 }]),
    /内网|保留/,
  )
  assert.equal(
    (await assertPublicHttpUrl('https://public.example/path', async () => [{ address: '93.184.216.34', family: 4 }])).hostname,
    'public.example',
  )
})

test('web fetch validates every redirect before following it', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } })
  }
  try {
    const result = await executeSafeFetch('fetch_txt', 'https://93.184.216.34/start')
    assert.match(result, /内网|保留/)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web fetch caps response bytes and strips sensitive caller-supplied headers', async () => {
  const originalFetch = globalThis.fetch
  let headers: HeadersInit | undefined
  globalThis.fetch = async (_input, init) => {
    headers = init?.headers
    return new Response('oversized', { status: 200, headers: { 'content-length': String(600 * 1024) } })
  }
  try {
    const result = await executeSafeFetch('fetch_txt', 'https://93.184.216.34/', {
      Authorization: 'Bearer secret', Cookie: 'secret=value', Accept: 'text/plain',
    })
    assert.match(result, /512KB/)
    const normalized = new Headers(headers)
    assert.equal(normalized.get('authorization'), null)
    assert.equal(normalized.get('cookie'), null)
    assert.equal(normalized.get('accept'), 'text/plain')
  } finally {
    globalThis.fetch = originalFetch
  }
})
