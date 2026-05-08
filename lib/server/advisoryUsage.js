/**
 * Rolling advisory run quota (CR6 baseline). Authenticated scans only.
 */

import { hasProAccess } from './billing.js'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const FREE_RUN_LIMIT = 10
const PRO_RUN_LIMIT = 200
const USAGE_DOC_ID = 'advisory'

function usageDocRef(db, uid) {
  return db.collection('users').doc(uid).collection('usage').doc(USAGE_DOC_ID)
}

function pruneWindow(timestamps, nowMs) {
  const cutoff = nowMs - THIRTY_DAYS_MS
  return timestamps.filter((t) => {
    const ms = Date.parse(t)
    return Number.isFinite(ms) && ms >= cutoff
  })
}

export function getAdvisoryRunLimitForSubscription(subscription) {
  return hasProAccess(subscription) ? PRO_RUN_LIMIT : FREE_RUN_LIMIT
}

/**
 * @returns {{ allowed: boolean, used: number, limit: number, remaining: number }}
 */
export async function evaluateAdvisoryRunQuota(db, uid, subscription) {
  const limit = getAdvisoryRunLimitForSubscription(subscription)
  const nowMs = Date.now()
  const ref = usageDocRef(db, uid)
  const snap = await ref.get()
  const data = snap.exists ? snap.data() : {}
  const raw = Array.isArray(data.runStarts) ? data.runStarts : []
  const pruned = pruneWindow(
    raw.map((x) => String(x || '').trim()).filter(Boolean),
    nowMs
  )
  const used = pruned.length
  const remaining = Math.max(0, limit - used)
  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
  }
}

/**
 * Records one advisory run start against rolling quota (call after POST accepts job).
 */
export async function recordAdvisoryRunStart(db, uid) {
  const ref = usageDocRef(db, uid)
  const nowMs = Date.now()
  const iso = new Date(nowMs).toISOString()
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() : {}
    const raw = Array.isArray(data.runStarts) ? data.runStarts : []
    const pruned = pruneWindow(
      raw.map((x) => String(x || '').trim()).filter(Boolean),
      nowMs
    )
    const next = [...pruned, iso]
    const trimmed = next.length > 600 ? next.slice(next.length - 600) : next
    tx.set(
      ref,
      {
        runStarts: trimmed,
        updatedAt: new Date(nowMs),
      },
      { merge: true }
    )
  })
}
