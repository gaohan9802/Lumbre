/**
 * Server boot hook. Runs once when the Next.js server process starts.
 * Restarts the auto-wake engine after every redeploy so 心跳唤醒 keeps
 * running without needing the user to re-toggle it in the UI.
 *
 * The `=== 'nodejs'` guard lets Next dead-code-eliminate the node-only
 * import (fs/path) from the edge instrumentation bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startWakeEngine, loadWakeConfig } = await import('@/server/autowake')
      // Engine's internal shouldWakeNow() re-checks config.enabled each tick,
      // so it is safe to always start it; it just idles while disabled.
      startWakeEngine()
      const cfg = loadWakeConfig()
      console.log('[instrumentation] wake engine started, enabled=', cfg.enabled)
    } catch (err) {
      console.error('[instrumentation] failed to start wake engine', err)
    }
  }
}
