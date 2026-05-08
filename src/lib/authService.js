import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from './firebaseClient'

const googleProvider = new GoogleAuthProvider()
const USER_ROLE = 'user'

/** Normalize Firestore / legacy role strings so Console typos like "Admin" still match. */
function roleFromFirestoreField(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  return normalized === 'admin' ? 'admin' : USER_ROLE
}

function shouldFallbackToRedirect(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    message.includes('Cross-Origin-Opener-Policy')
  )
}

async function ensureUserProfileBestEffort(user) {
  try {
    await ensureUserProfile(user)
  } catch (error) {
    // Do not block successful auth when Firestore is temporarily unreachable.
    console.warn('[auth] profile upsert skipped:', error)
  }
}

export async function ensureUserProfile(user) {
  if (!user?.uid) return null
  const tokenResult = await user.getIdTokenResult(true).catch(() => null)
  const adminFromClaim = tokenResult?.claims?.admin === true

  const ref = doc(db, 'users', user.uid)
  const snapshot = await getDoc(ref)

  if (snapshot.exists()) {
    const storedUid = snapshot.data()?.uid
    if (storedUid && storedUid !== user.uid) {
      console.error(
        '[auth] Firestore users document ID must match Authentication UID. The app reads `users/{auth.uid}`; a `uid` field inside the doc does not grant access. Fix: create or move the profile so the document ID equals this user\'s Auth UID.',
        { authUid: user.uid, documentUidField: storedUid }
      )
    }
  }

  if (!snapshot.exists()) {
    const initialRole = adminFromClaim ? 'admin' : USER_ROLE
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      role: initialRole,
      providerIds: Array.isArray(user.providerData) ? user.providerData.map((p) => p?.providerId).filter(Boolean) : [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    const created = await getDoc(ref)
    return created.data() || null
  }

  const existing = snapshot.data() || {}
  const storedRole = roleFromFirestoreField(existing.role)
  const mergedRole = storedRole === 'admin' || adminFromClaim ? 'admin' : USER_ROLE
  await setDoc(
    ref,
    {
      email: user.email || existing.email || '',
      displayName: user.displayName || existing.displayName || '',
      role: mergedRole,
      providerIds: Array.isArray(user.providerData)
        ? user.providerData.map((p) => p?.providerId).filter(Boolean)
        : existing.providerIds || [],
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
  const updated = await getDoc(ref)
  return updated.data() || null
}

export async function signInWithGoogle() {
  try {
    const credential = await signInWithPopup(auth, googleProvider)
    await ensureUserProfileBestEffort(credential.user)
    return credential.user
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      await signInWithRedirect(auth, googleProvider)
      return null
    }
    throw error
  }
}

export async function signInWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  await ensureUserProfileBestEffort(credential.user)
  return credential.user
}

async function sendResetEmailWithRetry(email) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await sendPasswordResetEmail(auth, email)
      return
    } catch (error) {
      lastError = error
      const code = String(error?.code || '')
      if (code === 'auth/user-not-found' && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
        continue
      }
      throw error
    }
  }
  if (lastError) throw lastError
}

export async function registerWithEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  const response = await fetch('/api/auth/provision-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to provision account (${response.status})`)
  }

  await sendResetEmailWithRetry(normalizedEmail)
  return { email: normalizedEmail }
}

export async function sendResetEmail(email) {
  await sendPasswordResetEmail(auth, email)
}

export async function signOutUser() {
  await signOut(auth)
}
