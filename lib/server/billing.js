import { authenticateRequest } from './adminAuth.js'
import { getFirebaseAdminDb } from './firebaseAdmin.js'

const BILLING_STATUS_ACTIVE = new Set(['active', 'trialing'])
const DEFAULT_SUBSCRIPTION = Object.freeze({
  plan: 'free',
  status: 'none',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  updatedAt: null,
})

export function subscriptionDocRef(db, uid) {
  return db.collection('users').doc(uid).collection('billing').doc('subscription')
}

export function normalizePlan(plan) {
  return String(plan || '').toLowerCase() === 'pro' ? 'pro' : 'free'
}

export function normalizeStatus(status) {
  const normalized = String(status || '').toLowerCase()
  if (['active', 'trialing', 'past_due', 'cancelled', 'none'].includes(normalized)) {
    return normalized
  }
  return 'none'
}

export function normalizeSubscription(data) {
  const current = data && typeof data === 'object' ? data : {}
  return {
    ...DEFAULT_SUBSCRIPTION,
    ...current,
    plan: normalizePlan(current.plan),
    status: normalizeStatus(current.status),
    cancelAtPeriodEnd: Boolean(current.cancelAtPeriodEnd),
  }
}

export async function getUserSubscription(db, uid) {
  const snapshot = await subscriptionDocRef(db, uid).get()
  return normalizeSubscription(snapshot.exists ? snapshot.data() : null)
}

export async function setUserSubscription(db, uid, data) {
  const payload = {
    ...normalizeSubscription(data),
    updatedAt: new Date(),
  }
  await subscriptionDocRef(db, uid).set(payload, { merge: true })
  return payload
}

export function hasProAccess(subscription) {
  if (!subscription || normalizePlan(subscription.plan) !== 'pro') return false
  return BILLING_STATUS_ACTIVE.has(normalizeStatus(subscription.status))
}

export async function requireAuthWithBilling(req, res) {
  const authResult = await authenticateRequest(req)
  if (!authResult.ok) {
    const payload = { error: authResult.error }
    if (authResult.reasonCode) payload.reasonCode = authResult.reasonCode
    res.status(authResult.status).json(payload)
    return null
  }
  const db = getFirebaseAdminDb()
  if (!db) {
    res.status(503).json({ error: 'Firebase Admin Firestore is unavailable.' })
    return null
  }
  const subscription = await getUserSubscription(db, authResult.uid)
  return { uid: authResult.uid, db, subscription }
}

