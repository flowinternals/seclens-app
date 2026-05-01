const HIGH_SIGNAL_PATH_RE =
  /(localstorage|sessionstorage|token|invite|claim|jobid|job[-_]?store|scan[-_]?jobs|rate[-_]?limit|ratelimit|throttle|abuse|forwarded[-_]?for|x-?forwarded-?for|bearer|auth|session|permission|role|guard|middleware|owner|tenant|cors|origin|callback|webhook|export|download)/i

const FAMILY_TO_CLASSES = {
  auth_session_authorization: ['public_entrypoint', 'data_access_ownership', 'control_sufficiency'],
  invite_token_claims: ['bearer_identifier', 'public_entrypoint', 'control_sufficiency'],
  validation_input_trust_boundaries: ['validation_trust_boundary', 'public_entrypoint'],
  rate_limiting_abuse_controls: ['control_sufficiency', 'public_entrypoint'],
  data_store_access_persistence_controls: ['data_access_ownership', 'control_sufficiency'],
  client_auth_bridge_frontend_guarding: ['sensitive_storage', 'control_sufficiency'],
  cicd_deployment_secret_handling: ['validation_trust_boundary'],
  config_policy_rules: ['validation_trust_boundary', 'data_access_ownership'],
}

const CLASS_QUESTIONS = {
  sensitive_storage: [
    'What value is stored, and is it sensitive enough that local/browser persistence increases exposure?',
    'Is persistence actually required beyond the active interaction, or could it be avoided?',
    'Would same-origin script compromise, extension compromise, or local workstation compromise expose this value?',
  ],
  bearer_identifier: [
    'Is possession of this identifier alone sufficient to retrieve sensitive state?',
    'What binds this identifier to the original requester, session, or tenant?',
    'If leaked, what sensitive payload or action becomes reachable?',
  ],
  control_sufficiency: [
    'What trust input does this control rely on?',
    'Can that trust input be spoofed, replayed, or bypassed by a caller?',
    'Is the control enforced at the actual public entrypoint and durable in production conditions?',
  ],
  public_entrypoint: [
    'Who can reach this entrypoint and what sensitive behavior does it trigger?',
    'What authenticates and scopes the caller before expensive or sensitive behavior runs?',
  ],
  data_access_ownership: [
    'Where is ownership or tenant scope explicitly enforced before read/write paths?',
    'Which cited files prove the constraint, not just imply it?',
  ],
  validation_trust_boundary: [
    'What trust boundary is crossed at this input?',
    'Is validation relevant and complete for the boundary, not just sanitization or formatting?',
  ],
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').toLowerCase()
}

export function inferHighSignalClasses(passFamily, evidencePaths = []) {
  const classes = new Set(FAMILY_TO_CLASSES[passFamily] || [])
  for (const raw of evidencePaths || []) {
    if (HIGH_SIGNAL_PATH_RE.test(normalizePath(raw))) {
      classes.add('control_sufficiency')
    }
  }
  return [...classes]
}

export function buildAdversarialReasoningBlock(passFamily, evidencePaths = []) {
  const classes = inferHighSignalClasses(passFamily, evidencePaths)
  if (!classes.length) return ''

  const lines = []
  for (const cls of classes) {
    const qs = CLASS_QUESTIONS[cls] || []
    if (!qs.length) continue
    lines.push(`- ${cls}:`)
    for (const q of qs) lines.push(`  - ${q}`)
  }

  return `Adversarial issue-discovery requirements (high-signal evidence active):
- Do not stop at "control exists". Challenge whether it is trustworthy, bound correctly, and bypass-resistant.
- For each high-signal claim candidate, fill:
  - claimed_security_property
  - trust_assumption
  - bypass_or_uncertainty
  - adversarial_outcome (finding|unverified_control|coverage_note|observed_control)
- If trust binding or bypass resistance is not proven from cited evidence, prefer unverified_control over observed_control.
- Summary language must follow this adversarial challenge result, not precede it.
Question families for this pass:
${lines.join('\n')}`
}

export function candidateNeedsAdversarialChallenge(candidate) {
  const topic = String(candidate?.topic || '')
  const highSignalTopic = ['auth', 'invite', 'session', 'claims', 'rate_limit', 'validation'].includes(topic)
  const cites = Array.isArray(candidate?.evidence_citations) ? candidate.evidence_citations : []
  const highSignalPath = cites.some((c) => HIGH_SIGNAL_PATH_RE.test(normalizePath(String(c).split(':')[0])))
  return highSignalTopic || highSignalPath
}
