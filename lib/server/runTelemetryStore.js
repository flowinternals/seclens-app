import { advisoryStatusRequiresReasonCode } from '../shared/advisoryContract.js'
import { getFirebaseAdminDb } from './firebaseAdmin.js'

const RUNS_COLLECTION = 'runs'

/** Strip large user-report-sized blobs from telemetry persisted under runs/{runId} (addendum: no full report archive). */
function sanitizeTelemetryForFirestore(value, maxString = 14000, depth = 0) {
  if (depth > 14) return null
  if (value == null) return value
  if (typeof value === 'string') {
    return value.length > maxString ? `${value.slice(0, maxString)}...[truncated]` : value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((entry) => sanitizeTelemetryForFirestore(entry, maxString, depth + 1))
  }
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'report' || key === 'markdownReport' || key === 'fullReport') continue
    out[key] = sanitizeTelemetryForFirestore(child, maxString, depth + 1)
  }
  return out
}

/** Persist dimension dashboard for admin post-mortem; truncate long strings to stay under Firestore doc limits. */
function sanitizeDashboardForFirestore(value, maxString = 14000, depth = 0) {
  if (depth > 14) return null
  if (value == null) return value
  if (typeof value === 'string') {
    return value.length > maxString ? `${value.slice(0, maxString)}...[truncated]` : value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((entry) => sanitizeDashboardForFirestore(entry, maxString, depth + 1))
  }
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'report' || key === 'markdownReport' || key === 'fullReport') continue
    out[key] = sanitizeDashboardForFirestore(child, maxString, depth + 1)
  }
  return out
}

const RUN_REASON_CODE_FALLBACK = {
  WARNING: 'RUN_WARNING',
  FAILED: 'RUN_FAILED',
  SKIPPED: 'RUN_SKIPPED',
}

function nowIso() {
  return new Date().toISOString()
}

function toNonEmptyString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeRunStatus(status) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'SUCCESS' || normalized === 'WARNING' || normalized === 'FAILED' || normalized === 'SKIPPED') {
    return normalized
  }
  return 'RUNNING'
}

export function ensureReasonCodeForStatus(status, reasonCode = null) {
  const runStatus = normalizeRunStatus(status)
  const candidate = toNonEmptyString(reasonCode)
  if (!advisoryStatusRequiresReasonCode(runStatus)) {
    return null
  }
  return candidate || RUN_REASON_CODE_FALLBACK[runStatus] || 'RUN_STATUS_REASON_REQUIRED'
}

export function mapJobStatusToRunStatus(jobStatus) {
  const status = String(jobStatus || '').toLowerCase()
  if (status === 'completed') return 'SUCCESS'
  if (status === 'failed') return 'FAILED'
  return 'RUNNING'
}

export function buildRunTelemetryPatch({
  status,
  reasonCode = null,
  repository = null,
  warnings = null,
  errors = null,
  fileSelectionSummary = null,
  dimensionSummary = null,
  modelUsageSummary = null,
  runState = null,
  startedAt = null,
  completedAt = null,
  requestedAnalysisModel = null,
  analysisModel = null,
  correlationId = null,
  triggeredBy = null,
  telemetryLogEntry = null,
  /** Full scan telemetry (lifecycle + dashboard) for post-mortem and admin drill-down. */
  telemetry = null,
  /** Completed dashboard (dimensions, summaries) for advisory replay - sanitized on write. */
  dashboard = null,
} = {}) {
  const runStatus = normalizeRunStatus(status)
  const patch = {
    status: runStatus,
    reasonCode: ensureReasonCodeForStatus(runStatus, reasonCode),
    updatedAt: nowIso(),
    runState: toNonEmptyString(runState),
    correlationId: toNonEmptyString(correlationId),
    requestedAnalysisModel: toNonEmptyString(requestedAnalysisModel),
    analysisModel: toNonEmptyString(analysisModel),
  }

  if (repository && typeof repository === 'object') patch.repository = repository
  if (Array.isArray(warnings)) patch.warnings = warnings
  if (Array.isArray(errors)) patch.errors = errors
  if (fileSelectionSummary && typeof fileSelectionSummary === 'object') patch.fileSelectionSummary = fileSelectionSummary
  if (dimensionSummary && typeof dimensionSummary === 'object') patch.dimensionSummary = dimensionSummary
  if (modelUsageSummary && typeof modelUsageSummary === 'object') patch.modelUsageSummary = modelUsageSummary
  if (triggeredBy && typeof triggeredBy === 'object') patch.triggeredBy = triggeredBy
  if (telemetryLogEntry && typeof telemetryLogEntry === 'object') patch.telemetryLogEntry = telemetryLogEntry
  if (telemetry && typeof telemetry === 'object') patch.telemetry = telemetry
  if (dashboard && typeof dashboard === 'object') patch.dashboard = dashboard
  if (toNonEmptyString(startedAt)) patch.startedAt = startedAt
  if (toNonEmptyString(completedAt)) patch.completedAt = completedAt
  return patch
}

