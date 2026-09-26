/**
 * Timed diagnosis of fetchRepositoryContent for spekify-app (no secrets printed).
 */
import { readFileSync } from 'fs'
import { fetchRepositoryContent } from '../lib/server/github.js'

function loadSpekifyToken() {
  const raw = readFileSync(
    'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/github.txt',
    'utf8'
  )
  const m = raw.match(/flowinternals\/spekify-app[\s\S]*?\b(ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/)
  const tok = m?.[1] || raw.match(/\b(ghp_[A-Za-z0-9]+)\b/)?.[1]
  if (!tok) throw new Error('No spekify PAT found in github.txt')
  return tok
}

const token = loadSpekifyToken()
const url = 'https://github.com/flowinternals/spekify-app'
console.log('start fetch', new Date().toISOString())
const t0 = Date.now()
let lastPhase = 'init'
const heartbeat = setInterval(() => {
  console.log(
    `heartbeat +${((Date.now() - t0) / 1000).toFixed(1)}s phase=${lastPhase} rssMB=${(process.memoryUsage().rss / 1e6).toFixed(0)}`
  )
}, 2000)

try {
  const data = await fetchRepositoryContent(url, {
    githubToken: token,
    onPhase: (phase, extra) => {
      lastPhase = phase
      console.log(`phase +${((Date.now() - t0) / 1000).toFixed(1)}s ${phase}`, extra || '')
    },
  })
  clearInterval(heartbeat)
  const files = data?.files || data?.evidenceBundle?.files || []
  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedMs: Date.now() - t0,
        fileCount: Array.isArray(files) ? files.length : null,
        selected: data?.coverage?.selectedFileCount ?? data?.evidenceBundle?.coverage?.selectedFileCount,
        notes: data?.coverage?.notes || data?.evidenceBundle?.coverage?.notes || null,
      },
      null,
      2
    )
  )
} catch (err) {
  clearInterval(heartbeat)
  console.error('FAILED at', lastPhase, err instanceof Error ? err.message : err)
  console.error('elapsedMs', Date.now() - t0)
  process.exit(1)
}
