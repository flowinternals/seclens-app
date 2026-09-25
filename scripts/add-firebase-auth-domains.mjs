import dotenv from 'dotenv'
import { GoogleAuth } from 'google-auth-library'

dotenv.config({ path: '.env.local' })

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
let privateKey = process.env.FIREBASE_PRIVATE_KEY || ''
if (
  (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
  (privateKey.startsWith("'") && privateKey.endsWith("'"))
) {
  privateKey = privateKey.slice(1, -1)
}
privateKey = privateKey.replace(/\\n/g, '\n')

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE admin env (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY)')
  process.exit(1)
}

const needed = process.argv.slice(2)
if (!needed.length) {
  console.error('Usage: node scripts/add-firebase-auth-domains.mjs <domain> [domain...]')
  process.exit(1)
}

const auth = new GoogleAuth({
  credentials: { client_email: clientEmail, private_key: privateKey },
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/identitytoolkit',
  ],
})
const client = await auth.getClient()
const { token } = await client.getAccessToken()

const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`
const getRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
const config = await getRes.json()
if (!getRes.ok) {
  console.error('GET failed', getRes.status, config)
  process.exit(1)
}

const existing = config.authorizedDomains || []
console.log('Current authorizedDomains:', existing.join(', '))

const merged = [...new Set([...existing, ...needed])]
const toAdd = needed.filter((d) => !existing.includes(d))
if (!toAdd.length) {
  console.log('All required domains already authorized')
  process.exit(0)
}

const patchRes = await fetch(`${url}?updateMask=authorizedDomains`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ authorizedDomains: merged }),
})
const patched = await patchRes.json()
if (!patchRes.ok) {
  console.error('PATCH failed', patchRes.status, patched)
  process.exit(1)
}

console.log('Updated authorizedDomains:', (patched.authorizedDomains || []).join(', '))
console.log('Added:', toAdd.join(', '))
