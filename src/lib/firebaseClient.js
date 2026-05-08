import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, initializeFirestore } from 'firebase/firestore'

function getFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  }
}

function validateConfig(config) {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId']
  const missing = required.filter((key) => !String(config[key] || '').trim())
  if (missing.length) {
    throw new Error(`Missing Firebase client config keys: ${missing.join(', ')}`)
  }
}

const firebaseConfig = getFirebaseConfig()
validateConfig(firebaseConfig)

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
const FIRESTORE_OPTIONS = {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
}
const FIRESTORE_SINGLETON_KEY = '__seclens_firestore_singleton__'

function getOrCreateFirestore(app) {
  const globalStore = globalThis
  if (globalStore[FIRESTORE_SINGLETON_KEY]) {
    return globalStore[FIRESTORE_SINGLETON_KEY]
  }
  try {
    const initialized = initializeFirestore(app, FIRESTORE_OPTIONS)
    globalStore[FIRESTORE_SINGLETON_KEY] = initialized
    return initialized
  } catch (error) {
    const message = String(error?.message || '')
    if (message.includes('initializeFirestore() has already been called')) {
      const existing = getFirestore(app)
      globalStore[FIRESTORE_SINGLETON_KEY] = existing
      return existing
    }
    throw error
  }
}

export const auth = getAuth(firebaseApp)
export const db = getOrCreateFirestore(firebaseApp)
export { firebaseApp }
