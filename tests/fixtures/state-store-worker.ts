async function main(): Promise<void> {
  const [store, countText, workerId] = process.argv.slice(2)
  const count = Number(countText)

  if (store === 'wish') {
    const { addWish } = await import('../../src/server/wish-store')
    for (let i = 0; i < count; i += 1) addWish('fire', `${workerId}-${i}`)
  } else if (store === 'thesis') {
    const { addChapter } = await import('../../src/server/thesis-store')
    for (let i = 0; i < count; i += 1) addChapter(`${workerId}-${i}`, 10)
  } else if (store === 'usage') {
    const { recordUsage } = await import('../../src/server/usage')
    for (let i = 0; i < count; i += 1) recordUsage(10, 5, 'fixture', workerId)
  } else if (store === 'timeline') {
    const { startActivity } = await import('../../src/server/timeline-store')
    startActivity(`activity-${workerId}`, ['test'], undefined, '2026-09-03T10:00:00+02:00')
  } else {
    throw new Error(`Unknown state store: ${store}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
