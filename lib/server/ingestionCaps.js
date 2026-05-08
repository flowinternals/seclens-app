/**
 * MVP4 Stage 02 - bounded ingestion caps (env-configurable).
 */

import { hasProAccess } from './billing.js'

/** CR6 baseline per commercialisation doc (rolling limits enforced separately). */
const PLAN_MAX_BYTES_PER_FILE = Object.freeze({
  free: 3 * 1024 * 1024,
  pro: 25 * 1024 * 1024,
})

/**
 * File-size caps depend on subscription when caller passes subscription (authenticated scans).
 * Anonymous / unknown billing uses Free-tier file cap by default.
 */
export function getPlanAwareIngestionCaps(subscription) {
  const base = getIngestionCaps()
  const tierCap = hasProAccess(subscription) ? PLAN_MAX_BYTES_PER_FILE.pro : PLAN_MAX_BYTES_PER_FILE.free
  return {
    ...base,
    maxBytesPerFile: Math.min(base.maxBytesPerFile, tierCap),
  }
}

export function getIngestionCaps() {
  const maxFiles = parseInt(process.env.SECLENS_MAX_FILES_FETCHED || '900', 10)
  const maxBytesPerFile = parseInt(process.env.SECLENS_MAX_BYTES_PER_FILE || '500000', 10)
  const maxTotalBytes = parseInt(process.env.SECLENS_MAX_TOTAL_BYTES_TO_MODEL || '12000000', 10)
  const maxTreeEntries = parseInt(process.env.SECLENS_MAX_REPO_TREE_ENTRIES || '300000', 10)

  return {
    maxFiles: Number.isFinite(maxFiles) ? Math.max(1, Math.min(maxFiles, 2500)) : 900,
    maxBytesPerFile: Number.isFinite(maxBytesPerFile) ? Math.max(256, Math.min(maxBytesPerFile, 4_000_000)) : 500000,
    maxTotalBytes: Number.isFinite(maxTotalBytes) ? Math.max(1024, Math.min(maxTotalBytes, 25_000_000)) : 12000000,
    maxTreeEntries: Number.isFinite(maxTreeEntries) ? Math.max(100, Math.min(maxTreeEntries, 1_000_000)) : 300000,
  }
}

export function getRetrievalPolicy() {
  const rawValidationMode = process.env.SECLENS_VALIDATION_MODE
  const rawRecallFirst = process.env.SECLENS_RECALL_FIRST_VALIDATION
  const validationMode = String(rawValidationMode || 'recall_first').trim().toLowerCase()
  const recallFirstEnv = String(rawRecallFirst || '').trim().toLowerCase()

  let recallFirst = validationMode === 'recall_first'
  if (recallFirstEnv === 'true' || recallFirstEnv === '1') recallFirst = true
  if (recallFirstEnv === 'false' || recallFirstEnv === '0') recallFirst = false

  return {
    validationMode: recallFirst ? 'recall_first' : 'balanced',
    recallFirst,
  }
}

/**
 * DEFECT-003: by default ingestion fails closed when the profile critical shortlist has a coverage gap
 * or was truncated. Set SECLENS_ALLOW_PROTECTED_COVERAGE_GAP=true (or 1) to continue with telemetry only.
 */
export function allowPartialCriticalShortlistCoverage() {
  const v = String(process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP || '').trim().toLowerCase()
  return v === 'true' || v === '1'
}