function getRunsCollection() {
  const db = getFirebaseAdminDb()
  if (!db) return null
  return db.collection(RUNS_COLLECTION)
}

export async function upsertRunTelemetry(runId, patch) {
  const trimmedRunId = toNonEmptyString(runId)
  if (!trimmedRunId) return false
  const collection = getRunsCollection()
  if (!collection) return false

  const safePatch = { ...patch }
  if (safePatch.telemetry && typeof safePatch.telemetry === 'object') {
    safePatch.telemetry = sanitizeTelemetryForFirestore(safePatch.telemetry)
  }
  if (safePatch.dashboard && typeof safePatch.dashboard === 'object') {
    safePatch.dashboard = sanitizeDashboardForFirestore(safePatch.dashboard)
  }

  await collection.doc(trimmedRunId).set(
    {
      runId: trimmedRunId,
      ...safePatch,
    },
    { merge: true }
  )
  return true
}

export async function createRunOnStart({
  runId,
  repository,
  requestedAnalysisModel = null,
  analysisModel = null,
  correlationId = null,
  triggeredBy = null,
} = {}) {
  const now = nowIso()
  const patch = buildRunTelemetryPatch({
    status: 'RUNNING',
    repository,
    warnings: [],
    errors: [],
    startedAt: now,
    requestedAnalysisModel,
    analysisModel,
    correlationId,
    triggeredBy,
  })
  patch.createdAt = now
  return upsertRunTelemetry(runId, patch)
}

export async function listRecentRuns(limit = 50) {
  const max = Number.isFinite(limit) ? Math.max(1, Math.min(200, Number(limit))) : 50
  const collection = getRunsCollection()
  if (!collection) return []

  try {
    const snapshot = await collection.orderBy('updatedAt', 'desc').limit(max).get()
    return snapshot.docs.map((doc) => ({ runId: doc.id, ...doc.data() }))
  } catch {
    const snapshot = await collection.limit(max).get()
    return snapshot.docs
      .map((doc) => ({ runId: doc.id, ...doc.data() }))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
  }
}

export async function getRunById(runId) {
  const trimmedRunId = toNonEmptyString(runId)
  if (!trimmedRunId) return null
  const collection = getRunsCollection()
  if (!collection) return null
  const doc = await collection.doc(trimmedRunId).get()
  if (!doc.exists) return null
  return { runId: doc.id, ...doc.data() }
}

/**
 * Remove run document from Firestore (admin cleanup).
 * @returns {{ deleted: boolean, reason?: string }}
 */
export async function deleteRunById(runId) {
  const trimmedRunId = toNonEmptyString(runId)
  if (!trimmedRunId) return { deleted: false, reason: 'invalid_id' }
  const collection = getRunsCollection()
  if (!collection) return { deleted: false, reason: 'no_db' }
  const ref = collection.doc(trimmedRunId)
  const snap = await ref.get()
  if (!snap.exists) return { deleted: false, reason: 'not_found' }
  await ref.delete()
  return { deleted: true }
}
