import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

import { DataPathError } from '../../src/server/data/errors'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-todo-repository-'))
process.env.DATA_DIR = root
let todo: typeof import('../../src/server/todo-store')

before(async () => { todo = await import('../../src/server/todo-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('todo repository preserves existing JSON layout and behavior', () => {
  const item = todo.addTodo('repository fixture', 'fire', '2026-09-03')
  assert.equal(todo.toggleTodo(item.id, '2026-09-03'), 'ok')
  assert.equal(todo.editTodo(item.id, 'repository fixture updated', '2026-09-03'), 'ok')
  const file = path.join(root, 'todos', '2026-09-03.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(saved.date, '2026-09-03')
  assert.equal(saved.items[0].text, 'repository fixture updated')
  assert.equal(saved.items[0].done, true)
})

test('todo repository rejects unsafe and impossible client-supplied paths', () => {
  for (const date of ['../secret', '2026-02-30', '/persistent/config.json']) {
    assert.throws(() => todo.getTodos(date), DataPathError)
  }
  assert.throws(() => todo.toggleTodo('../secret', '2026-09-03'), DataPathError)
  assert.equal(todo.toggleTodo('missing-id', '2026-09-05'), 'not_found')
  assert.equal(existsSync(path.join(root, 'todos', '2026-09-05.json')), false)
})

test('a corrupt todo file does not break reads and is backed up before recovery', () => {
  const directory = path.join(root, 'todos')
  const fixtureDate = '2042-09-04'
  const file = path.join(directory, `${fixtureDate}.json`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(file, '{broken todo json', 'utf8')

  assert.deepEqual(todo.getTodos(fixtureDate), { date: fixtureDate, items: [], rolledForwardAt: undefined })
  todo.addTodo('recover safely', 'fire', fixtureDate)
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken todo json')
  assert.equal(todo.getTodos(fixtureDate).items[0]?.text, 'recover safely')
})
