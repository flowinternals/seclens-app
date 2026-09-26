#!/usr/bin/env node
/**
 * Ensure the permanent Firebase e2e regression user exists (create or update password).
 * Credentials source (first match):
 *   1. SECLENS_E2E_FIREBASE_EMAIL / SECLENS_E2E_FIREBASE_PASSWORD env
 *   2. SECLENS_E2E_FIREBASE_CREDS_FILE
 *   3. Assets security/secrets/e2e-firebase.txt (canonical)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const DEFAULT_CREDS =
  'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/e2e-firebase.txt'
const DEFAULT_SA =
  'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/seclens-app-firebase-adminsdk-fbsvc-169ba2a846.json'

function parseCredsFile(path) {
  const raw = readFileSync(path, 'utf8')
  const email = raw.match(/SECLENS_E2E_FIREBASE_EMAIL\s*=\s*(\S+)/)?.[1]?.trim()
  const password = raw.match(/SECLENS_E2E_FIREBASE_PASSWORD\s*=\s*(\S+)/)?.[1]?.trim()
  if (!email || !password) {
    throw new Error(`Missing email/password in ${path}`)
  }
  return { email, password, source: path }
}

function loadPermanentCreds() {
  if (process.env.SECLENS_E2E_FIREBASE_EMAIL && process.env.SECLENS_E2E_FIREBASE_PASSWORD) {
    return {
      email: process.env.SECLENS_E2E_FIREBASE_EMAIL.trim(),
      password: process.env.SECLENS_E2E_FIREBASE_PASSWORD,
      source: 'env',
    }
  }
  const path = process.env.SECLENS_E2E_FIREBASE_CREDS_FILE || DEFAULT_CREDS
  if (!existsSync(path)) {
    throw new Error(
      `Permanent e2e Firebase creds file not found: ${path}. Create Assets/security/secrets/e2e-firebase.txt`
    )
  }
  return parseCredsFile(path)
}

const saPath = process.env.SECLENS_FIREBASE_SA_PATH || DEFAULT_SA
const sa = JSON.parse(readFileSync(saPath, 'utf8'))
if (!getApps().length) {
  initializeApp({ credential: cert(sa), projectId: sa.project_id })
}

const { email, password, source } = loadPermanentCreds()
const auth = getAuth()
const existing = await auth.getUserByEmail(email).catch(() => null)
if (existing) {
  await auth.updateUser(existing.uid, { password, emailVerified: true, disabled: false })
  console.log(`OK updated permanent e2e user uid=${existing.uid} email=${email} source=${source}`)
} else {
  const created = await auth.createUser({
    email,
    password,
    emailVerified: true,
    disabled: false,
    displayName: 'SecLens E2E SPO Oracle',
  })
  console.log(`OK created permanent e2e user uid=${created.uid} email=${email} source=${source}`)
}

// Mirror into gitignored local run folder for convenience (same permanent values).
const outDir = resolve(repoRoot, '.seclens-live-validation', 'spo-oracle')
mkdirSync(outDir, { recursive: true })
writeFileSync(
  resolve(outDir, '_e2e-creds.env'),
  [`SECLENS_E2E_FIREBASE_EMAIL=${email}`, `SECLENS_E2E_FIREBASE_PASSWORD=${password}`, ''].join('\n'),
  'utf8'
)
