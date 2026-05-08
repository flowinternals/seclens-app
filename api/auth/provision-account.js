import { randomBytes } from 'crypto'
import { corsHeaders } from '../../lib/server/cors.js'
import { rateLimit } from '../../lib/server/rateLimit.js'
import { enforceProductionAccessGuard } from '../../lib/server/productionAccessGuard.js'
import { getFirebaseAdminAuth, getFirebaseAdminDb } from '../../lib/server/firebaseAdmin.js'

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function createTempPassword() {
  return `${randomBytes(18).toString('base64url')}Aa1!`
}

async function upsertUserProfileDoc(db, user) {
  if (!db || !user?.uid) return

  const ref = db.collection('users').doc(user.uid)
  const snapshot = await ref.get()
  const existing = snapshot.exists ? snapshot.data() || {} : {}

  await ref.set(
    {
      uid: user.uid,
      email: user.email || existing.email || '',
      displayName: user.displayName || existing.displayName || '',
      role: existing.role || 'user',
      updatedAt: new Date(),
      ...(snapshot.exists ? {} : { createdAt: new Date() }),
    },
    { merge: true }
  )
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || req.headers?.['origin']
  const headers = corsHeaders(origin)
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== 'Access-Control-Allow-Origin' || value) {
      res.setHeader(key, value)
    }
  })
  const isOriginAllowed = Boolean(headers['Access-Control-Allow-Origin'])

  if (!enforceProductionAccessGuard({ req, res, origin, isOriginAllowed })) {
    return
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const limiter = rateLimit(req, 10, 60 * 60 * 1000)
  if (!limiter.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((limiter.resetTime - Date.now()) / 1000),
    })
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required.' })
  }

  const adminAuth = getFirebaseAdminAuth()
  if (!adminAuth) {
    return res.status(503).json({ error: 'Firebase Admin is not configured.' })
  }
  const adminDb = getFirebaseAdminDb()

  try {
    let user = null
    try {
      user = await adminAuth.getUserByEmail(email)
    } catch (error) {
      if (String(error?.code || '') !== 'auth/user-not-found') {
        throw error
      }
    }

    if (!user) {
      user = await adminAuth.createUser({
        email,
        emailVerified: false,
        password: createTempPassword(),
      })
    }

    // Ensure user profile exists in Firestore even before first sign-in.
    await upsertUserProfileDoc(adminDb, user)

    return res.status(200).json({
      ok: true,
      message: 'Account provisioned. Continue with password reset email step.',
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to provision account.',
      ...(process.env.NODE_ENV === 'development' && { details: String(error?.message || error) }),
    })
  }
}
