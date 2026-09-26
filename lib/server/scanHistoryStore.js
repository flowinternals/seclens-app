/**
 * Owner-scoped successful-scan history (CR-SECLENS-PIVOT-010).
 *
 * Blaze cost controls (intentional):
 * - One gzipped JSON object per run (no md/txt/pdf duplicates in Storage).
 * - Hard uncompressed artifact size cap; refuse rather than store unbounded blobs.
 * - Free/Pro retention caps prune Storage + Firestore after archive and on plan change.
 * - List/get-metadata never downloads Storage objects; restore/export download once.
 * - Client Storage rules deny all access; no public download URLs.
 * - Failed/incomplete scans are never archived.
 * - Idempotent archive by runId (retries do not re-upload or double-prune).
 */

import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { getFirebaseAdminDb, getFirebaseAdminStorageBucket } from './firebaseAdmin.js'
import { getUserSubscription, hasProAccess } from './billing.js'

export const SCAN_HISTORY_SCHEMA_VERSION = 1
export const SCAN_HISTORY_ARTIFACT_SCHEMA_VERSION = 1
export const FREE_HISTORY_CAP = 10
export const PRO_HISTORY_CAP = 50

/** Refuse archive if uncompressed JSON exceeds this (bytes). Keeps Blaze Storage/egress bounded. */
export const MAX_ARTIFACT_UNCOMPRESSED_BYTES = 2_500_000

const HISTORY_SUBCOLLECTION = 'scanHistory'

/** @type {Map<string, Map<string, object>>|null} uid -> (runId -> metadata) */
let testHistoryByUid = null
/** @type {Map<string, Buffer>|null} storagePath -> bytes */
let testBlobStore = null

function nowIso() {
  return new Date().toISOString()
}

function toNonEmptyString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function buildHistoryStoragePath(uid, runId) {
  return `user-history/${uid}/${runId}/artifact.json.gz`
}

export function retentionCapForSubscription(subscription) {
  return hasProAccess(subscription) ? PRO_HISTORY_CAP : FREE_HISTORY_CAP
}

/**
 * Test-only Map-backed Firestore + Storage doubles.
 * @param {{ historyByUid?: Map<string, Map<string, object>>, blobs?: Map<string, Buffer> }|null} stores
 */
export function __setScanHistoryStoreForTests(stores) {
  if (!stores) {
    testHistoryByUid = null
    testBlobStore = null
    return
  }
  testHistoryByUid = stores.historyByUid instanceof Map ? stores.historyByUid : new Map()
  testBlobStore = stores.blobs instanceof Map ? stores.blobs : new Map()
}

function historyCollection(db, uid) {
  return db.collection('users').doc(uid).collection(HISTORY_SUBCOLLECTION)
}

function getTestUserMap(uid) {
  if (!testHistoryByUid) return null
  if (!testHistoryByUid.has(uid)) testHistoryByUid.set(uid, new Map())
  return testHistoryByUid.get(uid)
}

async function writeBlob(storagePath, bytes, contentType) {
  if (testBlobStore) {
    testBlobStore.set(storagePath, Buffer.from(bytes))
    return
  }
  const bucket = getFirebaseAdminStorageBucket()
  if (!bucket) {
    throw new Error('Firebase Storage bucket is unavailable.')
  }
  const file = bucket.file(storagePath)
  await file.save(Buffer.from(bytes), {
    resumable: false,
    validation: false,
    contentType,
    metadata: {
      cacheControl: 'private, max-age=0, no-store',
      metadata: {
        purpose: 'scan-history-artifact',
        schemaVersion: String(SCAN_HISTORY_ARTIFACT_SCHEMA_VERSION),
      },
    },
  })
}

async function readBlob(storagePath) {
  if (testBlobStore) {
    const buf = testBlobStore.get(storagePath)
    if (!buf) return null
    return Buffer.from(buf)
  }
  const bucket = getFirebaseAdminStorageBucket()
  if (!bucket) {
    throw new Error('Firebase Storage bucket is unavailable.')
  }
  const file = bucket.file(storagePath)
  const [exists] = await file.exists()
  if (!exists) return null
  const [buf] = await file.download()
  return Buffer.from(buf)
}

