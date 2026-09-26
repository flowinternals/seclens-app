import fs from 'fs'
import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { gunzipSync } from 'zlib'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v
}

const sa = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
}
if (!getApps().length) {
  initializeApp({
    credential: cert(sa),
    projectId: sa.projectId,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  })
}

const uid = 'plzJH7pldlU5d6TIyvTpqu6JjkI2'
const runId = 'd2059836-4344-4d82-ac51-b5ce7bc30c35'
const meta = (await getFirestore().collection('users').doc(uid).collection('scanHistory').doc(runId).get()).data()
const [buf] = await getStorage()
  .bucket(process.env.VITE_FIREBASE_STORAGE_BUCKET)
  .file(meta.artifact.storagePath)
  .download()
const art = JSON.parse(gunzipSync(buf).toString('utf8'))
const dims = art.dashboard?.dimensions || []
const flagged = dims.filter(
  (d) =>
    d.status === 'attention' ||
    d.progress === 'partial' ||
    d.status === 'failed' ||
    d.status === 'review_needed'
)

for (const d of flagged) {
  console.log('\n###', d.dimensionId || d.id, '|', d.label, '| status=' + d.status, '| progress=' + d.progress)
  const snippet = d.summary || d.statusReason || d.rationale || d.whatWeFound || ''
  console.log('summary:', String(snippet).slice(0, 500))
  const keys = Object.keys(d).sort()
  console.log('keys:', keys.join(', '))
  for (const r of (d.recommendations || []).slice(0, 5)) {
    console.log(
      '- rec[' + (r.severity || '?') + ']:',
      String(r.title || r.summary || r.recommendation || r.text || JSON.stringify(r)).slice(0, 260)
    )
  }
  for (const u of (d.unverifiedControls || []).slice(0, 5)) {
    console.log('- unverified:', String(u.name || u.id || u.title || u.control || JSON.stringify(u)).slice(0, 200))
  }
  for (const o of (d.observedControls || []).slice(0, 3)) {
    console.log('- observed:', String(o.name || o.id || o.title || o.control || JSON.stringify(o)).slice(0, 200))
  }
  if (d.coverage) console.log('coverage:', JSON.stringify(d.coverage))
  if (d.confidence != null) console.log('confidence:', d.confidence)
}

const report = String(art.report || '')
const lines = report.split(/\n/)
console.log('\n=== REPORT HEAD ===')
console.log(lines.slice(0, 80).join('\n'))
console.log('\n=== MATCHING LINES ===')
for (let i = 0; i < lines.length; i++) {
  if (/needs additional|attention|gap|fail|partial|unverified|pre-launch|risk/i.test(lines[i])) {
    console.log(i + 1 + ': ' + lines[i])
  }
}
console.log('\n=== DASHBOARD SUMMARY ===')
console.log(JSON.stringify(art.dashboard?.summary || null, null, 2)?.slice(0, 2500))
