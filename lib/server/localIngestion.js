/**
 * MVP4 Stage 02 — local working-tree ingestion (same bundle shape as GitHub path).
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, relative } from 'path'

import { getIngestionCaps } from './ingestionCaps.js'
import {
  classifyRepoPath,
  selectPathsByTiers,
  selectionMetaRowIsExpansionAnchor,
  sortPathsDeterministic,
} from './fileSelection.js'
import { countEligibleByTier } from './repoInventory.js'
import { buildEvidenceBundle } from './evidenceBundle.js'

function stripJsonComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function detectAliasRootsFromConfigTexts(configTexts) {
  const roots = new Set()
  for (const raw of configTexts) {
    if (!raw || !raw.trim()) continue
    let parsed
    try {
      parsed = JSON.parse(stripJsonComments(raw))
    } catch {
      continue
    }
    const compilerOptions = parsed?.compilerOptions || {}
    const paths = compilerOptions?.paths || {}
    const candidates = paths['@/*']
    if (!Array.isArray(candidates)) continue
    for (const c of candidates) {
      const v = String(c || '').trim()
      if (v === './*' || v === '*') roots.add('')
      if (v === 'src/*' || v === './src/*') roots.add('src')
    }
  }
  return [...roots]
}

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
  const initialPlan = selectPathsByTiers(blobPaths, caps.maxFiles)
  const anchorPaths = initialPlan.selectionMeta.filter(selectionMetaRowIsExpansionAnchor).map((s) => s.path)
  const workflowPaths = initialPlan.selectionMeta
    .filter((s) => s.reason === 'tier1_priority' && /\.github\/workflows\/.+\.ya?ml$/i.test(s.path))
    .map((s) => s.path)
  const configPaths = blobPaths.filter((p) => /(^|\/)(tsconfig(\.[^/]+)?|jsconfig)\.json$/i.test(p))

  const pathTextByPath = {}
  for (const rel of [...new Set([...anchorPaths, ...workflowPaths, ...configPaths])]) {
    try {
      const abs = join(repoRootAbs, ...rel.split('/'))
      const text = readFileSync(abs, 'utf8')
      if (text && !text.includes('\uFFFD')) {
        pathTextByPath[rel] = text
      }
    } catch {
      // Best effort only.
    }
  }

  const aliasAtRoots = detectAliasRootsFromConfigTexts(
    configPaths.map((p) => pathTextByPath[p]).filter(Boolean)
  )
  const selectionPlan = selectPathsByTiers(blobPaths, caps.maxFiles, { pathTextByPath, aliasAtRoots })
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
      ...(s.linkedAnchorPath ? { linkedAnchorPath: s.linkedAnchorPath } : {}),
      ...(s.reservedDomain ? { reservedDomain: s.reservedDomain } : {}),
    })),
    omitted: [...tierOmissions, ...readOmissions].map((o) => ({
      path: o.path,
      reason: o.reason,
    })),
    selectedReasonCounts: selectionPlan.selectedReasonCounts,
    anchorCount: selectionPlan.anchorCount,
    relatedContextCount: selectionPlan.relatedContextCount,
    backfillCount: selectionPlan.backfillCount,
    domainReservationCount: selectionPlan.domainReservationCount ?? 0,
    domainReservationByDomain: selectionPlan.domainReservationByDomain ?? {},
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
