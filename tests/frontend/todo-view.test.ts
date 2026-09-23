import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../src/components/todo/TodoView.tsx', import.meta.url), 'utf8')

test('todo mutations update the loaded receipt without refetching it', () => {
  const mutations = source.slice(source.indexOf('const addItem'), source.indexOf('const shareReceipt'))
    + source.slice(source.indexOf('const addComment'), source.indexOf('return ('))
  assert.doesNotMatch(mutations, /load\(viewDate\)/)
  assert.match(mutations, /setDay\(/)
  assert.match(source, /className="opacity-0 group-hover:opacity-40 hover:opacity-100 focus:opacity-100 transition"/)
})
