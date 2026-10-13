import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { NextRequest } from 'next/server'
import { groupTravelVisits, projectTravelPoint } from '../../src/lib/travel-map'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-travel-map-'))
process.env.DATA_DIR = root
let store: typeof import('../../src/server/travel-visit-store')
let search: typeof import('../../src/app/api/travel-visits/search/route').GET
let update: typeof import('../../src/app/api/travel-visits/route').POST
let runtime: typeof import('../../src/server/tool-runtime')

before(async () => {
  store = await import('../../src/server/travel-visit-store')
  search = (await import('../../src/app/api/travel-visits/search/route')).GET
  update = (await import('../../src/app/api/travel-visits/route')).POST
  runtime = await import('../../src/server/tool-runtime')
})

test('fire and star can append identity-fixed travel journal entries', async () => {
  const visit = store.saveTravelVisit({ place_id: 'relation:2', place_name: '东京', address: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, start_date: '2026-04-01', end_date: null, companion: 'star', companion_name: '', note: '', album_id: null })
  const response = await update(new NextRequest('http://lumbre.test/api/travel-visits', {
    method: 'POST', body: JSON.stringify({ action: 'append_journal', id: visit.id, author: 'star', content: '小火写下第一段。' }),
  }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).entry.author, 'fire')

  const written = JSON.parse(await runtime.executeRegisteredToolHandler('write_travel_journal', { visit_id: visit.id, author: 'fire', content: '星星接着写。' }))
  assert.equal(written.entry.author, 'star')
  const read = JSON.parse(await runtime.executeRegisteredToolHandler('read_travel_journal', { visit_id: visit.id }))
  assert.deepEqual(read[0].journal.map((entry: { author: string }) => entry.author), ['fire', 'star'])
})
after(() => rmSync(root, { recursive: true, force: true }))

test('travel visits keep repeat trips and filter solo from shared places', () => {
  const base = { place_id: 'relation:1', place_name: '马德里', address: 'Madrid, España', lat: 40.4168, lon: -3.7038, end_date: null, companion_name: '', note: '', album_id: null }
  const first = store.saveTravelVisit({ ...base, start_date: '2025-05-01', companion: 'solo' })
  store.saveTravelVisit({ ...base, start_date: '2026-05-01', companion: 'star' })

  const visits = store.listTravelVisits().filter(visit => visit.place_id === base.place_id)
  assert.equal(visits.length, 2)
  assert.equal(groupTravelVisits(visits, 'all')[0].visits.length, 2)
  assert.equal(groupTravelVisits(visits, 'solo')[0].visits[0].id, first.id)
  assert.equal(groupTravelVisits(visits, 'star')[0].visits[0].companion, 'star')
  assert.deepEqual(projectTravelPoint(0, 0), { x: 50, y: 50 })
  assert.throws(() => store.saveTravelVisit({ ...base, start_date: '2026-06-02', end_date: '2026-06-01', companion: 'solo' }), /结束日期/)
  assert.throws(() => store.saveTravelVisit({ ...base, start_date: '2026-06-02', companion: 'other' }), /同行人的名字/)
  assert.equal(store.deleteTravelVisit(first.id), true)
})

test('place search is explicit, attributed, cached, and bounded', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls++
    assert.match(String((init?.headers as Record<string, string>)?.['User-Agent']), /Lumbre-Private-Travel-Map/)
    return new Response(JSON.stringify([{ osm_type: 'relation', osm_id: 5326784, lat: '40.4168', lon: '-3.7038', display_name: '马德里, 马德里自治区, 西班牙' }]), { status: 200 })
  }) as typeof fetch
  try {
    const first = await search(new NextRequest('http://lumbre.test/api/travel-visits/search?q=Madrid'))
    const second = await search(new NextRequest('http://lumbre.test/api/travel-visits/search?q=Madrid'))
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(calls, 1)
    assert.equal((await second.json()).cached, true)
  } finally { globalThis.fetch = originalFetch }
})
