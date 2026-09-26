import {
  RESIDUAL_PASS_FAMILY,
  PARTIAL_REASON_CODES,
  applyDimensionQuota,
  computeDimensionQuotas,
  hasDirectSecurityRestoreSignal,
  createAllocationLedgerEntry,
} from './coverageHonesty.js'
import { isCallableAuthAdminModulePath } from './fileSelection.js'
import { DIMENSION_CATALOG } from '../shared/dimensions.js'

const PASS_FAMILIES = [
  'auth_session_authorization',
  'invite_token_claims',
  'validation_input_trust_boundaries',
  'rate_limiting_abuse_controls',
  'cicd_deployment_secret_handling',
  'config_policy_rules',
  'data_store_access_persistence_controls',
  'client_auth_bridge_frontend_guarding',
]

const HIGH_RISK_REQUIRED = new Set([
  'auth_session_authorization',
  'invite_token_claims',
  'validation_input_trust_boundaries',
])

const DIMENSION_TO_PASS_FAMILY = Object.freeze({
  auth_session_authorization: 'auth_session_authorization',
  invite_token_claims: 'invite_token_claims',
  validation_input_trust_boundaries: 'validation_input_trust_boundaries',
  rate_limiting_abuse_controls: 'rate_limiting_abuse_controls',
  cicd_secrets_deployment: 'cicd_deployment_secret_handling',
  config_policy_rules: 'config_policy_rules',
  data_access_persistence: 'data_store_access_persistence_controls',
  client_auth_bridge_frontend_guarding: 'client_auth_bridge_frontend_guarding',
})

function normalizeRequestedFamilies(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase()
}

/**
 * Diagnostic path-family classifier only — must not drive dimension assignment when a surface plan exists (Q4).
 * Segment-aware to avoid tokens/ and CardBody/db false routes (Stage 2).
 */
export function passFamilyForPath(path) {
  const p = normalizePath(path)
  // Design-system token trees are never invite/auth via substring "token"
  if (/(^|\/)(tokens|design-tokens|theme-tokens)\//.test(p)) {
    return RESIDUAL_PASS_FAMILY
  }
  if (
    /(?:^|\/)(?:auth|session|permission|role|middleware|guard|authorize|rbac)(?:\/|\.|$)/.test(p) &&
    !/(?:^|\/)(?:client|frontend|ui|components)\//.test(p)
  ) {
    return 'auth_session_authorization'
  }
  if (
    /(?:^|\/)(?:invite|invitation)(?:\/|\.|$)/.test(p) ||
    /(?:^|\/)(?:tokens|claims)(?:\/|\.|$)/.test(p) ||
    /customclaims|refreshtoken|idtoken/.test(p)
  ) {
    return 'invite_token_claims'
  }
  if (/validate|validation|schema|zod|sanitize|input|boundary|csrf|xss|idor/.test(p)) {
    return 'validation_input_trust_boundaries'
  }
  if (/ratelimit|rate[-_]?limit|throttle|abuse|express-rate|slowdown|limiter/.test(p)) {
    return 'rate_limiting_abuse_controls'
  }
  if (/\.github\/workflows|(?:^|\/)deploy(?:\/|\.|$)|docker|terraform|(?:^|\/)secret|(?:^|\/)ci(?:\/|\.|$)/.test(p)) {
    return 'cicd_deployment_secret_handling'
  }
  if (
    /firestore\.rules|storage\.rules|policy|rules|config|eslint|prettier|tsconfig|firebase\.json/.test(
      p
    )
  ) {
    return 'config_policy_rules'
  }
  // Require path-segment boundaries for db/database — avoid CardBody.tsx
  if (
    /(?:^|\/)(?:db|database|firestore|prisma|sql|mongo|repository|persistence)(?:\/|\.|$)/.test(p)
  ) {
    return 'data_store_access_persistence_controls'
  }
  if (/client|frontend|src\/components|src\/app|authcontext|route.?guard|protectedroute/.test(p)) {
    return 'client_auth_bridge_frontend_guarding'
  }
  if (/(^|\/)lib\/server\//.test(p) || /(^|\/)api\//.test(p) || /(^|\/)server\//.test(p)) {
    return 'validation_input_trust_boundaries'
  }
  return RESIDUAL_PASS_FAMILY
}

