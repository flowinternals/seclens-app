/**
 * MVP4 Stage 02 — local working-tree ingestion (same bundle shape as GitHub path).
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, relative } from 'path'

import { getIngestionCaps } from './ingestionCaps.js'
import { classifyRepoPath, selectPathsByTiers, sortPathsDeterministic } from './fileSelection.js'
import { countEligibleByTier } from './repoInventory.js'
import { buildEvidenceBundle } from './evidenceBundle.js'

function walkFilesRecursive(dirAbs, baseAbs, out) {
  for (const ent of readdirSync(dirAbs, { withFileTypes: true })) {
    if (ent.name === '.git') continue
    const abs = join(dirAbs, ent.name)
    if (ent.isDirectory()) {
      walkFilesRecursive(abs, baseAbs, out)
    } else if (ent.isFile()) {
      out.push(relative(baseAbs, abs).replace(/\\/g, '/'))
    }
  }
}

/**
 * @param {string} repoRootAbs absolute path to repository root
 * @param {{ displayName?: string }} [opts]
 */
export function buildLocalEvidenceSnapshot(repoRootAbs, opts = {}) {
  const caps = getIngestionCaps()
  if (!existsSync(repoRootAbs)) {
    throw new Error(`Repository root does not exist: ${repoRootAbs}`)
  }

  /** @type {string[]} */
  const relPaths = []
  walkFilesRecursive(repoRootAbs, repoRootAbs, relPaths)

  let blobPaths = sortPathsDeterministic(relPaths)

  let treeSizeCapHit = false
  if (blobPaths.length > caps.maxTreeEntries) {
    blobPaths = blobPaths.slice(0, caps.maxTreeEntries)
    treeSizeCapHit = true
  }

  function classifyInv(p) {
    const c = classifyRepoPath(p)
    return { tier: c.tier, omit: !!c.omit }
  }

  const inventoryCounts = countEligibleByTier(blobPaths, classifyInv)
  const selectionPlan = selectPathsByTiers(blobPaths, caps.maxFiles)
  const tierOmissions = selectionPlan.omitted.map((o) => ({ ...o }))
  const tierFileCapReached = tierOmissions.some((o) => o.reason === 'cap')

  /** @type {Array<{ path: string, content: string }>} */
  const orderedFiles = []
  /** @type {Array<{ path: string, reason: string }>} */
  const readOmissions = []

  for (const sel of selectionPlan.selectionMeta) {
    try {
      const abs = join(repoRootAbs, ...sel.path.split('/'))
      const buf = readFileSync(abs)
      const content = buf.toString('utf8')
      if (buf.includes(0) || content.includes('\uFFFD')) {
        readOmissions.push({ path: sel.path, reason: 'binary' })
        continue
      }
      orderedFiles.push({ path: sel.path, content })
    } catch {
      readOmissions.push({ path: sel.path, reason: 'unsupported' })
    }
  }

  const label = opts.displayName || 'local-working-tree'

  const selectionForBundle = {
    selected: selectionPlan.selectionMeta.map((s) => ({
      path: s.path,
      tier: s.tier,
      reason: s.reason,
    })),
    omitted: [...tierOmissions, ...readOmissions].map((o) => ({
      path: o.path,
      reason: o.reason,
    })),
  }

  const { bundle, apiIngestion } = buildEvidenceBundle(
    {
      owner: 'local',
      name: label,
      defaultBranch: label,
      scannedRef: label,
      scannedSha: undefined,
      url: `file://${repoRootAbs.replace(/\\/g, '/')}`,
    },
    {
      totalFilesSeen: inventoryCounts.totalFilesSeen,
      filesEligibleByTier: inventoryCounts.filesEligibleByTier,
    },
    selectionForBundle,
    orderedFiles,
    caps,
    {
      treeTruncated: treeSizeCapHit,
      refResolutionDegraded: false,
      tierFileCapReached,
    }
  )

  if (treeSizeCapHit) {
    bundle.coverage.maxTreeSizeCapHit = true
    bundle.coverage.notes.push(`Local walk capped at ${caps.maxTreeEntries} paths.`)
  }

  return { bundle, apiIngestion, caps }
}
