import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-tool-catalog-'))
process.env.DATA_DIR = root

let catalog: typeof import('../../src/server/tool-catalog')
let registry: typeof import('../../src/server/agent/registry')
let context: typeof import('../../src/server/agent/context')

before(async () => {
  catalog = await import('../../src/server/tool-catalog')
  registry = await import('../../src/server/agent/registry')
  context = await import('../../src/server/agent/context')
})

after(() => rmSync(root, { recursive: true, force: true }))

test('toolbox lists every registered tool with model and frontend names', () => {
  const snapshot = catalog.toolCatalogSnapshot()
  assert.equal(snapshot.tools.length, registry.registeredToolCount())
  assert.equal(snapshot.tools.every(tool => tool.name && tool.description && tool.displayLabel && tool.domain && tool.risk), true)
})

test('bulk edits change the runtime description and can return to defaults', () => {
  const original = catalog.toolCatalogSnapshot().tools.find(tool => tool.name === 'read_notes')!
  let snapshot = catalog.updateToolCatalog([{
    name: 'read_notes',
    description: '只查看家里的纸条，不做修改。',
    displayLabel: '看了自定义纸条名',
  }])
  const changed = snapshot.tools.find(tool => tool.name === 'read_notes')!
  assert.equal(changed.customizedDescription, true)
  assert.equal(changed.customizedDisplayLabel, true)
  const runtime = registry.toolsForContext(context.createToolContext()).find(tool => tool.name === 'read_notes')!
  assert.equal(runtime.description, '只查看家里的纸条，不做修改。')

  snapshot = catalog.updateToolCatalog([{
    name: 'read_notes',
    description: original.defaultDescription,
    displayLabel: original.defaultDisplayLabel,
  }])
  const restored = snapshot.tools.find(tool => tool.name === 'read_notes')!
  assert.equal(restored.customizedDescription, false)
  assert.equal(restored.customizedDisplayLabel, false)
})

test('toolbox rejects unknown, duplicate and empty edits', () => {
  assert.throws(() => catalog.updateToolCatalog([{ name: 'unknown', description: 'x', displayLabel: 'x' }]), /未知/)
  assert.throws(() => catalog.updateToolCatalog([
    { name: 'read_notes', description: 'x', displayLabel: 'x' },
    { name: 'read_notes', description: 'y', displayLabel: 'y' },
  ]), /重复/)
  assert.throws(() => catalog.updateToolCatalog([{ name: 'read_notes', description: '', displayLabel: 'x' }]), /不能为空/)
})
