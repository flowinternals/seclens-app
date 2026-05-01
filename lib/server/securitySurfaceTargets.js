/**
 * DEFECT-003 — profile-driven security surface map + protected retrieval targets (CR-2.1-002/003).
 */

import { DIMENSION_CATALOG } from '../shared/dimensions.js'
import { buildDimensionApplicability } from '../shared/repoProfile.js'
import { normalizeRepoPath } from './repoInventory.js'
import {
  classifyRepoPath,
  classifySelectionDomain,
  isCallableAuthAdminModulePath,
  sortPathsDeterministic,
} from './fileSelection.js'

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

/**
 * Build a surface map and bounded protected path list for retrieval (DEFECT-003).
 * @param {string[]} blobPaths
 * @param {object} repoProfile from inferRepoProfileFromPaths
 * @param {{ maxFiles?: number }} [opts]
 */
export function buildSecuritySurfacePlan(blobPaths, repoProfile, opts = {}) {
  const maxFiles = Number.isFinite(opts.maxFiles) ? opts.maxFiles : 120
  const maxProtected = Math.min(160, Math.max(24, Math.floor(maxFiles * 0.45)))

  /** @type {Record<string, string[]>} */
  const surfacePathsByDimension = {}
  for (const d of DIMENSION_CATALOG) {
    surfacePathsByDimension[d.id] = []
  }

  for (const raw of blobPaths || []) {
    const path = normalizeRepoPath(raw)
    const c = classifyRepoPath(path, { repoProfile })
    if (c.omit) continue

    const dims = new Set()

    if (isCallableAuthAdminModulePath(path)) {
      dims.add('auth_session_authorization')
    }

    const dom = classifySelectionDomain(path)
    if (dom && DOMAIN_TO_DIMENSION[dom]) {
      const dimensionId = DOMAIN_TO_DIMENSION[dom]
      if (dimensionSurfaceApplicable(repoProfile, dimensionId)) {
        dims.add(dimensionId)
      }
    }

    for (const dimensionId of dims) {
      const bucket = surfacePathsByDimension[dimensionId]
      if (!bucket.includes(path)) bucket.push(path)
    }
  }

  for (const id of Object.keys(surfacePathsByDimension)) {
    surfacePathsByDimension[id] = sortPathsDeterministic(surfacePathsByDimension[id])
  }

  const surfaceDiscoveredCounts = Object.fromEntries(
    DIMENSION_CATALOG.map((d) => [d.id, (surfacePathsByDimension[d.id] || []).length])
  )

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

  const protectedTargetPaths = priority.slice(0, maxProtected).map((x) => x.path)

  return {
    surfacePathsByDimension,
    protectedTargetPaths,
    surfaceDiscoveredCounts,
    maxProtected,
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
