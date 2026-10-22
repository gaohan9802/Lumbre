import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-fire-dictionary-'))
process.env.DATA_DIR = root

let store: typeof import('../../src/server/fire-dictionary-store')
before(async () => { store = await import('../../src/server/fire-dictionary-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('dictionary creates, sorts, searches, updates and permanently deletes entries', () => {
  const fire = store.createFireDictionaryEntry('fire', {
    word: '窝里横', pinyin: 'wō lǐ hèng', definition: '只敢在家里横。', phrases: ['小窝里横'], examples: ['今天又窝里横了。'],
  })
  const star = store.createFireDictionaryEntry('star', {
    word: '抱抱税', pinyin: 'bào bào shuì', definition: '见面先交一个抱抱。', examples: ['回家要交抱抱税。'],
  })

  assert.deepEqual((store.readFireDictionary() as any[]).map(entry => entry.id), [star.id, fire.id])
  assert.equal((store.readFireDictionary({ query: '抱抱税' }) as any[])[0].id, star.id)
  assert.equal((store.readFireDictionary({ query: 'bao bao' }) as any[])[0].id, star.id)
  assert.equal((store.readFireDictionary({ query: '小窝' }) as any[])[0].id, fire.id)
  assert.equal((store.readFireDictionary({ letter: 'W' }) as any[])[0].id, fire.id)
  assert.equal((store.readFireDictionary({ entryId: fire.id }) as any).word, '窝里横')

  const updated = store.updateFireDictionaryEntry('star', fire.id, { definition: '在自己家里格外有底气。', examples: ['这是新的例句。'] })
  assert.equal(updated.updated_by, 'star')
  assert.equal(updated.definition, '在自己家里格外有底气。')
  assert.equal(updated.examples[0].author, 'star')

  assert.throws(() => store.createFireDictionaryEntry('fire', {
    word: '窝里横', pinyin: 'wo li heng', definition: '重复。', examples: ['重复例句。'],
  }), /已经在小火辞典/)
  assert.throws(() => store.updateFireDictionaryEntry('fire', fire.id, { examples: [] }), /至少需要一个例句/)

  store.deleteFireDictionaryEntry(star.id)
  assert.equal(store.readFireDictionary({ entryId: star.id }), null)
  assert.equal((store.readFireDictionary() as any[]).length, 1)
})
