/**
 * Admin run payloads: Firestore stores telemetry summaries; in-memory scan jobs still hold the live dashboard.
 * Merge so post-mortem and GET /api/admin/runs/:id can see dimensions when the job is still resident.
 */

/**
 * @param {object | null} persistedRun
 * @param {object | null} memoryRun
 * @returns {object | null}
 */
export function mergePersistedRunWithInMemoryJob(persistedRun, memoryRun) {
  if (persistedRun && !memoryRun) return persistedRun
  if (!persistedRun && memoryRun) return memoryRun
  if (!persistedRun && !memoryRun) return null

  const out = { ...persistedRun }
  const memDash = memoryRun.dashboard && typeof memoryRun.dashboard === 'object' ? memoryRun.dashboard : null
  const memHasDims = Array.isArray(memDash?.dimensions) && memDash.dimensions.length > 0
  const persistedDash = out.dashboard && typeof out.dashboard === 'object' ? out.dashboard : null
  const persistedHasDims = Array.isArray(persistedDash?.dimensions) && persistedDash.dimensions.length > 0

  if (memHasDims && !persistedHasDims) {
    out.dashboard = memDash
  }

  if (out.report == null && typeof memoryRun.report === 'string') {
    out.report = memoryRun.report
  }
  if (out.reportValidation == null && memoryRun.reportValidation && typeof memoryRun.reportValidation === 'object') {
    out.reportValidation = memoryRun.reportValidation
  }

  return out
}
