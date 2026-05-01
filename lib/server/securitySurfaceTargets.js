/**
 * DEFECT-003 — profile-driven security surface map + protected retrieval targets (CR-2.1-002/003).
 * Shortlist construction: profile/domain pass + optional import-graph / caller expansion (staged pipeline).
 * DEFECT-005 — layered enrichment: route/data-flow dimension boost, adjacent config/policy paths,
 * bounded content keyword signals (see enrich* exports and pickBoundedKeywordScanCandidates).
 */

import { DIMENSION_CATALOG } from '../shared/dimensions.js'
import { buildDimensionApplicability } from '../shared/repoProfile.js'
import { normalizeRepoPath } from './repoInventory.js'
import {
  classifyRepoPath,
  classifySelectionDomain,
  isCallableAuthAdminModulePath,
  isRouteAnchorPath,
  sortPathsDeterministic,
} from './fileSelection.js'
import { parseImportSpecifiers, resolveImportToRepoPath } from './jsImportResolve.js'

/** Maps CR-008 selection domains to launch-readiness dimension ids. */
const DOMAIN_TO_DIMENSION = Object.freeze({
  auth_session: 'auth_session_authorization',
  invite_token_claims: 'invite_token_claims',
  validation: 'validation_input_trust_boundaries',
  rate_limit: 'rate_limiting_abuse_controls',
  middleware_headers: 'validation_input_trust_boundaries',
  cicd: 'cicd_secrets_deployment',
  config_policy: 'config_policy_rules',
  data_store: 'data_access_persistence',
  client_auth_bridge: 'client_auth_bridge_frontend_guarding',
})

function pathSortKey(path) {
  return String(path || '').replace(/\\/g, '/').toLowerCase()
}

function dimensionSurfaceApplicable(repoProfile, dimensionId) {
  const a = buildDimensionApplicability({
    dimensionId,
    repoProfile,
    reviewedFileCount: 1,
    runtimeProgress: 'ready',
  })
  return a.status !== 'not_applicable'
}

/** @param {Record<string, string[]>} buckets */
function cloneSurfaceBuckets(buckets) {
  /** @type {Record<string, string[]>} */
  const out = {}
  for (const d of DIMENSION_CATALOG) {
    out[d.id] = [...(buckets[d.id] || [])]
  }
  return out
}

/**
 * Dimension ids that apply to this path from callable heuristics + selection domain.
 * @returns {string[]}
 */
/** Route / handler anchors: ensure import-graph expansion can reach validation + persistence layers (DEFECT-005). */
const ROUTE_DATAFLOW_DIMENSION_BOOST = Object.freeze([
  'validation_input_trust_boundaries',
  'data_access_persistence',
])

function dimensionsForRepoPath(path, repoProfile) {
  const out = []
  if (isCallableAuthAdminModulePath(path)) {
    const id = 'auth_session_authorization'
    if (dimensionSurfaceApplicable(repoProfile, id)) out.push(id)
  }
  const dom = classifySelectionDomain(path)
  if (dom && DOMAIN_TO_DIMENSION[dom]) {
    const dimensionId = DOMAIN_TO_DIMENSION[dom]
    if (dimensionSurfaceApplicable(repoProfile, dimensionId)) out.push(dimensionId)
  }
  if (isRouteAnchorPath(path)) {
    for (const id of ROUTE_DATAFLOW_DIMENSION_BOOST) {
      if (dimensionSurfaceApplicable(repoProfile, id)) out.push(id)
    }
  }
  return [...new Set(out)]
}

/**
 * @param {string} path
 * @param {object} repoProfile
 * @param {Record<string, string[]>} surfacePathsByDimension
 * @param {string[]} [inheritedDimensionIds] from import-graph / caller expansion when the path has no direct domain hit
 * @returns {boolean} true if at least one dimension bucket was updated
 */
function assignPathToSurfaceBuckets(path, repoProfile, surfacePathsByDimension, inheritedDimensionIds = []) {
  const c = classifyRepoPath(path, { repoProfile })
  if (c.omit) return false

  const dims = new Set(dimensionsForRepoPath(path, repoProfile))
  const filteredInherited = (inheritedDimensionIds || []).filter((id) => dimensionSurfaceApplicable(repoProfile, id))
  for (const id of filteredInherited) dims.add(id)

  if (!dims.size) return false
  for (const dimensionId of dims) {
    const bucket = surfacePathsByDimension[dimensionId]
    if (!bucket.includes(path)) bucket.push(path)
  }
  return true
}

