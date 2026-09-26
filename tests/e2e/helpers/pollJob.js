/**
 * Poll scan-jobs until terminal status with backoff (design §10).
 */
export async function pollScanJobUntilTerminal({
  baseUrl,
  jobId,
  getAuthHeaders,
  fetchImpl = fetch,
  initialIntervalMs = 1500,
  maxIntervalMs = 10000,
  perRequestTimeoutMs = 30000,
  absoluteDeadlineMs = 40 * 60 * 1000,
  startedAtMs = Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let intervalMs = initialIntervalMs
  let lastPayload = null

  while (Date.now() - startedAtMs < absoluteDeadlineMs) {
    let attempt = 0
    let payload = null
    while (attempt < 3) {
      attempt += 1
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), perRequestTimeoutMs)
      try {
        const headers = {
          Accept: 'application/json',
          ...(await getAuthHeaders()),
        }
        const res = await fetchImpl(
          `${baseUrl}/api/scan-jobs?jobId=${encodeURIComponent(jobId)}`,
          { headers, signal: controller.signal }
        )
        clearTimeout(timer)
        if (res.status >= 500) {
          if (attempt >= 3) throw new Error(`scan-jobs poll 5xx: ${res.status}`)
          await sleep(500 * attempt)
          continue
        }
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`scan-jobs poll failed (${res.status}): ${text.slice(0, 200)}`)
        }
        payload = await res.json()
        break
      } catch (err) {
        clearTimeout(timer)
        const message = err instanceof Error ? err.message : String(err)
        const transient = /abort|network|fetch|5xx|ECONN/i.test(message)
        if (!transient || attempt >= 3) throw err
        await sleep(500 * attempt)
      }
    }

    lastPayload = payload
    if (!payload || payload.jobId !== jobId) {
      throw new Error('Poll payload missing or jobId mismatch')
    }

    const status = String(payload.status || '').toLowerCase()
    if (status === 'completed') {
      return { status: 'completed', payload }
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', payload }
    }

    await sleep(intervalMs)
    intervalMs = Math.min(maxIntervalMs, Math.ceil(intervalMs * 1.5))
  }

  return { status: 'timeout', payload: lastPayload }
}
