import assert from 'node:assert/strict'
import test from 'node:test'
import { newestCoreadProgress } from '../../src/lib/coread-offline'

test('offline reading progress keeps the newest real reading activity', () => {
  const earlier = { paragraph_idx: 8, offset: 12, updated_at: '2026-10-24T08:00:00.000Z' }
  const later = { paragraph_idx: 3, offset: 4, updated_at: '2026-10-24T09:00:00.000Z' }
  assert.deepEqual(newestCoreadProgress(earlier, later), later)
  assert.deepEqual(newestCoreadProgress(later, earlier), later)
  assert.deepEqual(newestCoreadProgress(undefined, earlier), earlier)
})
