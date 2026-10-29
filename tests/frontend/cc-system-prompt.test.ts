import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_OPUS_46_OUTPUT_STYLE, ccOutputStyleContext, ccSystemPromptForModel, withoutOpus55ThinkingInstructions } from '../../src/lib/cc-system-prompt'

const prompt = `一、你是谁
保持原样。

二、关于使用thinking block的指示：
输出完整真实的内在思考。
思考链里不隐瞒。

三、你的核心性格
温柔。`

test('Opus 4.6 receives the existing system prompt byte for byte', () => {
  const opus55Override = '这是另一份人设'
  assert.equal(ccSystemPromptForModel(prompt, opus55Override, 'claude-opus-4-6'), prompt)
})

test('Opus 4.6 alone receives the editable output style as volatile context', () => {
  assert.match(DEFAULT_OPUS_46_OUTPUT_STYLE, /不是考核你的规则/)
  const style = ccOutputStyleContext('claude-opus-4-6', '  温柔地完整回应  ')
  assert.match(style, /^<lumbre_output_style priority="current-turn">/)
  assert.match(style, /不要只用一句话或一个很短的段落结束/)
  assert.match(style, /温柔地完整回应/)
  assert.equal(ccOutputStyleContext('claude-opus-5-5', '不要注入'), '')
  assert.equal(ccOutputStyleContext('claude-opus-4-6', ''), '')
})

test('Opus 5.5 removes the complete thinking section and preserves surrounding persona text', () => {
  const result = ccSystemPromptForModel(prompt, undefined, 'claude-opus-5-5')
  assert.equal(result, `一、你是谁
保持原样。

三、你的核心性格
温柔。`)
  assert.doesNotMatch(result, /thinking|内在思考|思考链/i)
})

test('Opus 5.5 uses its independent prompt and still strips a pasted thinking section', () => {
  const override = prompt.replace('保持原样。', '这是 5.5 专用人设。')
  const result = ccSystemPromptForModel('4.6 原文', override, 'claude-opus-5-5')
  assert.match(result, /这是 5\.5 专用人设/)
  assert.doesNotMatch(result, /完整真实的内在思考/)
  assert.equal(withoutOpus55ThinkingInstructions('没有对应章节'), '没有对应章节')
})
