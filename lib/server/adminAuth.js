import { getFirebaseAdminAuth, getFirebaseAdminDb, hasFirebaseAdmin } from './firebaseAdmin.js'

export function getBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || ''
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i)
  return match?.[1] || null
}

export async function authenticateRequest(req) {
  if (!hasFirebaseAdmin()) {
    return {
      ok: false,
      status: 503,
      error: 'Firebase Admin is not configured.',
      reasonCode: 'AUTH_REQUIRED',
    }
  }
  const token = getBearerToken(req)
  if (!token) {
    return { ok: false, status: 401, error: 'Missing bearer token.', reasonCode: 'AUTH_TOKEN_MISSING' }
  }

  const auth = getFirebaseAdminAuth()
  if (!auth) {
    return {
      ok: false,
      status: 503,
      error: 'Firebase Admin auth is unavailable.',
      reasonCode: 'AUTH_REQUIRED',
    }
  }

  try {
    const decoded = await auth.verifyIdToken(token)
    return { ok: true, uid: decoded.uid, claims: decoded }
  } catch (error) {
    const code = String(error?.code || '')
    if (code === 'auth/id-token-expired') {
      return {
        ok: false,
        status: 401,
        error: 'Token expired.',
        reasonCode: 'AUTH_TOKEN_EXPIRED',
      }
    }
    return {
      ok: false,
      status: 401,
      error: 'Invalid or expired token.',
      reasonCode: 'AUTH_TOKEN_INVALID',
    }
  }
}

/**
 * Enrich authenticated user for scan telemetry (single verify path - use after authenticateRequest).
 * @param {{ ok: true, uid: string, claims: object }} authResult
 */
export async function buildTriggeredByProfile(authResult) {
  if (!authResult?.ok || !authResult.uid) return null
  const uid = authResult.uid
  const adminAuth = getFirebaseAdminAuth()
  const decoded = authResult.claims && typeof authResult.claims === 'object' ? authResult.claims : {}
  let email = typeof decoded.email === 'string' ? decoded.email : null
  let displayName = typeof decoded.name === 'string' ? decoded.name : null

  if (adminAuth && uid && (!email || !displayName)) {
    try {
      const userRecord = await adminAuth.getUser(uid)
      email = email || userRecord.email || null
      displayName = displayName || userRecord.displayName || null
    } catch {
      // keep token-only fields
    }
  }
  if (uid && (!email || !displayName)) {
    try {
      const db = getFirebaseAdminDb()
      if (db) {
        const snap = await db.collection('users').doc(uid).get()
        const data = snap.exists ? snap.data() : null
        if (data && typeof data === 'object') {
          const profileEmail = typeof data.email === 'string' ? data.email.trim() : ''
          const profileName = typeof data.displayName === 'string' ? data.displayName.trim() : ''
          email = email || profileEmail || null
          displayName = displayName || profileName || null
        }
      }
    } catch {
      // ignore profile lookup failures
    }
  }
  return { uid, email, displayName }
}

/**
 * Best-effort identity for telemetry when starting scans (optional Bearer token).
 * Enriches ID-token claims with Firebase Auth user record when email/displayName are missing.
 * @deprecated Prefer authenticateRequest + buildTriggeredByProfile for secured routes.
 */
export async function resolveScanTriggeredBy(req) {
  const authResult = await authenticateRequest(req)
  if (!authResult.ok) return null
  return buildTriggeredByProfile(authResult)
}

export async function authorizeAdminRequest(req) {
  const authResult = await authenticateRequest(req)
  if (!authResult.ok) return authResult

  const db = getFirebaseAdminDb()
  if (!db) {
    return {
      ok: false,
      status: 503,
      error: 'Firebase Admin Firestore is unavailable.',
      reasonCode: 'AUTH_REQUIRED',
    }
  }

  const userDoc = await db.collection('users').doc(authResult.uid).get()
  const role = userDoc.exists ? userDoc.data()?.role : null
  const claimAdmin = authResult.claims?.admin === true
  if (role !== 'admin' && !claimAdmin) {
    return {
      ok: false,
      status: 403,
      error: 'Admin access required.',
      reasonCode: 'ADMIN_REQUIRED',
      uid: authResult.uid,
    }
  }
  return { ok: true, uid: authResult.uid, role: role || 'admin' }
}
