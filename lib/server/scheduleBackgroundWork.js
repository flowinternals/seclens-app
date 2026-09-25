import { waitUntil } from '@vercel/functions'

/**
 * Schedule work that may outlive the HTTP response (DEFECT-MVP5-001).
 * Uses Vercel waitUntil when the runtime supports it; otherwise detaches safely.
 *
 * @param {Promise<unknown>|(() => Promise<unknown>)} work
 */
export function scheduleBackgroundWork(work) {
  const run = typeof work === 'function' ? work() : work
  const tracked = Promise.resolve(run).catch((err) => {
    console.warn(
      '[background-work] unhandled rejection:',
      err instanceof Error ? err.message : String(err)
    )
  })

  try {
    if (typeof waitUntil === 'function') {
      waitUntil(tracked)
      return tracked
    }
  } catch {
    // Non-Vercel runtimes may throw; fall through to detached promise.
  }

  void tracked
  return tracked
}
