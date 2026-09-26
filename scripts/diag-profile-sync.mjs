/**
 * Isolate post-docs sync hang: profile + surface + select only (no network after tree).
 */
import { readFileSync } from 'fs'
import { probeGithubRepositoryAccess, fetchRepositoryContent } from '../lib/server/github.js'
import { inferRepoProfileFromPaths } from '../lib/shared/repoProfile.js'
import { enrichRepoProfileWithDocumentation, pickDocumentationPaths } from '../lib/shared/repoProfileDocs.js'
import { buildSecuritySurfacePlan } from '../lib/server/securitySurfaceTargets.js'
import { classifyRepoPath, selectPathsByTiers, sortPathsDeterministic } from '../lib/server/fileSelection.js'
import { countEligibleByTier } from '../lib/server/repoInventory.js'

function loadToken() {
  const raw = readFileSync('D:/Assets/flowinternals-seclens-app-Assets/security/secrets/github.txt', 'utf8')
  return raw.match(/\b(ghp_[A-Za-z0-9]+)\b/)[1]
}

function time(label, fn) {
  const t0 = Date.now()
  const result = fn()
  console.log(`${label} ${Date.now() - t0}ms`)
  return result
}

const token = loadToken()
const meta = await probeGithubRepositoryAccess('https://github.com/flowinternals/spekify-app', {
  githubToken: token,
})
const treeResp = await meta.fetchWithAuth(
  `https://api.github.com/repos/${meta.owner}/${meta.repo}/git/trees/${meta.apiDefaultBranch}?recursive=1`
)
// resolve sha properly
const refResp = await meta.fetchWithAuth(
  `https://api.github.com/repos/${meta.owner}/${meta.repo}/git/ref/heads/${meta.apiDefaultBranch}`
)
const refJson = await refResp.json()
const sha = refJson.object?.sha
const treeResp2 = await meta.fetchWithAuth(
  `https://api.github.com/repos/${meta.owner}/${meta.repo}/git/trees/${sha}?recursive=1`
)
const treePayload = await treeResp2.json()
const blobPaths = sortPathsDeterministic(
  (treePayload.tree || []).filter((t) => t.type === 'blob').map((t) => t.path)
)
console.log('blobs', blobPaths.length)

const docPaths = pickDocumentationPaths(blobPaths)
console.log('docs', docPaths)
const pathTextByPath = {}
for (const p of docPaths) {
  const encoded = p.split('/').map(encodeURIComponent).join('/')
  const r = await meta.fetchWithAuth(
    `https://api.github.com/repos/${meta.owner}/${meta.repo}/contents/${encoded}?ref=${sha}`
  )
  const j = await r.json()
  if (j.content && j.encoding === 'base64') {
    const text = Buffer.from(j.content.replace(/\n/g, ''), 'base64').toString('utf8')
    pathTextByPath[p] = text
    console.log('loaded', p, 'chars', text.length)
  }
}

const heartbeat = setInterval(() => console.log('hb', Date.now()), 1000)
try {
  const base = time('inferRepoProfileFromPaths', () =>
    inferRepoProfileFromPaths(blobPaths, meta.ghRepo.language || '')
  )
  const profile = time('enrichRepoProfileWithDocumentation', () =>
    enrichRepoProfileWithDocumentation(base, pathTextByPath, docPaths, meta.ghRepo.description || '')
  )
  const plan = time('buildSecuritySurfacePlan', () => buildSecuritySurfacePlan(blobPaths, profile))
  console.log('critical', plan.criticalShortlist.length)
  time('countEligibleByTier', () =>
    countEligibleByTier(blobPaths, (p) => {
      const c = classifyRepoPath(p, { repoProfile: profile })
      return { tier: c.tier, omit: !!c.omit }
    })
  )
  const sel = time('selectPathsByTiers', () =>
    selectPathsByTiers(blobPaths, 900, { repoProfile: profile, securitySurfacePlan: plan })
  )
  console.log('selected', sel.selected.length)
} finally {
  clearInterval(heartbeat)
}
