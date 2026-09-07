let activeApiGenerations = 0

// ponytail: process-local is enough for the single Next service; use a shared
// lease only if Lumbre later runs more than one application replica.
export function beginApiGeneration() {
  activeApiGenerations++
  let finished = false
  return () => {
    if (finished) return
    finished = true
    activeApiGenerations = Math.max(0, activeApiGenerations - 1)
  }
}

export function isApiGenerationBusy() {
  return activeApiGenerations > 0
}
