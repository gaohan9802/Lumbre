import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateListPrice } from '../../src/components/chat/MessageReceiptDialog'
import { addToolResultsToAudit, createMessageRequestAudit, measureReceiptText } from '../../src/lib/chat-receipt'

test('message receipt keeps UTF-8 content sections separate and totals them', () => {
  const audit = createMessageRequestAudit({
    system: '星星',
    messages: [{ role: 'user', content: '你好' }],
    tools: [{ name: 'pulse' }],
    volatileContext: '马德里',
    hints: { summary: measureReceiptText('摘要'), currentContext: measureReceiptText('纸条') },
  })
  const withTools = addToolResultsToAudit(audit, [{ name: 'pulse', result: '正常' }])

  assert.deepEqual(measureReceiptText('星星'), { chars: 2, bytes: 6 })
  assert.equal(withTools.total.chars, Object.values(withTools).slice(0, 6).reduce((sum, metric) => sum + metric.chars, 0))
  assert.ok(withTools.toolDefinitions.bytes > 2)
  assert.ok(withTools.toolResults.bytes > 2)
})

test('CC receipt uses the official Opus 4.6 one-hour cache list price', () => {
  const value = estimateListPrice({ apiProfiles: [] } as any, {
    route: 'claude-code', modelId: 'claude-opus-4-6',
    input_tokens: 3, output_tokens: 556,
    cache_read_tokens: 36_436, cache_creation_tokens: 9_281,
  } as any)

  assert.equal(value, 0.124943)
})
