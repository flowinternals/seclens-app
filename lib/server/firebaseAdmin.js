import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

function parseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (rawJson) {
    try {
      return JSON.parse(rawJson)
    } catch (error) {
      console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON parse failed:', error)
      return null
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKeyRaw) {
    return null
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
  }
}

function resolveStorageBucketName() {
  return (
    String(process.env.FIREBASE_STORAGE_BUCKET || '').trim() ||
    String(process.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim() ||
    ''
  )
}

function getAdminApp() {
  if (getApps().length) {
    return getApps()[0]
  }
  const serviceAccount = parseServiceAccount()
  if (!serviceAccount) {
    return null
  }
  const storageBucket = resolveStorageBucketName() || undefined
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId,
    ...(storageBucket ? { storageBucket } : {}),
  })
}

export function hasFirebaseAdmin() {
  return Boolean(getAdminApp())
}

export function getFirebaseAdminAuth() {
  const app = getAdminApp()
  if (!app) return null
  return getAuth(app)
}

export function getFirebaseAdminDb() {
  const app = getAdminApp()
  if (!app) return null
  return getFirestore(app)
}

/**
 * Private scan-history artifacts only (CR-010). Prefer FIREBASE_STORAGE_BUCKET;
 * falls back to VITE_FIREBASE_STORAGE_BUCKET for local parity with client config.
 */
export function getFirebaseAdminStorageBucket() {
  const app = getAdminApp()
  if (!app) return null
  const bucketName = resolveStorageBucketName()
  if (!bucketName) return null
  try {
    return getStorage(app).bucket(bucketName)
  } catch (error) {
    console.error('[firebase-admin] Storage bucket init failed:', error)
    return null
  }
}