function rebuildCriticalShortlistFromBuckets(surfacePathsByDimension, repoProfile, criticalShortlistMax) {
  /** @type {{ path: string, tier: number }[]} */
  const priority = []
  const seen = new Set()
  for (const d of DIMENSION_CATALOG) {
    for (const p of surfacePathsByDimension[d.id] || []) {
      if (seen.has(p)) continue
      seen.add(p)
      const t = classifyRepoPath(p, { repoProfile }).tier || 3
      priority.push({ path: p, tier: t })
    }
  }
  priority.sort((a, b) => {
    const oa = isCallableAuthAdminModulePath(a.path) ? 0 : 1
    const ob = isCallableAuthAdminModulePath(b.path) ? 0 : 1
    if (oa !== ob) return oa - ob
    if (a.tier !== b.tier) return a.tier - b.tier
    return pathSortKey(a.path).localeCompare(pathSortKey(b.path))
  })

  const criticalShortlistTruncated =
    criticalShortlistMax != null && priority.length > criticalShortlistMax
  const criticalShortlist =
    criticalShortlistMax == null
      ? priority.map((x) => x.path)
      : priority.slice(0, criticalShortlistMax).map((x) => x.path)
  const protectedTargetPaths = criticalShortlist

  return {
    priority,
    criticalShortlist,
    protectedTargetPaths,
    criticalShortlistTruncated,
  }
}

/**
 * Pulls root-level config and policy artifacts into dimension buckets when related surfaces are active (DEFECT-005).
 * Uses direct bucket updates so paths like `prisma/schema.prisma` land in `data_access_persistence` even when
 * filename-only domain rules miss them.
 * @returns {number} count of new bucket entries (path added to a dimension list it was not already in)
 */
function applyAdjacentConfigPolicyPaths(blobPaths, repoProfile, surfacePathsByDimension) {
  let adds = 0
  const pathSet = new Set((blobPaths || []).map((raw) => normalizeRepoPath(raw)))
  /** @type {Set<string>} */
  const activeDims = new Set()
  for (const d of DIMENSION_CATALOG) {
    if ((surfacePathsByDimension[d.id] || []).length > 0) activeDims.add(d.id)
  }
  if (!activeDims.size) return 0

  const tryAdd = (relPath, dimensionId) => {
    const p = normalizeRepoPath(relPath)
    if (!pathSet.has(p)) return
    if (!dimensionSurfaceApplicable(repoProfile, dimensionId)) return
    const bucket = surfacePathsByDimension[dimensionId]
    if (!bucket.includes(p)) {
      bucket.push(p)
      adds++
    }
  }

  const anyData = activeDims.has('data_access_persistence')
  const anyAuthInvite = activeDims.has('auth_session_authorization') || activeDims.has('invite_token_claims')
  const anyValRate = activeDims.has('validation_input_trust_boundaries') || activeDims.has('rate_limiting_abuse_controls')
  const anyClient = activeDims.has('client_auth_bridge_frontend_guarding')

  if (anyValRate || anyData || anyAuthInvite || anyClient) {
    for (const f of ['vercel.json', 'netlify.toml', 'next.config.js', 'next.config.mjs', 'next.config.ts']) {
      tryAdd(f, 'config_policy_rules')
    }
  }
  if (anyData) {
    tryAdd('prisma/schema.prisma', 'data_access_persistence')
  }
  if (anyAuthInvite || anyData) {
    for (const f of ['.env.example', '.env.sample', '.env.template', '.env.local.example']) {
      tryAdd(f, 'cicd_secrets_deployment')
    }
    tryAdd('firebase.json', 'config_policy_rules')
    tryAdd('firestore.rules', 'config_policy_rules')
    tryAdd('storage.rules', 'config_policy_rules')
  }
  return adds
}

const SHORTLIST_HARD_CEILING = 50_000

