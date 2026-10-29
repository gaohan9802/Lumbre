import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { isRecoverableChatDisconnect, mergeConversationRoute, normalizeChatRoute } from '../../src/lib/chat-route'
import { normalizeSettings } from '../../src/features/chat/migrations/browser-state'
import { snapshotOfMessage } from '../../src/features/chat/sessions/messages'
import { ccEffortsForModel, isCcModel, mergeCcModel, normalizeCcEffortForModel } from '../../src/lib/cc-model'
import { chatMessageContentForModel, isSupportedChatFile } from '../../src/lib/chat-message-sync'
import { ccContextLevel, mergeCcContextState, mergeChatWindowConfig, normalizeCcContextState, normalizeChatWindowConfig } from '../../src/lib/chat-window-config'
import { STICKERS } from '../../src/lib/stickers'

test('old conversations and message versions normalize to the API route', () => {
  const settings = normalizeSettings({
    activeSessionId: 'old',
    sessions: [{
      id: 'old', title: 'old', pinned: false, createdAt: 1, updatedAt: 2,
      messages: [{
        id: 'm', role: 'assistant', content: 'old reply', timestamp: 2,
        versions: [{ content: 'older reply', timestamp: 1 }],
      }],
    }],
  })

  assert.equal(settings.sessions[0].generationRoute, 'api')
  assert.equal(settings.sessions[0].messages[0].route, 'api')
  assert.equal(settings.sessions[0].messages[0].versions?.[0].route, 'api')
  assert.equal(normalizeChatRoute('not-a-route'), 'api')
})

test('a newer route selection wins independently from a newer message snapshot', () => {
  const selected = { generationRoute: 'claude-code', generationRouteUpdatedAt: 50 }
  assert.deepEqual(mergeConversationRoute(selected, { updatedAt: 100 }), selected)
  assert.deepEqual(
    mergeConversationRoute(selected, { generationRoute: 'api', generationRouteUpdatedAt: 51 }),
    { generationRoute: 'api', generationRouteUpdatedAt: 51 },
  )
})

test('a newer CC model selection wins independently from a newer message snapshot', () => {
  const selected = { ccModel: 'claude-opus-4-6', ccModelUpdatedAt: 50 }
  assert.deepEqual(mergeCcModel(selected, { updatedAt: 100 }), selected)
  assert.deepEqual(
    mergeCcModel(selected, { ccModel: 'claude-opus-5-5', ccModelUpdatedAt: 51 }),
    { ccModel: 'claude-opus-5-5', ccModelUpdatedAt: 51 },
  )
})

test('window settings merge as one timestamped unit', () => {
  const selected = { windowConfig: { systemPrompt: '本窗', apiProfileId: 'p1', apiModelId: 'm1', ccEffort: 'max' }, windowConfigUpdatedAt: 50 }
  assert.deepEqual(mergeChatWindowConfig(selected, { updatedAt: 100 }), {
    windowConfig: selected.windowConfig,
    windowConfigUpdatedAt: 50,
  })
  assert.deepEqual(mergeChatWindowConfig(selected, { windowConfig: { apiProfileId: 'p2', apiModelId: 'm2' }, windowConfigUpdatedAt: 51 }), {
    windowConfig: { apiProfileId: 'p2', apiModelId: 'm2', systemPrompt: undefined, ccEffort: undefined },
    windowConfigUpdatedAt: 51,
  })
})

test('context warnings use fixed thresholds and retain one safe compaction receipt', () => {
  assert.equal(ccContextLevel(69.9), 0)
  assert.equal(ccContextLevel(70), 70)
  assert.equal(ccContextLevel(85), 85)
  assert.equal(ccContextLevel(95), 95)
  assert.deepEqual(normalizeCcContextState({
    ccContextWarningLevel: 95,
    lastCcCompaction: { at: 123, source: 'manual', beforeTokens: 121_000, afterTokens: 38_000 },
  }), {
    warningLevel: 95,
    lastCompaction: { at: 123, source: 'manual', beforeTokens: 121_000, afterTokens: 38_000 },
  })
  assert.equal(normalizeChatWindowConfig({ ccContextWarningLevel: 95 }), undefined)
  assert.deepEqual(mergeCcContextState(
    { ccContextState: { warningLevel: 85 }, ccContextStateUpdatedAt: 51 },
    { windowConfig: { systemPrompt: '更新后的 SP' }, windowConfigUpdatedAt: 100 },
  ), { ccContextState: { warningLevel: 85, lastCompaction: undefined }, ccContextStateUpdatedAt: 51 })
})

test('CC exposes current model families and only sends supported effort levels', () => {
  assert.equal(isCcModel('claude-fable-5-1'), true)
  assert.equal(isCcModel('claude-sonnet-5'), true)
  assert.equal(isCcModel('claude-haiku-4-5-20251001'), true)
  assert.equal(ccEffortsForModel('claude-opus-5-5').includes('xhigh'), true)
  assert.equal(normalizeCcEffortForModel('claude-opus-4-6', 'xhigh'), 'high')
  assert.equal(normalizeCcEffortForModel('claude-haiku-4-5-20251001', 'high'), undefined)
})

