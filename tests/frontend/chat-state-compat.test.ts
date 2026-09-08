import assert from 'node:assert/strict'
import test from 'node:test'

test('legacy browser chat state upgrades without losing messages, summaries, bookmarks, or settings', async () => {
  const store = await import('../../src/lib/chatStore')
  const migrate = store.useChatStore.persist.getOptions().migrate!
  const migrated: any = await migrate({
    settings: {
      systemPrompt: 'legacy prompt', contextLength: 88, model: 'legacy-model',
      activeProfileId: 'legacy-profile',
      apiProfiles: [{
        id: 'legacy-profile', name: 'Legacy', provider: 'anthropic',
        defaultModel: 'legacy-model', models: [{ id: 'legacy-model', enabled: true }],
        baseUrl: 'https://legacy.example/private', apiKey: 'legacy-secret',
      }],
      activeSessionId: 'legacy-session',
      sessions: [{
        id: 'legacy-session', title: 'legacy chat', createdAt: 1, updatedAt: 30,
        messages: [
          { id: 'm1', role: 'user', content: 'old hello', timestamp: 10 },
          { id: 'm2', role: 'assistant', content: 'old reply', timestamp: 20 },
        ],
        summaries: [{ id: 'old-summary', overview: 'old summary text', createdAt: 30 }],
      }],
      bookmarks: [{ id: 'b1', name: 'keep me', keywords: ['old'], content: 'bookmark body', position: 'start', scanDepth: 10, priority: 2, alwaysOn: false, enabled: true }],
      summaryTurnSize: 30,
    },
  }, 8)

  const json = JSON.stringify(migrated)
  assert.doesNotMatch(json, /legacy-secret|private/)
  assert.equal(migrated.settings.systemPrompt, 'legacy prompt')
  assert.equal(migrated.settings.contextLength, 88)
  assert.equal(migrated.settings.sessions[0].messages[0].content, 'old hello')
  assert.equal(migrated.settings.sessions[0].summaries[0].eventSummary, 'old summary text')
  assert.equal(migrated.settings.bookmarks[0].content, 'bookmark body')
  assert.equal(migrated.settings.summaryTurnSize, 30)
  store.completeLegacyModelCredentialMigration(['legacy-profile'])
})

test('switching sessions never sends a message into the previous conversation', async () => {
  const { useChatStore } = await import('../../src/lib/chatStore')
  const original = useChatStore.getState()
  const session = (id: string) => ({ id, title: id, pinned: false, createdAt: 1, updatedAt: 1, messages: [] })
  const settings = { ...original.settings, activeSessionId: 'a', sessions: [session('a'), session('b')] }
  useChatStore.setState({ settings, messages: [] })

  useChatStore.getState().addMessage({ id: 'a1', role: 'user', content: 'only a', timestamp: 2 })
  useChatStore.getState().setActiveSession('b')
  useChatStore.getState().addMessage({ id: 'b1', role: 'user', content: 'only b', timestamp: 3 })

  const result = useChatStore.getState().settings.sessions
  assert.deepEqual(result.find(item => item.id === 'a')?.messages.map(item => item.id), ['a1'])
  assert.deepEqual(result.find(item => item.id === 'b')?.messages.map(item => item.id), ['b1'])
  useChatStore.setState(original)
})

test('credential status refresh does not publish a phantom config change', async () => {
  const { useChatStore } = await import('../../src/lib/chatStore')
  const { applyLocalModelCredentialStatus } = await import('../../src/features/chat/sync/ChatSync')
  const original = useChatStore.getState()
  try {
    const settings = { ...original.settings, systemPrompt: 'keep me', configUpdatedAt: 123 }
    useChatStore.setState({ settings })
    applyLocalModelCredentialStatus(settings.apiProfiles.map(profile => ({ ...profile, credentialConfigured: true })))

    assert.equal(useChatStore.getState().settings.systemPrompt, 'keep me')
    assert.equal(useChatStore.getState().settings.configUpdatedAt, 123)
    assert.equal(useChatStore.getState().settings.apiProfiles[0].credentialConfigured, true)
  } finally {
    useChatStore.setState(original)
  }
})