/** Paths we read for import expansion (same family as selection-related reads). */
const SHORTLIST_SOURCE_EXT_RE = /\.(js|mjs|cjs|ts|tsx|jsx)$/i

/** Callers under these prefixes may be pulled in by reverse import expansion. */
const REVERSE_IMPORT_CALLER_PREFIX_RE =
  /^(src\/|api\/|lib\/|app\/|pages\/|server\/|functions\/src\/|services\/|packages\/[^/]+\/src\/)/i

/**
 * Optional abuse ceiling for the critical shortlist only. When unset, the shortlist is the full union of
 * profile-applicable surfaced paths (DEFECT-003: caps apply to backfill only, not to truncating this list).
 * Set `SECLENS_CRITICAL_SHORTLIST_MAX` or pass `opts.criticalShortlistMax` to enforce a hard ceiling.
 * @param {{ criticalShortlistMax?: number }} [opts]
 * @returns {{ max: number | null, fromOpts: boolean }}
 */
export function resolveCriticalShortlistMax(opts = {}) {
  if (Number.isFinite(opts.criticalShortlistMax)) {
    return {
      max: Math.min(Math.max(1, Math.floor(opts.criticalShortlistMax)), SHORTLIST_HARD_CEILING),
      fromOpts: true,
    }
  }
  const raw = process.env.SECLENS_CRITICAL_SHORTLIST_MAX
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) {
      return { max: Math.min(Math.floor(n), SHORTLIST_HARD_CEILING), fromOpts: false }
    }
  }
  return { max: null, fromOpts: false }
}

/**
 * Build a surface map and full critical shortlist for retrieval (DEFECT-003 two-phase: critical first, caps on backfill only).
 * @param {string[]} blobPaths
 * @param {object} repoProfile from inferRepoProfileFromPaths
 * @param {{ maxFiles?: number, criticalShortlistMax?: number }} [opts] maxFiles unused here (ingestion caps apply only in selectPathsByTiers backfill phase).
 */
export function buildSecuritySurfacePlan(blobPaths, repoProfile, opts = {}) {
  const { max: criticalShortlistMax } = resolveCriticalShortlistMax(opts)

  /** @type {Record<string, string[]>} */
  const surfacePathsByDimension = {}
  for (const d of DIMENSION_CATALOG) {
    surfacePathsByDimension[d.id] = []
  }

  for (const raw of blobPaths || []) {
    const path = normalizeRepoPath(raw)
    assignPathToSurfaceBuckets(path, repoProfile, surfacePathsByDimension)
  }

  const configPolicyAdds = applyAdjacentConfigPolicyPaths(blobPaths, repoProfile, surfacePathsByDimension)

  for (const id of Object.keys(surfacePathsByDimension)) {
    surfacePathsByDimension[id] = sortPathsDeterministic(surfacePathsByDimension[id])
  }

  const surfaceDiscoveredCounts = Object.fromEntries(
    DIMENSION_CATALOG.map((d) => [d.id, (surfacePathsByDimension[d.id] || []).length])
  )

  const rebuilt = rebuildCriticalShortlistFromBuckets(surfacePathsByDimension, repoProfile, criticalShortlistMax)

  return {
    surfacePathsByDimension,
    criticalShortlist: rebuilt.criticalShortlist,
    protectedTargetPaths: rebuilt.protectedTargetPaths,
    surfaceDiscoveredCounts,
    /** @type {number | null} null = no truncation (full surfaced union) */
    criticalShortlistMax: criticalShortlistMax,
    criticalShortlistTruncated: rebuilt.criticalShortlistTruncated,
    shortlistPipeline: {
      forwardImportExpansions: 0,
      reverseCallerExpansions: 0,
      configPolicyAdds,
      keywordSignalAdds: 0,
      rounds: 0,
    },
  }
}

