/**
 * Durable scan-job poll state (DEFECT-MVP5-001).
 * Authoritative for cross-instance polling on Vercel; memory is only a worker cache.
 */

import { randomUUID } from 'crypto'
import { getFirebaseAdminDb } from './firebaseAdmin.js'

export const SCAN_JOBS_COLLECTION = 'scanJobs'
export const SCAN_JOB_IDEMPOTENCY_COLLECTION = 'scanJobIdempotency'

/** Default retention for pollable job documents (aligned with prior in-memory TTL). */
export const SCAN_JOB_TTL_MS = 1000 * 60 * 30

/** Worker lease window; extended on progress heartbeats. */
export const SCAN_JOB_LEASE_MS = 1000 * 60 * 45

const TERMINAL_STATUSES = new Set(['completed', 'failed'])

/** @type {Map<string, object>|null} */
let testDurableMap = null
/** @type {Map<string, object>|null} */
let testIdempotencyMap = null

function nowIso() {
  return new Date().toISOString()
}

function toNonEmptyString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isTerminalScanJobStatus(status) {
  return TERMINAL_STATUSES.has(String(status || '').toLowerCase())
}

/**
 * Test-only: shared Map-backed durable store (simulates Firestore across memory-cache clears).
 * @param {{ jobs?: Map<string, object>, idempotency?: Map<string, object> }|null} stores
 */
export function __setScanJobStoreForTests(stores) {
  if (!stores) {
    testDurableMap = null
    testIdempotencyMap = null
    return
  }
  testDurableMap = stores.jobs instanceof Map ? stores.jobs : new Map()
  testIdempotencyMap = stores.idempotency instanceof Map ? stores.idempotency : new Map()
}

function getCollection() {
  if (testDurableMap) return null
  const db = getFirebaseAdminDb()
  if (!db) return null
  return db.collection(SCAN_JOBS_COLLECTION)
}

function getIdempotencyCollection() {
  if (testIdempotencyMap) return null
  const db = getFirebaseAdminDb()
  if (!db) return null
  return db.collection(SCAN_JOB_IDEMPOTENCY_COLLECTION)
}

/**
 * Strip oversized blobs enough to stay under Firestore ~1MiB docs while keeping poll payload useful.
 * Full reports are preferred; only truncate when clearly oversized.
 */
export function sanitizeScanJobForPersistence(record, maxReportChars = 750_000) {
  if (!record || typeof record !== 'object') return record
  const out = { ...record }
  if (typeof out.report === 'string' && out.report.length > maxReportChars) {
    out.report = `${out.report.slice(0, maxReportChars)}\n\n...[truncated for durable storage]`
    out.reportTruncated = true
  }
  // Never persist secrets that may have been attached by mistake.
  delete out.githubToken
  delete out._githubToken
  delete out.probeCache
  return out
}

export function computeExpiresAt(fromIso = nowIso(), ttlMs = SCAN_JOB_TTL_MS) {
  const base = Date.parse(fromIso)
  const ms = Number.isFinite(base) ? base : Date.now()
  return new Date(ms + ttlMs).toISOString()
}

export function isScanJobExpired(record, nowMs = Date.now()) {
  if (!record || typeof record !== 'object') return true
  const expiresAt = Date.parse(record.expiresAt || 0)
  if (Number.isFinite(expiresAt)) return expiresAt < nowMs
  const updated = Date.parse(record.updatedAt || record.createdAt || 0)
  if (!Number.isFinite(updated)) return true
  return updated < nowMs - SCAN_JOB_TTL_MS
}

export function isExecutionLeaseExpired(record, nowMs = Date.now()) {
  if (!record || typeof record !== 'object') return false
  if (isTerminalScanJobStatus(record.status)) return false
  const lease = Date.parse(record.executionLeaseExpiresAt || 0)
  if (!Number.isFinite(lease)) return false
  return lease < nowMs
}

/**
 * Persist authoritative job state. Returns false when no durable backend is available.
 */