test('browser migration keeps one bounded, secret-free recovery backup', async () => {
  const values = new Map<string, string>()
  const fakeStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })
  try {
    const store = await import('../../src/lib/chatStore')
    const { CHAT_MIGRATION_BACKUP_KEY } = await import('../../src/features/chat/state/persistence')
    const migrate = store.useChatStore.persist.getOptions().migrate!
    await migrate({ settings: {
      apiProfiles: [{ id: 'p', provider: 'anthropic', apiKey: 'must-not-survive', baseUrl: 'https://secret.invalid' }],
      messages: [{ id: 'old', role: 'user', content: 'recover me', timestamp: 1 }],
    } }, 7)
    const backup = values.get(CHAT_MIGRATION_BACKUP_KEY) || ''
    assert.match(backup, /recover me/)
    assert.match(backup, /"fromVersion":7/)
    assert.doesNotMatch(backup, /must-not-survive|secret\.invalid/)
    store.completeLegacyModelCredentialMigration(['p'])
  } finally {
    delete (globalThis as any).localStorage
  }
})

test('local persistence keeps only the active warm tail without mixing sessions', async () => {
  const store = await import('../../src/lib/chatStore')
  const state = store.useChatStore.getState()
  const activeMessages = Array.from({ length: 75 }, (_, index) => ({
    id: `active-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
    content: `active ${index}`, timestamp: index + 1,
  }))
  const otherMessages = [{ id: 'other-1', role: 'user' as const, content: 'other', timestamp: 1 }]
  const settings = {
    ...state.settings,
    activeSessionId: 'active',
    sessions: [
      { id: 'active', title: 'active', pinned: false, createdAt: 1, updatedAt: 75, messages: activeMessages },
      { id: 'other', title: 'other', pinned: false, createdAt: 1, updatedAt: 1, messages: otherMessages },
    ],
  }
  const partialize = store.useChatStore.persist.getOptions().partialize!
  const persisted: any = partialize({ ...state, settings, messages: activeMessages })

  const active = persisted.settings.sessions.find((session: any) => session.id === 'active')
  const other = persisted.settings.sessions.find((session: any) => session.id === 'other')
  assert.equal(active.messages.length, 50)
  assert.equal(active.messages[0].id, 'active-25')
  assert.equal(active.messageCount, 75)
  assert.equal(other.messages.length, 0)
  assert.equal(other.messageCount, 1)
})

test('usage estimates retain provider-specific prices', async () => {
  const { estimateMsgCost } = await import('../../src/lib/chatStore')
  const settings: any = {
    apiProfiles: [{ id: 'p1', models: [{ id: 'm1', inputPrice: 2, outputPrice: 4, cachePrice: 1 }] }],
  }
  const cost = estimateMsgCost(settings, {
    id: 'message', role: 'assistant', content: 'fixture', timestamp: 1,
    providerId: 'p1', modelId: 'm1', input_tokens: 1_000_000,
    output_tokens: 500_000, cache_read_tokens: 250_000,
  })
  assert.equal(cost, 4.25)
})

test('a paged long-session tail can still produce manual and automatic summary work', async () => {
  const { selectLoadedSessionSummarySegment } = await import('../../src/lib/chat-summary')
  const messages = Array.from({ length: 6 }, (_, index) => ({
    id: `tail-${index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `tail message ${index}`,
    timestamp: index + 100,
  }))
  const session: any = {
    id: 'long-chat', title: 'long chat', pinned: false, createdAt: 1, updatedAt: 105,
    messages, messageCount: 500, partial: true, summaries: [],
    summaryConfig: { autoEnabled: true, turnSize: 3, injectCount: 3, modeVersion: 2 },
  }

  assert.deepEqual(
    selectLoadedSessionSummarySegment(session, 20, false).map(message => message.id),
    messages.map(message => message.id),
  )
  assert.deepEqual(
    selectLoadedSessionSummarySegment(session, 20, true).map(message => message.id),
    messages.map(message => message.id),
  )
})

test('removed coupon navigation state migrates back to chat while the popup remains independent', async () => {
  const { migrateAppState } = await import('../../src/lib/store')
  const persisted = { state: { activeTab: 'coupons' } }
  assert.equal(migrateAppState(persisted).state.activeTab, 'chat')
})