/** Lightweight body signals for shortlist inclusion only (DEFECT-005). */
const KEYWORD_SIGNAL_RULES = Object.freeze([
  { re: /\b(localStorage|sessionStorage)\b/, dims: ['client_auth_bridge_frontend_guarding'] },
  { re: /\bprocess\.env\b/, dims: ['cicd_secrets_deployment', 'config_policy_rules'] },
  {
    re: /\b(verifyIdToken|getIdToken|getIdTokenResult|decodeJwt|onAuthStateChanged|getSession)\b/,
    dims: ['auth_session_authorization'],
  },
  {
    re: /\b(ownerId|tenantId|tenant_id|organizationId|orgId|rowLevelSecurity|\brls\b)\b/i,
    dims: ['data_access_persistence', 'auth_session_authorization'],
  },
  { re: /\b(rateLimit|throttle|429|Too Many Requests)\b/i, dims: ['rate_limiting_abuse_controls'] },
  { re: /\b(dangerouslySetInnerHTML|DOMPurify|sanitize|sanitise)\b/i, dims: ['validation_input_trust_boundaries'] },
])

/**
 * Deterministic bounded list of source files not yet on the surface map — fetch text for these before keyword enrichment.
 * @param {{ max?: number }} [opts]
 * @returns {string[]}
 */
export function pickBoundedKeywordScanCandidates(blobPaths, repoProfile, plan, opts = {}) {
  const max = Number.isFinite(opts.max) ? Math.max(0, Math.floor(opts.max)) : 360
  if (!max) return []
  const union = new Set()
  for (const d of DIMENSION_CATALOG) {
    for (const p of plan.surfacePathsByDimension[d.id] || []) union.add(normalizeRepoPath(p))
  }
  const out = []
  for (const raw of sortPathsDeterministic(blobPaths || [])) {
    const path = normalizeRepoPath(raw)
    const c = classifyRepoPath(path, { repoProfile })
    if (c.omit) continue
    if (!SHORTLIST_SOURCE_EXT_RE.test(path)) continue
    if (union.has(path)) continue
    out.push(path)
    if (out.length >= max) break
  }
  return out
}

/**
 * Adds files whose fetched bodies match bounded keyword / dangerous-pattern rules into applicable dimension buckets.
 * @param {ReturnType<typeof buildSecuritySurfacePlan>} plan
 * @param {{ maxScanBytes?: number }} [opts]
 */
export function enrichSecuritySurfacePlanWithKeywordSignalsFromTexts(
  blobPaths,
  repoProfile,
  plan,
  pathTextByPath,
  opts = {}
) {
  const maxScanBytes = Number.isFinite(opts.maxScanBytes) ? Math.max(256, Math.floor(opts.maxScanBytes)) : 14_000
  const getText = (p) => {
    if (!pathTextByPath) return ''
    if (pathTextByPath instanceof Map) return String(pathTextByPath.get(p) || '')
    return String(pathTextByPath[p] || '')
  }

  const eligibleSet = new Set()
  for (const raw of blobPaths || []) {
    const path = normalizeRepoPath(raw)
    const c = classifyRepoPath(path, { repoProfile })
    if (!c.omit) eligibleSet.add(path)
  }

  const buckets = cloneSurfaceBuckets(plan.surfacePathsByDimension)
  let keywordSignalAdds = 0
  const keys = sortPathsDeterministic(
    [...(pathTextByPath instanceof Map ? pathTextByPath.keys() : Object.keys(pathTextByPath || {}))].filter((p) =>
      eligibleSet.has(normalizeRepoPath(p))
    )
  )

  for (const p of keys) {
    const path = normalizeRepoPath(p)
    const text = getText(path).slice(0, maxScanBytes)
    if (!text) continue
    /** @type {string[]} */
    const inherited = []
    for (const rule of KEYWORD_SIGNAL_RULES) {
      if (!rule.re.test(text)) continue
      for (const id of rule.dims) {
        if (dimensionSurfaceApplicable(repoProfile, id)) inherited.push(id)
      }
    }
    if (!inherited.length) continue
    if (assignPathToSurfaceBuckets(path, repoProfile, buckets, [...new Set(inherited)])) keywordSignalAdds++
  }

  for (const id of Object.keys(buckets)) {
    buckets[id] = sortPathsDeterministic(buckets[id])
  }

  const surfaceDiscoveredCounts = Object.fromEntries(
    DIMENSION_CATALOG.map((d) => [d.id, (buckets[d.id] || []).length])
  )

  const { max: criticalShortlistMax } = resolveCriticalShortlistMax({
    criticalShortlistMax: plan.criticalShortlistMax == null ? undefined : plan.criticalShortlistMax,
  })
  const rebuilt = rebuildCriticalShortlistFromBuckets(buckets, repoProfile, criticalShortlistMax)

  return {
    ...plan,
    surfacePathsByDimension: buckets,
    criticalShortlist: rebuilt.criticalShortlist,
    protectedTargetPaths: rebuilt.protectedTargetPaths,
    surfaceDiscoveredCounts,
    criticalShortlistTruncated: rebuilt.criticalShortlistTruncated,
    shortlistPipeline: {
      ...(plan.shortlistPipeline || {}),
      keywordSignalAdds: (plan.shortlistPipeline?.keywordSignalAdds ?? 0) + keywordSignalAdds,
    },
  }
}

