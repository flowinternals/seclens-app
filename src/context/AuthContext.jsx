import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebaseClient'
import {
  ensureUserProfile,
  registerWithEmail,
  sendResetEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
} from '../lib/authService'

const AuthContext = createContext(null)
const adminEmailAllowlist = new Set(
  String(import.meta.env?.VITE_ADMIN_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
)

function isFirestoreOfflineError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code.includes('unavailable') || message.includes('client is offline')
}

function isFirestorePermissionError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code.includes('permission-denied') || message.includes('insufficient permissions')
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [adminClaim, setAdminClaim] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        setProfile(null)
        setAdminClaim(false)
        setIsLoading(false)
        return
      }

      try {
        const tokenResult = await nextUser.getIdTokenResult(true)
        setAdminClaim(tokenResult?.claims?.admin === true)
        await ensureUserProfile(nextUser)
        const profileSnap = await getDoc(doc(db, 'users', nextUser.uid))
        setProfile(profileSnap.exists() ? profileSnap.data() : { uid: nextUser.uid, role: 'user' })
      } catch (error) {
        if (isFirestoreOfflineError(error)) {
          console.warn('[auth] Firestore unavailable, using fallback profile.')
        } else if (isFirestorePermissionError(error)) {
          console.warn(
            '[auth] Firestore profile sync denied by rules (read or write). Using token/email fallback. Deploy updated firestore.rules if this persists.'
          )
        } else {
          console.error('[auth] profile load failed:', error)
        }
        try {
          const fallbackTokenResult = await nextUser.getIdTokenResult()
          setAdminClaim(fallbackTokenResult?.claims?.admin === true)
        } catch {
          setAdminClaim(false)
        }
        setProfile({ uid: nextUser.uid, role: 'user' })
      } finally {
        setIsLoading(false)
      }
    })

    return () => unsubscribe()
  }, [])

  const value = useMemo(
    () => {
      const normalizedEmail = String(user?.email || '').trim().toLowerCase()
      const emailAllowlistAdmin = normalizedEmail ? adminEmailAllowlist.has(normalizedEmail) : false
      const isAdmin = profile?.role === 'admin' || adminClaim || emailAllowlistAdmin
      return {
      user,
      profile,
      role: isAdmin ? 'admin' : 'user',
      isLoading,
      isAuthenticated: Boolean(user),
      isAdmin,
      signInWithGoogle,
      signInWithEmail,
      registerWithEmail,
      sendResetEmail,
      signOutUser,
      async getIdToken(forceRefresh = false) {
        if (!auth.currentUser) return null
        return auth.currentUser.getIdToken(forceRefresh)
      },
      }
    },
    [user, profile, adminClaim, isLoading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return ctx
}