async function deleteBlob(storagePath) {
  if (testBlobStore) {
    testBlobStore.delete(storagePath)
    return { ok: true, missing: false }
  }
  const bucket = getFirebaseAdminStorageBucket()
  if (!bucket) {
    return { ok: false, missing: false, error: 'Firebase Storage bucket is unavailable.' }
  }
  try {
    await bucket.file(storagePath).delete({ ignoreNotFound: true })
    return { ok: true, missing: false }
  } catch (error) {
    return { ok: false, missing: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Drop heavy / secret-adjacent fields; keep UI-restorable dashboard shape.
 */
export function sanitizeDashboardForArchive(dashboard) {
  if (!dashboard || typeof dashboard !== 'object') return null
  const {
    report: _report,
    telemetry: _telemetry,
    githubToken: _githubToken,
    ...rest
  } = dashboard
  return {
    ...rest,
    report: null,
    telemetry: null,
  }
}

export function sanitizeRepositoryForArchive(repository) {
  if (!repository || typeof repository !== 'object') return null
  const {
    githubToken: _t,
    token: _tok,
    ...rest
  } = repository
  return { ...rest }
}

/**
 * Archive eligibility per architect decision (conjunctive).
 */
export function evaluateArchiveEligibility(jobRecord) {
  const status = String(jobRecord?.status || '').toLowerCase()
  const reportOk = jobRecord?.reportValidation?.ok === true
  const consolidated = jobRecord?.dashboard?.consolidatedReportAvailable === true
  const report = typeof jobRecord?.report === 'string' ? jobRecord.report.trim() : ''
  const reasons = []
  if (status !== 'completed') reasons.push('STATUS_NOT_COMPLETED')
  if (!reportOk) reasons.push('REPORT_VALIDATION_NOT_OK')
  if (!consolidated) reasons.push('CONSOLIDATED_REPORT_UNAVAILABLE')
  if (!report) reasons.push('REPORT_EMPTY')
  return { ok: reasons.length === 0, reasons }
}

export function buildHistoryArtifactPayload(jobRecord) {
  return {
    schemaVersion: SCAN_HISTORY_ARTIFACT_SCHEMA_VERSION,
    runId: jobRecord.jobId,
    ownerUid: jobRecord?.triggeredBy?.uid || null,
    report: jobRecord.report,
    dashboard: sanitizeDashboardForArchive(jobRecord.dashboard),
    repository: sanitizeRepositoryForArchive(jobRecord.repository),
    reportValidation: jobRecord.reportValidation || null,
    runCost: jobRecord.runCost || jobRecord.dashboard?.runCost || null,
    model: {
      requested: jobRecord.requestedAnalysisModel || null,
      resolved: jobRecord.analysisModel || null,
    },
    timestamps: {
      createdAt: jobRecord.createdAt || null,
      startedAt: jobRecord.startedAt || jobRecord.createdAt || null,
      completedAt: jobRecord.updatedAt || null,
    },
  }
}

function buildMetadataDoc({ jobRecord, uid, storagePath, checksum, byteSize, uncompressedBytes }) {
  const repo = sanitizeRepositoryForArchive(jobRecord.repository) || {}
  return {
    schemaVersion: SCAN_HISTORY_SCHEMA_VERSION,
    runId: jobRecord.jobId,
    ownerUid: uid,
    status: 'SUCCESS',
    createdAt: jobRecord.createdAt || nowIso(),
    startedAt: jobRecord.startedAt || jobRecord.createdAt || null,
    completedAt: jobRecord.updatedAt || nowIso(),
    updatedAt: nowIso(),
    repository: {
      owner: repo.owner || null,
      name: repo.name || null,
      displayName: repo.displayName || null,
      url: repo.url || null,
      ref: repo.ref || repo.branch || null,
      defaultBranch: repo.defaultBranch || null,
    },
    model: {
      requested: jobRecord.requestedAnalysisModel || null,
      resolved: jobRecord.analysisModel || null,
    },
    runCost: jobRecord.runCost || jobRecord.dashboard?.runCost || null,
    quality: {
      reportValidationOk: jobRecord.reportValidation?.ok === true,
      consolidatedReportAvailable: jobRecord.dashboard?.consolidatedReportAvailable === true,
    },
    artifact: {
      storagePath,
      contentType: 'application/gzip',
      encoding: 'gzip',
      checksumSha256: checksum,
      byteSize,
      uncompressedBytes,
      schemaVersion: SCAN_HISTORY_ARTIFACT_SCHEMA_VERSION,
    },
    archiveStatus: 'ready',
    archiveError: null,
  }
}

export function toHistoryListItem(doc) {
  if (!doc || typeof doc !== 'object') return null
  return {
    runId: doc.runId,
    status: doc.status,
    createdAt: doc.createdAt || null,
    completedAt: doc.completedAt || null,
    updatedAt: doc.updatedAt || null,
    repository: doc.repository || null,
    model: doc.model || null,
    runCost: doc.runCost || null,
    quality: doc.quality || null,
    archiveStatus: doc.archiveStatus || null,
  }
}

async function listHistoryDocs(uid) {
  const testMap = getTestUserMap(uid)
  if (testMap) {
    return [...testMap.values()]
  }
  const db = getFirebaseAdminDb()
  if (!db) throw new Error('Firebase Admin Firestore is unavailable.')
  const snap = await historyCollection(db, uid).get()
  return snap.docs.map((d) => ({ ...d.data(), runId: d.id }))
}

function sortNewestFirst(docs) {
  return [...docs].sort((a, b) => {
    const aTs = Date.parse(a.completedAt || a.updatedAt || a.createdAt || 0) || 0
    const bTs = Date.parse(b.completedAt || b.updatedAt || b.createdAt || 0) || 0
    if (bTs !== aTs) return bTs - aTs
    return String(b.runId || '').localeCompare(String(a.runId || ''))
  })
}

async function deleteHistoryRecord(uid, doc) {
  const storagePath = doc?.artifact?.storagePath || buildHistoryStoragePath(uid, doc.runId)
  const blobResult = await deleteBlob(storagePath)
  const testMap = getTestUserMap(uid)
  if (testMap) {
    testMap.delete(doc.runId)
    return { runId: doc.runId, metadataDeleted: true, blob: blobResult }
  }
  const db = getFirebaseAdminDb()
  if (!db) {
    return {
      runId: doc.runId,
      metadataDeleted: false,
      blob: blobResult,
      error: 'Firebase Admin Firestore is unavailable.',
    }
  }
  try {
    await historyCollection(db, uid).doc(doc.runId).delete()
    return { runId: doc.runId, metadataDeleted: true, blob: blobResult }
  } catch (error) {
    return {
      runId: doc.runId,
      metadataDeleted: false,
      blob: blobResult,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Keep newest `cap` SUCCESS docs; delete older metadata + Storage objects.
 * Deterministic ordering; safe to call repeatedly.
 */
export async function enforceHistoryRetention(uid, { subscription = null, cap = null } = {}) {
  let effectiveCap
  if (typeof cap === 'number' && Number.isFinite(cap)) {
    effectiveCap = Math.max(0, Math.floor(cap))
  } else {
    let sub = subscription
    if (!sub) {
      if (testHistoryByUid) {
        sub = { plan: 'free', status: 'none' }
      } else {
        const db = getFirebaseAdminDb()
        sub = db ? await getUserSubscription(db, uid) : { plan: 'free', status: 'none' }
      }
    }
    effectiveCap = retentionCapForSubscription(sub)
  }

  const docs = sortNewestFirst(await listHistoryDocs(uid))
  const toDelete = docs.slice(effectiveCap)
  const results = []
  for (const doc of toDelete) {
    results.push(await deleteHistoryRecord(uid, doc))
  }
  return {
    uid,
    cap: effectiveCap,
    retained: docs.length - toDelete.length,
    deleted: results,
  }
}

/**
 * Future account-deletion integration point (CR-010 decision B).
 * Does not delete Auth, billing, usage, runs/, or scanJobs/.
 */
export async function deleteUserScanHistory(uid) {
  const ownerUid = toNonEmptyString(uid)
  if (!ownerUid) {
    return { ok: false, reasonCode: 'INVALID_UID', deleted: [] }
  }
  const docs = await listHistoryDocs(ownerUid)
  const deleted = []
  const failures = []
  for (const doc of docs) {
    const result = await deleteHistoryRecord(ownerUid, doc)
    deleted.push(result)
    if (!result.metadataDeleted || result.blob?.ok === false) {
      failures.push(result)
    }
  }
  return {
    ok: failures.length === 0,
    uid: ownerUid,
    deletedCount: deleted.length,
    deleted,
    failures,
    integrationNote:
      'Call from a future account-deletion CR. Does not remove Auth, billing, usage, runs/, or scanJobs/.',
  }
}

async function getHistoryMetadata(uid, runId) {
  const testMap = getTestUserMap(uid)
  if (testMap) {
    return testMap.get(runId) || null
  }
  const db = getFirebaseAdminDb()
  if (!db) throw new Error('Firebase Admin Firestore is unavailable.')
  const snap = await historyCollection(db, uid).doc(runId).get()
  if (!snap.exists) return null
  return { ...snap.data(), runId: snap.id }
}

async function putHistoryMetadata(uid, runId, data) {
  const testMap = getTestUserMap(uid)
  if (testMap) {
    testMap.set(runId, { ...data, runId })
    return
  }
  const db = getFirebaseAdminDb()
  if (!db) throw new Error('Firebase Admin Firestore is unavailable.')
  await historyCollection(db, uid).doc(runId).set(data, { merge: false })
}

/**
 * Archive a successful completed job. Never throws into scan failure path — caller should catch.
 * Idempotent on runId.
 */
export async function archiveSuccessfulScanHistory(jobRecord, options = {}) {
  const eligibility = evaluateArchiveEligibility(jobRecord)
  if (!eligibility.ok) {
    console.info(
      JSON.stringify({
        event: 'scan_history_archive_skipped',
        runId: jobRecord?.jobId || null,
        reasons: eligibility.reasons,
      })
    )
    return { ok: false, skipped: true, reasonCode: 'ARCHIVE_GATES_FAILED', reasons: eligibility.reasons }
  }

  const uid = toNonEmptyString(jobRecord?.triggeredBy?.uid)
  if (!uid) {
    return { ok: false, skipped: true, reasonCode: 'MISSING_OWNER_UID' }
  }

  const runId = toNonEmptyString(jobRecord?.jobId)
  if (!runId) {
    return { ok: false, skipped: true, reasonCode: 'MISSING_RUN_ID' }
  }

  const existing = await getHistoryMetadata(uid, runId)
  if (existing?.archiveStatus === 'ready' && existing?.artifact?.storagePath) {
    return {
      ok: true,
      idempotent: true,
      runId,
      storagePath: existing.artifact.storagePath,
    }
  }

  if (!testBlobStore && !getFirebaseAdminStorageBucket()) {
    console.warn(
      JSON.stringify({
        event: 'scan_history_archive_failed',
        runId,
        reasonCode: 'STORAGE_UNAVAILABLE',
      })
    )
    return { ok: false, skipped: false, reasonCode: 'STORAGE_UNAVAILABLE' }
  }
  if (!testHistoryByUid && !getFirebaseAdminDb()) {
    return { ok: false, skipped: false, reasonCode: 'FIRESTORE_UNAVAILABLE' }
  }

  const artifactPayload = buildHistoryArtifactPayload(jobRecord)
  const uncompressed = Buffer.from(JSON.stringify(artifactPayload), 'utf8')
  if (uncompressed.byteLength > MAX_ARTIFACT_UNCOMPRESSED_BYTES) {
    console.warn(
      JSON.stringify({
        event: 'scan_history_archive_failed',
        runId,
        reasonCode: 'ARTIFACT_TOO_LARGE',
        uncompressedBytes: uncompressed.byteLength,
        maxBytes: MAX_ARTIFACT_UNCOMPRESSED_BYTES,
      })
    )
    return {
      ok: false,
      skipped: false,
      reasonCode: 'ARTIFACT_TOO_LARGE',
      uncompressedBytes: uncompressed.byteLength,
    }
  }

  const compressed = gzipSync(uncompressed, { level: 6 })
  const checksum = sha256Hex(compressed)
  const storagePath = buildHistoryStoragePath(uid, runId)

  await writeBlob(storagePath, compressed, 'application/gzip')

  const metadata = buildMetadataDoc({
    jobRecord,
    uid,
    storagePath,
    checksum,
    byteSize: compressed.byteLength,
    uncompressedBytes: uncompressed.byteLength,
  })
  await putHistoryMetadata(uid, runId, metadata)

  let retention = null
  try {
    let subscription = options.subscription || null
    if (!subscription) {
      if (testHistoryByUid) {
        subscription = { plan: 'free', status: 'none' }
      } else {
        const db = getFirebaseAdminDb()
        subscription = db ? await getUserSubscription(db, uid) : { plan: 'free', status: 'none' }
      }
    }
    retention = await enforceHistoryRetention(uid, { subscription })
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'scan_history_retention_failed',
        runId,
        uid,
        error: error instanceof Error ? error.message : String(error),
      })
    )
  }

  console.info(
    JSON.stringify({
      event: 'scan_history_archived',
      runId,
      uid,
      byteSize: compressed.byteLength,
      uncompressedBytes: uncompressed.byteLength,
      retained: retention?.retained ?? null,
      pruned: retention?.deleted?.length ?? 0,
    })
  )

  return {
    ok: true,
    idempotent: false,
    runId,
    storagePath,
    byteSize: compressed.byteLength,
    retention,
  }
}

export async function listUserScanHistory(uid, { subscription = null, enforceRetention = true } = {}) {
  const ownerUid = toNonEmptyString(uid)
  if (!ownerUid) return { runs: [], retention: null }

  let retention = null
  if (enforceRetention) {
    retention = await enforceHistoryRetention(ownerUid, { subscription })
  }

  const docs = sortNewestFirst(await listHistoryDocs(ownerUid))
  return {
    runs: docs.map(toHistoryListItem).filter(Boolean),
    retention,
  }
}

export async function getUserScanHistoryArtifact(uid, runId) {
  const ownerUid = toNonEmptyString(uid)
  const id = toNonEmptyString(runId)
  if (!ownerUid || !id) {
    return { ok: false, reasonCode: 'INVALID_ARGS' }
  }

  await enforceHistoryRetention(ownerUid)

  const meta = await getHistoryMetadata(ownerUid, id)
  if (!meta) {
    return { ok: false, reasonCode: 'NOT_FOUND' }
  }
  if (meta.ownerUid && meta.ownerUid !== ownerUid) {
    return { ok: false, reasonCode: 'FORBIDDEN' }
  }
  if (meta.archiveStatus !== 'ready') {
    return { ok: false, reasonCode: 'ARTIFACT_UNAVAILABLE', metadata: toHistoryListItem(meta) }
  }

  const storagePath = meta.artifact?.storagePath || buildHistoryStoragePath(ownerUid, id)
  const compressed = await readBlob(storagePath)
  if (!compressed) {
    return { ok: false, reasonCode: 'ARTIFACT_MISSING', metadata: toHistoryListItem(meta) }
  }

  const expected = meta.artifact?.checksumSha256
  if (expected && sha256Hex(compressed) !== expected) {
    return { ok: false, reasonCode: 'ARTIFACT_CORRUPT', metadata: toHistoryListItem(meta) }
  }

  let payload
  try {
    const raw = gunzipSync(compressed).toString('utf8')
    payload = JSON.parse(raw)
  } catch {
    return { ok: false, reasonCode: 'ARTIFACT_CORRUPT', metadata: toHistoryListItem(meta) }
  }

  if (Number(payload?.schemaVersion) !== SCAN_HISTORY_ARTIFACT_SCHEMA_VERSION) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_SCHEMA',
      metadata: toHistoryListItem(meta),
      schemaVersion: payload?.schemaVersion ?? null,
    }
  }

  if (payload.ownerUid && payload.ownerUid !== ownerUid) {
    return { ok: false, reasonCode: 'FORBIDDEN' }
  }

  return {
    ok: true,
    metadata: toHistoryListItem(meta),
    report: typeof payload.report === 'string' ? payload.report : null,
    dashboard: payload.dashboard || null,
    repository: payload.repository || null,
    reportValidation: payload.reportValidation || null,
    model: payload.model || null,
    runCost: payload.runCost || meta.runCost || payload.dashboard?.runCost || null,
  }
}