/**
 * DEFECT-003 Stage 2 — expand surface buckets using static imports (forward) and shallow reverse importers.
 * Requires source texts for frontier paths (ingestion reads critical shortlist sources + iterative new paths).
 *
 * @param {string[]} blobPaths
 * @param {object} repoProfile
 * @param {ReturnType<typeof buildSecuritySurfacePlan>} plan
 * @param {Record<string, string> | Map<string, string>} pathTextByPath
 * @param {string[]} [aliasAtRoots]
 * @param {{ maxForwardDepth?: number, maxReverseAdditions?: number }} [opts]
 */
export function enrichSecuritySurfacePlanWithImportGraph(
  blobPaths,
  repoProfile,
  plan,
  pathTextByPath,
  aliasAtRoots = [],
  opts = {}
) {
  const maxForwardDepth = Number.isFinite(opts.maxForwardDepth) ? Math.max(1, Math.floor(opts.maxForwardDepth)) : 8
  const maxReverseAdditions = Number.isFinite(opts.maxReverseAdditions)
    ? Math.max(0, Math.floor(opts.maxReverseAdditions))
    : 800

  const getText = (p) => {
    if (!pathTextByPath) return ''
    if (pathTextByPath instanceof Map) return String(pathTextByPath.get(p) || '')
    return String(pathTextByPath[p] || '')
  }

  const eligibleSet = new Set()
  for (const raw of blobPaths || []) {
    const path = normalizeRepoPath(raw)
    const c = classifyRepoPath(path, { repoProfile })
    if (!c.omit) eligibleSet.add(path)
  }

  const buckets = cloneSurfaceBuckets(plan.surfacePathsByDimension)
  let forwardAdds = 0
  let reverseAdds = 0

  /** @type {Map<string, number>} */
  const depthByPath = new Map()
  /** @type {Map<string, number>} import depth cap inherited from route-rooted seeds (DEFECT-005 route-to-data-flow). */
  const forwardCapByPath = new Map()
  const queue = []

  const seedCritical = (plan.criticalShortlist || []).map((p) => normalizeRepoPath(p)).filter((p) => eligibleSet.has(p))
  for (const p of seedCritical) {
    if (!SHORTLIST_SOURCE_EXT_RE.test(p) || !getText(p)) continue
    if (!depthByPath.has(p)) {
      depthByPath.set(p, 0)
      forwardCapByPath.set(p, isRouteAnchorPath(p) ? maxForwardDepth + 4 : maxForwardDepth)
      queue.push(p)
    }
  }

  while (queue.length) {
    const anchor = queue.shift()
    const d0 = depthByPath.get(anchor) ?? 0
    const forwardCap = forwardCapByPath.get(anchor) ?? maxForwardDepth
    if (d0 >= forwardCap) continue
    const text = getText(anchor)
    if (!text) continue
    const inherited = dimensionsForRepoPath(anchor, repoProfile)
    if (!inherited.length) continue

    for (const spec of parseImportSpecifiers(text)) {
      const resolved = resolveImportToRepoPath(anchor, spec, eligibleSet, aliasAtRoots)
      if (!resolved || resolved === anchor) continue
      const added = assignPathToSurfaceBuckets(resolved, repoProfile, buckets, inherited)
      if (added) forwardAdds++
      const nextDepth = d0 + 1
      if (nextDepth < forwardCap && SHORTLIST_SOURCE_EXT_RE.test(resolved) && getText(resolved)) {
        const prevDepth = depthByPath.get(resolved)
        const prevCap = forwardCapByPath.get(resolved)
        if (prevDepth == null || nextDepth < prevDepth) {
          depthByPath.set(resolved, nextDepth)
          forwardCapByPath.set(resolved, forwardCap)
          queue.push(resolved)
        } else if (prevDepth === nextDepth && forwardCap > (prevCap ?? maxForwardDepth)) {
          forwardCapByPath.set(resolved, forwardCap)
          queue.push(resolved)
        }
      }
    }
  }

  const criticalUnion = new Set()
  for (const d of DIMENSION_CATALOG) {
    for (const p of buckets[d.id] || []) criticalUnion.add(p)
  }

  let reverseBudget = maxReverseAdditions
  const sortedEligible = sortPathsDeterministic([...eligibleSet])
  for (const p of sortedEligible) {
    if (reverseBudget <= 0) break
    if (criticalUnion.has(p)) continue
    if (!SHORTLIST_SOURCE_EXT_RE.test(p)) continue
    if (!REVERSE_IMPORT_CALLER_PREFIX_RE.test(p)) continue
    const text = getText(p)
    if (!text) continue
    const inheritedDims = new Set()
    for (const spec of parseImportSpecifiers(text)) {
      const r = resolveImportToRepoPath(p, spec, eligibleSet, aliasAtRoots)
      if (!r || !criticalUnion.has(r)) continue
      for (const id of dimensionsForRepoPath(r, repoProfile)) inheritedDims.add(id)
    }
    if (!inheritedDims.size) continue
    if (assignPathToSurfaceBuckets(p, repoProfile, buckets, [...inheritedDims])) {
      reverseAdds++
      reverseBudget--
      criticalUnion.add(p)
    }
  }

  for (const id of Object.keys(buckets)) {
    buckets[id] = sortPathsDeterministic(buckets[id])
  }

  const surfaceDiscoveredCounts = Object.fromEntries(
    DIMENSION_CATALOG.map((d) => [d.id, (buckets[d.id] || []).length])
  )

  const { max: criticalShortlistMax } = resolveCriticalShortlistMax({
    criticalShortlistMax: plan.criticalShortlistMax == null ? undefined : plan.criticalShortlistMax,
  })
  const rebuilt = rebuildCriticalShortlistFromBuckets(buckets, repoProfile, criticalShortlistMax)

  return {
    ...plan,
    surfacePathsByDimension: buckets,
    criticalShortlist: rebuilt.criticalShortlist,
    protectedTargetPaths: rebuilt.protectedTargetPaths,
    surfaceDiscoveredCounts,
    criticalShortlistTruncated: rebuilt.criticalShortlistTruncated,
    shortlistPipeline: {
      ...(plan.shortlistPipeline || {}),
      forwardImportExpansions: forwardAdds,
      reverseCallerExpansions: reverseAdds,
      rounds: 1,
    },
  }
}

