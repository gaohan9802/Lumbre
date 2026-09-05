import assert from 'node:assert/strict'
import test from 'node:test'
import { splitReplyText, segmentReplyBlocks, mergeConversationMode, replyTokenLimit, replyModePrompt } from '../../src/lib/chat-reply-mode'
import { normalizeSettings } from '../../src/features/chat/migrations/browser-state'
import { snapshotOfMessage } from '../../src/features/chat/sessions/messages'
import { bubbleAppearance } from '../../src/features/chat/settings/appearance'
import { DEFAULT_APPEARANCE } from '../../src/features/chat/state/defaults'

test('short reply segments survive every transport boundary without exposing a delimiter', () => {
  const source = '我在呀。\n<!--split-->\n今天过得怎么样？'
  for (let i = 0; i <= source.length; i++) {
    const shown = splitReplyText(source.slice(0, i), true).join('\n')
    assert.doesNotMatch(shown, /<|split|-->/)
  }
  assert.deepEqual(splitReplyText(source), ['我在呀。', '今天过得怎么样？'])
  assert.deepEqual(splitReplyText('一句就够。'), ['一句就够。'])
})

test('segments preserve code, links and tool/thinking order', () => {
  const code = '```html\n<!--split-->\n```\n[链接](https://example.com/a.b)'
  assert.deepEqual(splitReplyText(code), [code])
  const blocks: any[] = [{ type: 'thinking', content: 'keep <!--split-->' }, { type: 'text', content: '一\n<!--split-->\n二' }, { type: 'tool_call', name: 'read', result: '<!--split-->' }, { type: 'text', content: code }]
  assert.deepEqual(segmentReplyBlocks(blocks, 'short').map(b => b.type), ['thinking', 'text', 'text', 'tool_call', 'text'])
  assert.deepEqual(segmentReplyBlocks(blocks, 'long'), blocks)
  assert.equal(segmentReplyBlocks(blocks, 'short')[0].content, blocks[0].content)
})

test('old settings keep long mode and custom appearance; stale sessions cannot erase a mode change', () => {
  const settings = normalizeSettings({ sessions: [{ id: 'a', messages: [], conversationMode: 'short', conversationModeUpdatedAt: 50 }], appearance: { userBubbleColor: '#123456' } })
  assert.equal(settings.sessions[0].conversationMode, 'short')
  assert.equal(normalizeSettings({}).sessions[0].conversationMode || 'long', 'long')
  assert.equal(settings.appearance.userBubbleColor, '#123456')
  assert.deepEqual(mergeConversationMode(settings.sessions[0], { updatedAt: 100 }), { conversationMode: 'short', conversationModeUpdatedAt: 50 })
  assert.equal(mergeConversationMode(settings.sessions[0], { conversationMode: 'long', conversationModeUpdatedAt: 51 }).conversationMode, 'long')
})

test('reply snapshots retain bubble layout and mode; budgets leave room for thinking', () => {
  const snap = snapshotOfMessage({ id: 'm', role: 'assistant', content: '一。二。', timestamp: 1, replyMode: 'short', content_blocks: [{ type: 'text', content: '一。二。' }], bubbleLayout: { version: 2, segments: [{ blockIndex: 0, start: 0, end: 2, kind: 'text' }, { blockIndex: 0, start: 2, end: 4, kind: 'text' }] } })
  assert.equal(snap.replyMode, 'short')
  assert.equal(snap.content_blocks?.length, 1)
  assert.equal(snap.bubbleLayout?.segments.length, 2)
  assert.ok(replyTokenLimit('short', 8000) > 8000)
  assert.ok(replyTokenLimit('short', 8000) < replyTokenLimit('long', 8000))
  assert.match(replyModePrompt('short'), /短聊模式/)
  assert.doesNotMatch(replyModePrompt('short'), /<!--split-->/)
  assert.doesNotMatch(replyModePrompt('long'), /<!--split-->/)
})

test('frosted switch and opacity apply even without custom colors', () => {
  const ap = { ...DEFAULT_APPEARANCE, userBubbleOpacity: .5, userBubbleFrosted: false, userBubbleBlur: 12 }
  assert.equal(bubbleAppearance(ap, 'user', false).backdropFilter, 'none')
  assert.match(String(bubbleAppearance(ap, 'user', false).backgroundColor), /0.5/)
  assert.equal(bubbleAppearance({ ...ap, userBubbleFrosted: true }, 'user', false).backdropFilter, 'blur(12px)')
  assert.equal(bubbleAppearance(ap, 'user', true).backdropFilter, 'blur(2px)')
})

test('mode persists through store settings, continuation, stale sync and version switches', async () => {
  const { useChatStore } = await import('../../src/lib/chatStore')
  const original = useChatStore.getState()
  try {
    const id = useChatStore.getState().createSession()
    useChatStore.getState().setConversationMode(id, 'short')
    useChatStore.getState().addMessage({ id: 'seg', role: 'assistant', content: '一。二。', timestamp: 1, replyMode: 'short', content_blocks: [{ type: 'text', content: '一。二。' }], bubbleLayout: { version: 2, segments: [{ blockIndex: 0, start: 0, end: 2, kind: 'text' }, { blockIndex: 0, start: 2, end: 4, kind: 'text' }] } })
    const current = useChatStore.getState().settings.sessions.find(s => s.id === id)!
    const normalized = normalizeSettings(useChatStore.getState().settings)
    assert.equal(normalized.sessions.find(s => s.id === id)?.conversationMode, 'short')
    const continued = useChatStore.getState().continueSession(50)
    assert.equal(useChatStore.getState().settings.sessions.find(s => s.id === continued)?.conversationMode, 'short')
    useChatStore.getState().setActiveSession(id)
    useChatStore.getState().mergeRemote([{ ...current, updatedAt: Date.now() + 20, conversationMode: undefined, conversationModeUpdatedAt: undefined }], {})
    assert.equal(useChatStore.getState().settings.sessions.find(s => s.id === id)?.conversationMode, 'short')
    useChatStore.getState().addMessageVersion('seg', { content: '长段落', timestamp: 2, replyMode: 'long' })
    assert.equal(useChatStore.getState().messages[0].content_blocks, undefined)
    assert.equal(useChatStore.getState().messages[0].bubbleLayout, undefined)
    useChatStore.getState().switchMessageVersion('seg', 0)
    assert.equal(useChatStore.getState().messages[0].content_blocks?.length, 1)
    assert.equal(useChatStore.getState().messages[0].bubbleLayout?.segments.length, 2)
    useChatStore.getState().switchMessageVersion('seg', 1)
    assert.equal(useChatStore.getState().messages[0].content_blocks, undefined)
    assert.equal(useChatStore.getState().messages[0].replyMode, 'long')
    useChatStore.getState().setActiveSession(continued)
    useChatStore.getState().addMessage({ id: 'late', role: 'assistant', content: '属于旧窗口', timestamp: 3 }, id)
    assert.equal(useChatStore.getState().messages.some(m => m.id === 'late'), false)
    assert.equal(useChatStore.getState().settings.sessions.find(s => s.id === id)?.messages.at(-1)?.id, 'late')
  } finally { useChatStore.setState(original) }
})