function evidenceByteLength(ev) {
  if (Number.isFinite(Number(ev?.byteLength))) return Number(ev.byteLength)
  if (typeof ev?.text === 'string') return ev.text.length
  if (typeof ev?.content === 'string') return ev.content.length
  if (Array.isArray(ev?.snippets)) {
    return ev.snippets.reduce((n, s) => n + String(s?.text || '').length, 0)
  }
  return 0
}

function rankMetaForPath(path, protectedSet) {
  const key = normalizePath(path)
  return {
    protected: protectedSet.has(key) || isCallableAuthAdminModulePath(path),
    securitySignal: hasDirectSecurityRestoreSignal(path),
    tier: isCallableAuthAdminModulePath(path) ? 1 : 3,
  }
}

/**
 * @param {object} bundle
 * @param {{
 *   includePassFamilies?: string[],
 *   securitySurfacePlan?: object | null,
 *   ingestionCaps?: { maxFiles?: number, maxTotalBytes?: number },
 *   applyQuotas?: boolean,
 * }} [options]
 */
export function buildMultiPassPlan(bundle, options = {}) {
  const evidence = Array.isArray(bundle?.evidence) ? bundle.evidence : []
  const requestedFamilies = normalizeRequestedFamilies(options?.includePassFamilies)
  const enabledFamilies = requestedFamilies.length
    ? PASS_FAMILIES.filter((family) => requestedFamilies.includes(family))
    : PASS_FAMILIES
  const grouped = new Map(PASS_FAMILIES.map((name) => [name, []]))
  const residualEvidence = []
  const diagnosticFamilyByPath = {}
  const surfacePathsByDimension = options?.securitySurfacePlan?.surfacePathsByDimension
  const protectedTargets = new Set(
    (options?.securitySurfacePlan?.protectedTargetPaths || []).map((p) => normalizePath(p))
  )
  const surfaceFamiliesByPath = new Map()
  const hasSurfacePlan = surfacePathsByDimension && typeof surfacePathsByDimension === 'object'

  if (hasSurfacePlan) {
    for (const [dimensionId, paths] of Object.entries(surfacePathsByDimension)) {
      const family = DIMENSION_TO_PASS_FAMILY[dimensionId]
      if (!family || !Array.isArray(paths)) continue
      for (const path of paths) {
        const key = normalizePath(path)
        if (!surfaceFamiliesByPath.has(key)) surfaceFamiliesByPath.set(key, new Set())
        surfaceFamiliesByPath.get(key).add(family)
      }
    }
  }

  const assignedPaths = new Set()
  const evidenceByKey = new Map()
  for (const ev of evidence) {
    const key = normalizePath(ev.path)
    evidenceByKey.set(key, ev)
    diagnosticFamilyByPath[ev.path] = passFamilyForPath(ev.path)

    if (hasSurfacePlan) {
      const surfacedFamilies = surfaceFamiliesByPath.get(key)
      if (surfacedFamilies?.size) {
        for (const family of surfacedFamilies) {
          if (!grouped.has(family)) continue
          grouped.get(family).push(ev)
        }
        assignedPaths.add(key)
      } else {
        // Q4: residual supporting-context — never regex-assign into security dimensions
        residualEvidence.push(ev)
      }
    } else {
      // No surface plan: diagnostic classifier only for routing into modeled families or residual
      const family = passFamilyForPath(ev.path)
      if (family === RESIDUAL_PASS_FAMILY || !grouped.has(family)) {
        residualEvidence.push(ev)
      } else {
        grouped.get(family).push(ev)
        assignedPaths.add(key)
      }
    }
  }

  const unmatchedSurfacedPaths = []
  const unmatchedSurfacedByFamily = {}
  if (hasSurfacePlan) {
    for (const [key, families] of surfaceFamiliesByPath.entries()) {
      if (evidenceByKey.has(key)) continue
      unmatchedSurfacedPaths.push(key)
      for (const family of families) {
        if (!unmatchedSurfacedByFamily[family]) unmatchedSurfacedByFamily[family] = []
        unmatchedSurfacedByFamily[family].push(key)
      }
    }
    unmatchedSurfacedPaths.sort((a, b) => a.localeCompare(b))
    for (const family of Object.keys(unmatchedSurfacedByFamily)) {
      unmatchedSurfacedByFamily[family].sort((a, b) => a.localeCompare(b))
    }
  }

  const caps = options?.ingestionCaps || {}
  const applyQuotas = options?.applyQuotas !== false
  const applicableFamilies = PASS_FAMILIES.filter((family) => {
    if (!enabledFamilies.includes(family)) return false
    return (grouped.get(family) || []).length > 0
  })
  const quota = computeDimensionQuotas({
    globalMaxFiles: caps.maxFiles || evidence.length || 48,
    globalMaxTotalBytes: caps.maxTotalBytes || 2 * 1024 * 1024,
    applicableDimensionCount: Math.max(1, applicableFamilies.length),
  })

  const omittedByQuota = []
  const quotaOutcomes = {}

  // Stable evidence order; then apply per-dimension quotas (Stage 3)
  for (const family of PASS_FAMILIES) {
    const items = grouped.get(family) || []
    items.sort((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)))
    if (!applyQuotas || items.length === 0) {
      grouped.set(family, items)
      continue
    }
    const { kept, omitted } = applyDimensionQuota(items, quota, (path) =>
      rankMetaForPath(path, protectedTargets)
    )
    grouped.set(family, kept)
    quotaOutcomes[family] = {
      discovered: items.length,
      examined: kept.length,
      omittedByQuota: omitted.length,
      maxPaths: quota.maxPaths,
      maxBytes: quota.maxBytes,
    }
    for (const row of omitted) {
      omittedByQuota.push({ ...row, family })
    }
  }

  residualEvidence.sort((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)))

  const passes = []
  const clusterSkipReasons = {}
  let ordinal = 0
  for (const family of PASS_FAMILIES) {
    if (!enabledFamilies.includes(family)) {
      clusterSkipReasons[family] = 'not_selected_in_run_plan'
      continue
    }
    const items = grouped.get(family) || []
    if (items.length === 0) {
      clusterSkipReasons[family] = 'no_relevant_evidence'
      continue
    }
    const id = `pass_${String(++ordinal).padStart(2, '0')}_${family}`
    passes.push({
      id,
      family,
      evidence: items,
      evidencePaths: items.map((x) => x.path),
      requiredHighRisk: HIGH_RISK_REQUIRED.has(family),
      residual: false,
    })
  }

  // Visible residual supporting-context pass (Q4) — recorded, not a security dimension claim
  if (residualEvidence.length > 0) {
    const id = `pass_${String(ordinal + 1).padStart(2, '0')}_${RESIDUAL_PASS_FAMILY}`
    passes.push({
      id,
      family: RESIDUAL_PASS_FAMILY,
      evidence: residualEvidence,
      evidencePaths: residualEvidence.map((x) => x.path),
      requiredHighRisk: false,
      residual: true,
      reasonCode: PARTIAL_REASON_CODES.UNMAPPED_SUPPORTING_CONTEXT,
    })
  }

  const multiAssignedPathCount = (() => {
    const counts = new Map()
    for (const pass of passes) {
      if (pass.residual) continue
      for (const path of pass.evidencePaths) {
        const key = normalizePath(path)
        counts.set(key, (counts.get(key) || 0) + 1)
      }
    }
    let multi = 0
    for (const n of counts.values()) {
      if (n > 1) multi += 1
    }
    return multi
  })()

  // AQ9 — per-dimension allocation ledger (modelExaminedPaths filled after pass execution).
  const pathMultiHits = new Map()
  for (const family of PASS_FAMILIES) {
    for (const ev of grouped.get(family) || []) {
      const key = normalizePath(ev.path)
      pathMultiHits.set(key, (pathMultiHits.get(key) || 0) + 1)
    }
  }
  const allocationLedger = DIMENSION_CATALOG.map((dimension) => {
    const family = DIMENSION_TO_PASS_FAMILY[dimension.id] || dimension.passFamily
    const surfaced = hasSurfacePlan
      ? [...(surfacePathsByDimension?.[dimension.id] || [])]
      : []
    const assigned = (grouped.get(family) || []).map((ev) => ev.path)
    const omitted = omittedByQuota
      .filter((row) => row.family === family)
      .map((row) => ({ path: row.path, reasonCode: row.reasonCode }))
    const unmatched = unmatchedSurfacedByFamily[family] || []
    let multiForDim = 0
    for (const path of assigned) {
      if ((pathMultiHits.get(normalizePath(path)) || 0) > 1) multiForDim += 1
    }
    return createAllocationLedgerEntry(dimension.id, {
      surfacedPaths: surfaced.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b))),
      assignedPaths: [...assigned].sort((a, b) => normalizePath(a).localeCompare(normalizePath(b))),
      modelExaminedPaths: [],
      omittedByQuota: omitted,
      unmatchedSurfaced: [...unmatched],
      zeroReviewReasonCode: assigned.length === 0 ? PARTIAL_REASON_CODES.NO_PASS_EVIDENCE : null,
      quota: {
        minPaths: quota.minPaths,
        maxPaths: quota.maxPaths,
        maxBytes: quota.maxBytes,
      },
      allocationSource: hasSurfacePlan ? 'surface_plan' : 'diagnostic_or_residual',
      multiAssignedPathCount: multiForDim,
    })
  })

  const lifecycleCounts = {
    planned: DIMENSION_CATALOG.length,
    applicable: allocationLedger.filter(
      (row) => row.surfacedPaths.length > 0 || row.assignedPaths.length > 0 || row.unmatchedSurfaced.length > 0
    ).length,
    surfaced: allocationLedger.filter((row) => row.surfacedPaths.length > 0).length,
    assigned: allocationLedger.filter((row) => row.assignedPaths.length > 0).length,
    reviewed: 0,
    completed: 0,
  }

  return {
    analysisPassCount: passes.filter((p) => !p.residual).length,
    passes,
    clusterInventory: passes.map((p) => ({
      passId: p.id,
      family: p.family,
      evidenceCount: p.evidence.length,
      requiredHighRisk: p.requiredHighRisk,
      residual: Boolean(p.residual),
    })),
    clusterSkipReasons,
    assignment: {
      source: hasSurfacePlan
        ? 'security_surface_plan_with_residual_supporting_context'
        : 'diagnostic_path_family_or_residual',
      surfacedPathCount: surfaceFamiliesByPath.size,
      surfacedPathsAssigned: assignedPaths.size,
      surfacedPathsUnmatched: unmatchedSurfacedPaths.length,
      unmatchedSurfacedPaths,
      unmatchedSurfacedByFamily,
      residualPathCount: residualEvidence.length,
      residualPaths: residualEvidence.map((e) => e.path),
      residualReasonCode: PARTIAL_REASON_CODES.UNMAPPED_SUPPORTING_CONTEXT,
      residualRoutingNote: 'routed as supporting context; not model-examined and not counted as dimension coverage',
      multiAssignedPathCount,
      diagnosticFamilyByPath,
      omittedByQuota,
      quotaOutcomes,
      quota,
      allocationLedger,
      lifecycleCounts,
    },
  }
}

export function shouldFailForPassFailures(plan, failedPasses) {
  const securityPasses = (plan?.passes || []).filter((p) => !p.residual)
  const total = securityPasses.length || 0
  const failed = failedPasses.filter((p) => !p.residual).length
  if (total === 0) return { fail: true, reason: 'stage_a_no_passes' }
  if (failed === 0) return { fail: false, reason: null }
  if (failed / total > 0.4) return { fail: true, reason: 'pass_failure_threshold_exceeded' }

  const byFamily = new Map()
  for (const p of securityPasses) {
    byFamily.set(p.family, (byFamily.get(p.family) || 0) + 1)
  }
  for (const p of failedPasses) {
    if (p.residual) continue
    const countForFamily = byFamily.get(p.family) || 0
    if (p.requiredHighRisk && countForFamily <= 1) {
      return { fail: true, reason: 'required_high_risk_domain_uncovered' }
    }
  }
  return { fail: false, reason: null }
}

export { PASS_FAMILIES, DIMENSION_TO_PASS_FAMILY, evidenceByteLength }