/**
 * @param {ReturnType<typeof buildSecuritySurfacePlan> | null | undefined} plan
 * @param {Set<string> | Iterable<string>} selectedPaths
 * @param {object} repoProfile
 */
export function evaluateDimensionCoreEvidence(plan, selectedPaths, repoProfile) {
  if (!plan?.surfacePathsByDimension) return null
  const set = selectedPaths instanceof Set ? selectedPaths : new Set(selectedPaths)
  /** @type {Record<string, { applicable: boolean, discovered: number, included: number, coreSampleSatisfied: boolean }>} */
  const out = {}
  for (const d of DIMENSION_CATALOG) {
    const dimensionId = d.id
    const paths = plan.surfacePathsByDimension[dimensionId] || []
    const discovered = paths.length
    const app = buildDimensionApplicability({
      dimensionId,
      repoProfile,
      reviewedFileCount: 1,
      runtimeProgress: 'ready',
    })
    const applicable = app.status !== 'not_applicable'
    const included = paths.filter((p) => set.has(p)).length
    const sample = paths.slice(0, Math.min(8, Math.max(discovered, 0)))
    const includedInSample = sample.filter((p) => set.has(p)).length
    const coreSampleSatisfied =
      !applicable || discovered === 0 ? true : includedInSample > 0
    out[dimensionId] = { applicable, discovered, included, coreSampleSatisfied }
  }
  return out
}