export async function persistScanJob(record) {
  const jobId = toNonEmptyString(record?.jobId)
  if (!jobId) return false
  const safe = sanitizeScanJobForPersistence(record)
  if (!safe.expiresAt) {
    safe.expiresAt = computeExpiresAt(safe.createdAt || nowIso())
  }
  safe.updatedAt = safe.updatedAt || nowIso()

  if (testDurableMap) {
    testDurableMap.set(jobId, structuredClone(safe))
    return true
  }

  const collection = getCollection()
  if (!collection) return false
  await collection.doc(jobId).set(safe, { merge: true })
  return true
}

export async function getPersistedScanJob(jobId) {
  const id = toNonEmptyString(jobId)
  if (!id) return null

  if (testDurableMap) {
    const hit = testDurableMap.get(id)
    if (!hit) return null
    if (isScanJobExpired(hit)) {
      testDurableMap.delete(id)
      return null
    }
    return structuredClone(hit)
  }

  const collection = getCollection()
  if (!collection) return null
  const snap = await collection.doc(id).get()
  if (!snap.exists) return null
  const data = { jobId: snap.id, ...snap.data() }
  if (isScanJobExpired(data)) {
    await collection.doc(id).delete().catch(() => {})
    return null
  }
  return data
}

export async function deletePersistedScanJob(jobId) {
  const id = toNonEmptyString(jobId)
  if (!id) return false

  if (testDurableMap) {
    return testDurableMap.delete(id)
  }

  const collection = getCollection()
  if (!collection) return false
  const ref = collection.doc(id)
  const snap = await ref.get()
  if (!snap.exists) return false
  await ref.delete()
  return true
}

export async function listPersistedScanJobs(limit = 50) {
  const max = Number.isFinite(limit) ? Math.max(1, Math.min(200, Number(limit))) : 50

  if (testDurableMap) {
    const nowMs = Date.now()
    const rows = []
    for (const [jobId, record] of testDurableMap.entries()) {
      if (isScanJobExpired(record, nowMs)) {
        testDurableMap.delete(jobId)
        continue
      }
      rows.push(structuredClone(record))
    }
    return rows
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
      .slice(0, max)
  }

  const collection = getCollection()
  if (!collection) return []

  try {
    const snapshot = await collection.orderBy('updatedAt', 'desc').limit(max).get()
    return snapshot.docs
      .map((doc) => ({ jobId: doc.id, ...doc.data() }))
      .filter((row) => !isScanJobExpired(row))
  } catch {
    const snapshot = await collection.limit(max).get()
    return snapshot.docs
      .map((doc) => ({ jobId: doc.id, ...doc.data() }))
      .filter((row) => !isScanJobExpired(row))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
      .slice(0, max)
  }
}

/**
 * Claim exclusive execution (idempotent). Returns { claimed, record, executionToken }.
 */
export async function claimScanJobExecution(jobId, { leaseMs = SCAN_JOB_LEASE_MS, executionToken } = {}) {
  const id = toNonEmptyString(jobId)
  if (!id) return { claimed: false, record: null, executionToken: null }
  const token = toNonEmptyString(executionToken) || cryptoRandomToken()
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()

  if (testDurableMap) {
    const current = testDurableMap.get(id)
    if (!current) return { claimed: false, record: null, executionToken: null }
    if (isTerminalScanJobStatus(current.status)) {
      return { claimed: false, record: structuredClone(current), executionToken: current.executionToken || null }
    }
    const leaseActive =
      current.executionToken &&
      current.executionLeaseExpiresAt &&
      !isExecutionLeaseExpired(current) &&
      current.executionToken !== token
    if (leaseActive) {
      return { claimed: false, record: structuredClone(current), executionToken: current.executionToken }
    }
    const next = {
      ...current,
      executionToken: token,
      executionAttempt: (Number(current.executionAttempt) || 0) + 1,
      executionLeaseExpiresAt: leaseExpiresAt,
      updatedAt: nowIso(),
    }
    testDurableMap.set(id, next)
    return { claimed: true, record: structuredClone(next), executionToken: token }
  }

  const collection = getCollection()
  if (!collection) {
    return { claimed: true, record: null, executionToken: token }
  }

  const db = getFirebaseAdminDb()
  const ref = collection.doc(id)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { claimed: false, record: null, executionToken: null }
    const current = { jobId: snap.id, ...snap.data() }
    if (isTerminalScanJobStatus(current.status)) {
      return { claimed: false, record: current, executionToken: current.executionToken || null }
    }
    const leaseActive =
      current.executionToken &&
      current.executionLeaseExpiresAt &&
      !isExecutionLeaseExpired(current) &&
      current.executionToken !== token
    if (leaseActive) {
      return { claimed: false, record: current, executionToken: current.executionToken }
    }
    const next = {
      executionToken: token,
      executionAttempt: (Number(current.executionAttempt) || 0) + 1,
      executionLeaseExpiresAt: leaseExpiresAt,
      updatedAt: nowIso(),
    }
    tx.set(ref, next, { merge: true })
    return { claimed: true, record: { ...current, ...next }, executionToken: token }
  })
}