test('an iOS Load failed keeps only CC turns recoverable', () => {
  assert.equal(isRecoverableChatDisconnect('claude-code', false, 'TypeError'), true)
  assert.equal(isRecoverableChatDisconnect('api', false, 'TypeError'), false)
  assert.equal(isRecoverableChatDisconnect('claude-code', true, 'AbortError'), false)
})

test('text files become stable model context without changing chat routing', () => {
  const message = {
    content: '看看这个',
    attachments: [{ name: 'notes.md', type: 'text/markdown', size: 12, text: '# 星星\n你好' }],
  }
  const content = chatMessageContentForModel(message)
  assert.equal(content, chatMessageContentForModel(message))
  assert.match(content, /\[文件：notes\.md｜text\/markdown\]/)
  assert.match(content, /# 星星\n你好/)
  assert.equal(isSupportedChatFile('notes.md', ''), true)
  assert.equal(isSupportedChatFile('archive.zip', 'application/zip'), false)
})

test('Sticker messages persist as compact semantic context instead of artwork', () => {
  assert.equal(chatMessageContentForModel({ content: '来抱抱', sticker: { id: 'duo-hug' } }), '来抱抱\n[表情包：抱抱]')
  assert.equal(chatMessageContentForModel({
    content: '',
    tool_calls: [{ name: 'send_sticker', input: { sticker_id: 'duo-sleeping', entrance: 'visit' }, result: '{"ok":true}' }],
  }), '\n[表情包：睡觉]')
  const normalized = normalizeSettings({
    activeSessionId: 'stickers',
    sessions: [{
      id: 'stickers', title: 'stickers', pinned: false, createdAt: 1, updatedAt: 1,
      messages: [{ id: 'm', role: 'user', route: 'api', content: '', timestamp: 1, sticker: { id: 'duo-kiss-nose', entrance: 'message' } }],
    }],
  })
  assert.deepEqual(normalized.sessions[0].messages[0].sticker, { id: 'duo-kiss-nose', entrance: 'message' })
})

test('sticker catalog has unique ids and both lightweight and original artwork', () => {
  assert.equal(STICKERS.length, 46)
  assert.equal(new Set(STICKERS.map(item => item.id)).size, STICKERS.length)
  assert.equal(STICKERS.find(item => item.id === 'duo-selfie')?.label, '自拍')
  assert.equal(STICKERS.find(item => item.id === 'duo-face-mask')?.label, '敷面膜')
  for (const item of STICKERS) {
    assert.equal(existsSync(path.join(process.cwd(), 'public', item.asset.replace(/^\//, ''))), true, item.asset)
    assert.equal(existsSync(path.join(process.cwd(), 'public', item.original.replace(/^\//, ''))), true, item.original)
  }
})

test('route persists through store continuation, stale sync and message versions', async () => {
  const { useChatStore } = await import('../../src/lib/chatStore')
  const original = useChatStore.getState()
  try {
    const id = useChatStore.getState().createSession()
    useChatStore.getState().setGenerationRoute(id, 'claude-code')
    useChatStore.getState().setCcModel(id, 'claude-opus-5-5')
    useChatStore.getState().setWindowConfig(id, { systemPrompt: '只属于本窗', apiProfileId: 'anthropic-default', apiModelId: 'claude-sonnet-4-20250514', ccEffort: 'max' })
    useChatStore.getState().setCcContextState(id, { warningLevel: 85, lastCompaction: { at: 123, source: 'manual' } })
    useChatStore.getState().setWindowConfig(id, current => ({ ...current, apiModelId: 'claude-opus-4-20250514' }))
    useChatStore.getState().addMessage({ id: 'cc-reply', role: 'assistant', route: 'claude-code', content: 'hi', timestamp: 1 })
    const current = useChatStore.getState().settings.sessions.find(session => session.id === id)!

    const other = useChatStore.getState().createSession()
    useChatStore.getState().setGenerationRoute(other, 'api')
    const continued = useChatStore.getState().continueSession(50, id)
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === continued)?.generationRoute, 'claude-code')
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === continued)?.ccModel, 'claude-opus-5-5')
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === continued)?.windowConfig?.systemPrompt, '只属于本窗')
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === continued)?.ccContextState, undefined)
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === id)?.ccContextState?.warningLevel, 85)

    useChatStore.getState().setActiveSession(id)
    useChatStore.getState().mergeRemote([{ ...current, updatedAt: Date.now() + 20, generationRoute: undefined, generationRouteUpdatedAt: undefined }], {})
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === id)?.generationRoute, 'claude-code')
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === id)?.ccModel, 'claude-opus-5-5')
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === id)?.windowConfig?.ccEffort, 'max')

    useChatStore.getState().addMessageVersion('cc-reply', { route: 'api', content: 'api reroll', timestamp: 2 })
    assert.equal(useChatStore.getState().messages[0].route, 'api')
    useChatStore.getState().switchMessageVersion('cc-reply', 0)
    assert.equal(useChatStore.getState().messages[0].route, 'claude-code')
    assert.equal(snapshotOfMessage(useChatStore.getState().messages[0]).route, 'claude-code')
  } finally {
    useChatStore.setState(original)
  }
})
