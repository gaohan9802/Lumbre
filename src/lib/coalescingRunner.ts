/**
 * Run an async task serially while coalescing duplicate requests.
 *
 * A request that arrives during an active task guarantees one follow-up pass.
 * This is useful for state sync: the active pass may already have captured an
 * older snapshot, so merely returning its promise would leave the newer state
 * local-only until another unrelated timer fires.
 */
export function createCoalescingRunner(task: () => Promise<void>) {
  let inFlight: Promise<void> | null = null
  let requested = false

  return function run(): Promise<void> {
    requested = true
    if (inFlight) return inFlight

    inFlight = (async () => {
      while (requested) {
        requested = false
        await task()
      }
    })().finally(() => {
      inFlight = null
    })

    return inFlight
  }
}
