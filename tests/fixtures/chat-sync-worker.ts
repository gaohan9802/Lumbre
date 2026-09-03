export {}

async function main(): Promise<void> {
  const [sessionId, countText, workerId] = process.argv.slice(2)
  const count = Number(countText)
  const { upsertSyncSessionMessage } = await import('../../src/server/chat-sync')
  for (let i = 0; i < count; i += 1) {
    upsertSyncSessionMessage(sessionId, {
      id: `${workerId}-${i}`,
      role: 'user',
      content: `${workerId} message ${i}`,
      timestamp: Number(workerId) * 1000 + i,
    }, { title: 'concurrent fixture', createdAt: 1 })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