export async function heartbeatScanJobLease(jobId, executionToken, { leaseMs = SCAN_JOB_LEASE_MS } = {}) {
  const id = toNonEmptyString(jobId)
  const token = toNonEmptyString(executionToken)
  if (!id || !token) return false
  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()

  if (testDurableMap) {
    const current = testDurableMap.get(id)
    if (!current || current.executionToken !== token) return false
    if (isTerminalScanJobStatus(current.status)) return false
    testDurableMap.set(id, {
      ...current,
      executionLeaseExpiresAt: leaseExpiresAt,
      updatedAt: nowIso(),
    })
    return true
  }

  const collection = getCollection()
  if (!collection) return false
  const db = getFirebaseAdminDb()
  const ref = collection.doc(id)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const current = snap.data() || {}
    if (current.executionToken !== token) return false
    if (isTerminalScanJobStatus(current.status)) return false
    tx.set(
      ref,
      {
        executionLeaseExpiresAt: leaseExpiresAt,
        updatedAt: nowIso(),
      },
      { merge: true }
    )
    return true
  })
}

/**
 * Resolve or reserve an idempotency key for a user. Returns existing jobId when replaying.
 */
export async function resolveIdempotentJobId({ uid, idempotencyKey, jobId, ttlMs = SCAN_JOB_TTL_MS }) {
  const owner = toNonEmptyString(uid)
  const key = toNonEmptyString(idempotencyKey)
  const nextJobId = toNonEmptyString(jobId)
  if (!owner || !key || !nextJobId) return { replay: false, jobId: nextJobId }

  const docId = `${owner}_${hashKey(key)}`
  const expiresAt = computeExpiresAt(nowIso(), ttlMs)
  const payload = {
    uid: owner,
    idempotencyKey: key,
    jobId: nextJobId,
    createdAt: nowIso(),
    expiresAt,
  }

  if (testIdempotencyMap) {
    const existing = testIdempotencyMap.get(docId)
    if (existing && !isScanJobExpired(existing)) {
      return { replay: true, jobId: existing.jobId }
    }
    testIdempotencyMap.set(docId, payload)
    return { replay: false, jobId: nextJobId }
  }

  const collection = getIdempotencyCollection()
  if (!collection) return { replay: false, jobId: nextJobId }

  const db = getFirebaseAdminDb()
  const ref = collection.doc(docId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) {
      const data = snap.data() || {}
      if (!isScanJobExpired(data) && toNonEmptyString(data.jobId)) {
        return { replay: true, jobId: data.jobId }
      }
    }
    tx.set(ref, payload)
    return { replay: false, jobId: nextJobId }
  })
}

function hashKey(value) {
  // Lightweight stable key for doc ids (not a secret hash).
  let h = 2166136261
  const s = String(value)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function cryptoRandomToken() {
  return randomUUID()
}
