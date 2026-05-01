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

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase()
}

export function passFamilyForPath(path) {
  const p = normalizePath(path)
  if (
    /auth|session|permission|role|middleware|guard|authorize|rbac/.test(p) &&
    !/client|frontend|ui|component/.test(p)
  ) {
    return 'auth_session_authorization'
  }
  if (/invite|token|claim/.test(p)) return 'invite_token_claims'
  if (/validate|validation|schema|zod|sanitize|input|boundary|csrf|xss|idor/.test(p)) {
    return 'validation_input_trust_boundaries'
  }
  // ratelimit.js / rateLimit.ts (camelCase) must route here — camelCase does not match rate[-_]limit alone (DEFECT-004)
  if (/ratelimit|rate[-_]?limit|throttle|abuse|express-rate|slowdown|limiter/.test(p)) {
    return 'rate_limiting_abuse_controls'
  }
  if (/.github\/workflows|deploy|docker|terraform|secret|ci|cd/.test(p)) {
    return 'cicd_deployment_secret_handling'
  }
  if (
    /firestore\.rules|storage\.rules|policy|rules|config|eslint|prettier|tsconfig|firebase\.json/.test(
      p
    )
  ) {
    return 'config_policy_rules'
  }
  if (/db|database|firestore|prisma|sql|mongo|repository|persistence/.test(p)) {
    return 'data_store_access_persistence_controls'
  }
  if (/client|frontend|src\/components|src\/app|authcontext|route guard|protectedroute/.test(p)) {
    return 'client_auth_bridge_frontend_guarding'
  }
  // Remaining server/API surfaces must join a modeled pass — misc was dropped entirely from clustering (DEFECT-004)
  if (/(^|\/)lib\/server\//.test(p) || /(^|\/)api\//.test(p) || /(^|\/)server\//.test(p)) {
    return 'validation_input_trust_boundaries'
  }
  return 'misc_supporting_context'
}

export function buildMultiPassPlan(bundle) {
  const evidence = Array.isArray(bundle?.evidence) ? bundle.evidence : []
  const grouped = new Map(PASS_FAMILIES.map((name) => [name, []]))
  for (const ev of evidence) {
    const family = passFamilyForPath(ev.path)
    if (!grouped.has(family)) continue
    grouped.get(family).push(ev)
  }

  const passes = []
  const clusterSkipReasons = {}
  let ordinal = 0
  for (const family of PASS_FAMILIES) {
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
    })
  }

  return {
    analysisPassCount: passes.length,
    passes,
    clusterInventory: passes.map((p) => ({
      passId: p.id,
      family: p.family,
      evidenceCount: p.evidence.length,
      requiredHighRisk: p.requiredHighRisk,
    })),
    clusterSkipReasons,
  }
}

export function shouldFailForPassFailures(plan, failedPasses) {
  const total = plan?.passes?.length || 0
  const failed = failedPasses.length
  if (total === 0) return { fail: true, reason: 'stage_a_no_passes' }
  if (failed === 0) return { fail: false, reason: null }
  if (failed / total > 0.4) return { fail: true, reason: 'pass_failure_threshold_exceeded' }

  const byFamily = new Map()
  for (const p of plan.passes || []) {
    byFamily.set(p.family, (byFamily.get(p.family) || 0) + 1)
  }
  for (const p of failedPasses) {
    const countForFamily = byFamily.get(p.family) || 0
    if (p.requiredHighRisk && countForFamily <= 1) {
      return { fail: true, reason: 'required_high_risk_domain_uncovered' }
    }
  }
  return { fail: false, reason: null }
}

export { PASS_FAMILIES }
