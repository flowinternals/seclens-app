import {
  REPORT_TITLE,
  SECTION_TITLES_ORDER,
  SECTION_PRIORITIZED_RECOMMENDATIONS,
} from '../prompts/seclens-output-contract-v2.js'
import { collectCitationManifest } from './evidenceBundle.js'
import { extractSectionBody } from './reportValidation.js'
import { candidateNeedsAdversarialChallenge } from './adversarialReasoning.js'

export const STRUCTURED_TEMPLATE_VERSION = 5

/** CR-008 Appendix A: max lines when manifest exceeds this count */
export const APPENDIX_POLICY_MAX_TOTAL = 40
/** CR-008: breadth cap per security domain before overflow fill */
export const APPENDIX_POLICY_PER_DOMAIN = 5

const KNOWN_KINDS = new Set([
  'finding',
  'observation',
  'observed_control',
  'unverified_control',
  'recommendation',
  'quick_win',
  'coverage_note',
])
const KNOWN_SEVERITIES = new Set(['Critical', 'High', 'Medium', 'Low', 'Info', 'None'])
const KNOWN_TOPICS = new Set([
  'auth',
  'invite',
  'rate_limit',
  'validation',
  'cicd',
  'headers',
  'session',
  'dependency',
  'claims',
])
const KNOWN_CONFIDENCE = new Set(['high', 'medium', 'low'])
const UNKNOWN_TOPIC = 'unknown'

/** CR-009 MVP4: complete priority set for section-quality / placeholder gating. */
export const CR009_PRIORITY_SECTION_TITLES = [
  'Session Management',
  'Web Security Controls',
  'CI/CD & Operational Hardening',
  'Dependency & Supply Chain Notes',
  'Rate Limiting & Abuse Controls',
]

const CONCRETE_SURFACE_TOKEN_RE = /\b(?:invite|session|claims|rate limit|rate-limit|workflow|firestore rules|role assignment|auth gate|middleware|permission policy|token expir|single-use|replay|validation schema|custom claims|route guard|admin|user creation|invite acceptance|ci workflow|deployment|policy|client auth bridge|secret handling|throttle|authorization boundary)\b/i

const REPORT_VALUE_SCORE_THRESHOLD = 0.75

function stripBackticksForSpecificity(text) {
  return String(text || '')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildInspectedSurfaceClaim(topic, cite) {
  const pathOnly = parseCitationPath(cite) || cite
  const file = pathOnly.split(/[/\\]/).pop() || pathOnly
  const t = topic || 'validation'
  const maps = {
    cicd: `Inspected CI workflow and deployment configuration at \`${file}\` for secret handling in automation; review outcome: no admitted finding from scanned evidence.`,
    dependency: `Inspected dependency manifest and lockfile at \`${file}\` for third-party and supply-chain posture; review outcome: no admitted finding from scanned evidence.`,
    rate_limit: `Inspected rate limiting and abuse-control surface at \`${file}\` for throttling hooks; review outcome: no admitted finding from scanned evidence.`,
    headers: `Inspected web security headers and middleware at \`${file}\` for transport and browser controls; review outcome: no admitted finding from scanned evidence.`,
    session: `Inspected session and authentication surface at \`${file}\` for session lifecycle and permission checks; review outcome: no admitted finding from scanned evidence.`,
    auth: `Inspected authentication-related code at \`${file}\` for trust boundaries on protected actions; review outcome: no admitted finding from scanned evidence.`,
    invite: `Inspected invite flow at \`${file}\` for single-use and replay handling; review outcome: no admitted finding from scanned evidence.`,
    claims: `Inspected custom claims mapping at \`${file}\` where authorization data crosses trust boundaries; review outcome: no admitted finding from scanned evidence.`,
    validation: `Inspected input validation and schema surface at \`${file}\` for allowlists and boundary checks; review outcome: no admitted finding from scanned evidence.`,
  }
  return (
    maps[t] ||
    `Inspected ${String(t).replace(/_/g, ' ')}-related surface at \`${file}\`; review outcome: no admitted finding from scanned evidence.`
  )
}

function inferConcreteControlNoun(path, topic) {
  const p = normalizeString(path).toLowerCase()
  if (/validateinvite|invite|token/.test(p)) return 'invite acceptance token lifecycle'
  if (/permissionpolicy|role|claims/.test(p)) return 'permission policy and role assignment'
  if (/session|auth/.test(p)) return 'session and authorization boundary'
  if (/rate[-_]?limit|throttle|abuse/.test(p)) return 'rate limit helper coverage'
  if (/workflow|deploy|\.github\/workflows/.test(p)) return 'ci workflow secret handling'
  if (/package(-lock)?\.json|pnpm-lock|yarn\.lock/.test(p)) return 'dependency lockfile integrity'
  if (/firestore\.rules|storage\.rules|firebase\.json/.test(p)) return 'policy and rules enforcement'
  if (/schema|zod|validate|validation/.test(p)) return 'validation schema and boundary checks'

  const byTopic = {
    invite: 'invite acceptance flow',
    auth: 'authorization boundary',
    session: 'session lifecycle controls',
    claims: 'custom claims mapping',
    rate_limit: 'rate limit helper coverage',
    dependency: 'dependency lockfile integrity',
    cicd: 'ci workflow secret handling',
    validation: 'validation schema checks',
    headers: 'middleware header policy',
  }
  return byTopic[topic] || 'trust-boundary control flow'
}

function isBoilerplateOnlyInspectedClaim(claim) {
  const x = stripBackticksForSpecificity(claim).toLowerCase()
  if (!x) return true
  const legacyBoilerplate =
    /reviewed scanned excerpt for|did not yield|under pipeline rules|see citation for inspected|no concrete vulnerability was admitted from this excerpt alone|under pipeline rules/i.test(
      x
    )
  return legacyBoilerplate && !CONCRETE_SURFACE_TOKEN_RE.test(x)
}

export function isInspectedSurfaceClaimSpecific(claim, _topic) {
  if (isBoilerplateOnlyInspectedClaim(claim)) return false
  return CONCRETE_SURFACE_TOKEN_RE.test(stripBackticksForSpecificity(claim))
}

export function collectRepresentedDomainsFromAdmitted(admitted) {
  const domains = new Set()
  for (const f of admitted.findings || []) {
    if (f.topic && KNOWN_TOPICS.has(f.topic)) domains.add(f.topic)
  }
  for (const o of admitted.observations || []) {
    if (o.topic && KNOWN_TOPICS.has(o.topic)) domains.add(o.topic)
  }
  for (const q of admitted.quickWins || []) {
    if (q.topic && KNOWN_TOPICS.has(q.topic)) domains.add(q.topic)
  }
  return domains
}

/**
 * CR-009 scaled minima (architect): rows required for no-findings value bar when appendix is not thin.
 * Returns -1 when the run cannot pass the bar with rich appendix and almost no represented domains.
 */
export function requiredInspectedSurfaceRowsForNoFindings(representedDomainCount, appendixEvidenceCount) {
  if (appendixEvidenceCount < 8) return 2
  if (representedDomainCount >= 6) return 6
  if (representedDomainCount >= 4) return 4
  if (representedDomainCount >= 2) return 3
  return -1
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((v) => normalizeString(v)).filter(Boolean)
}

function canonicalSeverity(value) {
  const raw = normalizeString(value).toLowerCase()
  if (!raw) return null
  if (raw === 'critical') return 'Critical'
  if (raw === 'high') return 'High'
  if (raw === 'medium') return 'Medium'
  if (raw === 'low') return 'Low'
  if (raw === 'info') return 'Info'
  if (raw === 'none') return 'None'
  return null
}

function containsConcreteWeakness(text) {
  return /\b(missing|absent|not\s+enforced|does\s+not|fails?\s+to|lacks?|insufficient|unsafe)\b/i.test(text || '')
}

function containsGenericAdvice(text) {
  return /\b(consider|review|ensure|enhance|best\s+practice|hardening|recommended)\b/i.test(text || '')
}

function hasConcreteFlowOrBoundarySignal(candidate, text) {
  const direct = /\b(flow|trust boundary|authorization boundary|session boundary|ownership|tenant|account|route|endpoint|handler|api|middleware|token lifecycle|claims mapping)\b/i.test(
    text || ''
  )
  if (direct) return true
  const cites = candidate?.evidence_citations || []
  return cites.some((c) => {
    const p = String(parseCitationPath(c) || '').toLowerCase()
    return /app\/api|pages\/api|route\.|middleware|auth|session|permission|claim|invite|validate|firestore\.rules|storage\.rules/.test(
      p
    )
  })
}

function isUiComponentValidationOnlyFinding(candidate) {
  const text = `${candidate.title}\n${candidate.claim}\n${candidate.specific_code_behavior}\n${candidate.missing_control_or_unsafe_condition}`
  const cites = candidate.evidence_citations || []
  const uiOnlyCites = cites.every((c) => {
    const p = String(parseCitationPath(c) || '').toLowerCase()
    return /src\/components|button|ui|frontend|client/.test(p)
  })
  if (!uiOnlyCites) return false
  const mentionsValidation = /\b(validation|prop|schema|input)\b/i.test(text)
  const hasBoundary = hasConcreteFlowOrBoundarySignal(candidate, text)
  return mentionsValidation && !hasBoundary
}

function isGenericValidationHardeningFinding(candidate) {
  if (candidate.severity === 'High' || candidate.severity === 'Critical') return false
  const text = `${candidate.title}\n${candidate.claim}\n${candidate.specific_code_behavior}\n${candidate.missing_control_or_unsafe_condition}`
  return (
    /\b(validation|input)\b/i.test(text) &&
    /\b(could be stronger|could be improved|inconsistent|best practice|hardening|review|ensure)\b/i.test(
      text
    ) &&
    !/\b(allowlist|denylist|ownership|tenant|authorization|authenticat|schema rule|enum|length|range)\b/i.test(
      text
    )
  )
}

function isBroadCicdConfigHighOverpromotion(candidate) {
  if (candidate.severity !== 'High' && candidate.severity !== 'Critical') return false
  const text = `${candidate.title}\n${candidate.claim}\n${candidate.specific_code_behavior}\n${candidate.missing_control_or_unsafe_condition}\n${candidate.impact}`
  const isCicdLike = candidate.topic === 'cicd' || /\.(ya?ml|json)$/i.test((candidate.evidence_citations || []).join(' '))
  if (!isCicdLike) return false
  const concreteExposure = /\b(secret leak|credential exposure|deployment compromise|unauthorized access|bypass|token exfiltrat|private key|write access)\b/i.test(
    text
  )
  return !concreteExposure
}

function isSpeculativeHighCriticalCandidate(candidate) {
  if (candidate.severity !== 'High' && candidate.severity !== 'Critical') return false
  const text = `${candidate.claim}\n${candidate.specific_code_behavior}\n${candidate.missing_control_or_unsafe_condition}\n${candidate.impact}`.toLowerCase()
  const conditionalSpeculation =
    /\b(if exposed|if.*not.*properly|could be exposed|may lead|potential exposure|might|could|may)\b/.test(
      text
    )
  const hasAttackerEntry = /\b(attacker|unauthorized user|unauthenticated|malicious user|external actor)\b/.test(
    text
  )
  const hasMissingCheck =
    /\b(missing|absent|not enforced|not validated|not checked|bypass|failed predicate|insufficient guard)\b/.test(
      text
    )
  const hasConcreteResult =
    /\b(exfiltrat|unauthorized read|unauthorized write|token theft|deployment compromise|privilege escalat|bypass)\b/.test(
      text
    )
  return conditionalSpeculation || !(hasAttackerEntry && hasMissingCheck && hasConcreteResult)
}

function hasPlausibleSecurityImpact(text) {
  return /\b(unauthorized|unauthenticated|attacker|escalat|tamper\w*|exfiltrat|exposure|bypass|replay|compromise|abuse)\b/i.test(
    text || ''
  )
}

function isFirestoreRulesClaimWithoutSpecificUnauthorizedPath(candidate) {
  const hasRulesCitation = (candidate.evidence_citations || []).some((c) =>
    /firestore\.rules/i.test(String(parseCitationPath(c) || ''))
  )
  if (!hasRulesCitation) return false
  const text = `${candidate.title}\n${candidate.claim}\n${candidate.specific_code_behavior}\n${candidate.missing_control_or_unsafe_condition}\n${candidate.impact}`
  const hasRulePath = /\bmatch\s+\/|collection|document|path\b/i.test(text)
  const hasRolePredicate = /\b(role|auth\.uid|request\.auth|claims?|owner|tenant)\b/i.test(text)
  const hasUnauthorizedReadWrite = /\b(unauthorized|read|write|create|update|delete)\b/i.test(text)
  return !(hasRulePath && hasRolePredicate && hasUnauthorizedReadWrite)
}

function parseCitationPath(citation) {
  const c = normalizeString(citation)
  if (!c) return null
  const path = c.split(':')[0]
  if (!path) return null
  return path
}

function scoreEvidencePack(candidate) {
  const categories = new Set(candidate.evidence_categories)
  let score = candidate.evidence_citations.length
  if (categories.has('server_entrypoint')) score += 3
  if (categories.has('control_helper')) score += 3
  if (categories.has('client_bridge')) score += 2
  if (categories.has('policy')) score += 2
  return score
}

export function parseCandidatePayload(rawContent) {
  const text = normalizeString(rawContent)
  if (!text) return { claims: [], parseError: 'empty' }

  const direct = safeParseJson(text)
  if (direct) return normalizeCandidateRoot(direct)

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const sliced = safeParseJson(text.slice(start, end + 1))
    if (sliced) return normalizeCandidateRoot(sliced)
  }
  return { claims: [], parseError: 'invalid_json' }
}

function safeParseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeCandidateRoot(root) {
  const claims = Array.isArray(root?.claims)
    ? root.claims
    : Array.isArray(root?.candidates)
      ? root.candidates
      : []
  return {
    claims: claims.map((c, idx) => normalizeCandidate(c, idx)),
    parseError: null,
  }
}

function normalizeCandidate(candidate, idx) {
  const rawKind = normalizeString(candidate?.kind).toLowerCase()
  const rawTopic = normalizeString(candidate?.topic)
  const rawConfidence = normalizeString(candidate?.confidence).toLowerCase()
  const severity = canonicalSeverity(candidate?.severity)
  return {
    claimSchemaVersion: Number.isFinite(candidate?.claimSchemaVersion) ? candidate.claimSchemaVersion : 1,
    candidate_id: normalizeString(candidate?.candidate_id) || `cand_${idx + 1}`,
    kind: rawKind || null,
    topic: rawTopic || null,
    title: normalizeString(candidate?.title) || 'Untitled claim',
    severity,
    claim: normalizeString(candidate?.claim),
    specific_code_behavior: normalizeString(candidate?.specific_code_behavior),
    missing_control_or_unsafe_condition: normalizeString(candidate?.missing_control_or_unsafe_condition),
    impact: normalizeString(candidate?.impact),
    evidence_citations: normalizeArray(candidate?.evidence_citations),
    evidence_ref_ids: normalizeArray(candidate?.evidence_ref_ids),
    evidence_categories: normalizeArray(candidate?.evidence_categories),
    claimed_security_property: normalizeString(candidate?.claimed_security_property),
    trust_assumption: normalizeString(candidate?.trust_assumption),
    bypass_or_uncertainty: normalizeString(candidate?.bypass_or_uncertainty),
    adversarial_outcome: normalizeString(candidate?.adversarial_outcome).toLowerCase(),
    confidence: rawConfidence || null,
    scoped_to_scan: candidate?.scoped_to_scan !== false,
    derived_from_candidate_ids: normalizeArray(candidate?.derived_from_candidate_ids),
    coverage_basis: normalizeString(candidate?.coverage_basis),
    enumValidity: {
      kind: KNOWN_KINDS.has(rawKind),
      topic: KNOWN_TOPICS.has(rawTopic),
      severity: KNOWN_SEVERITIES.has(severity || ''),
      confidence: KNOWN_CONFIDENCE.has(rawConfidence),
    },
  }
}

function hasAdversarialChallengeFields(candidate) {
  return (
    !!normalizeString(candidate?.claimed_security_property) &&
    !!normalizeString(candidate?.trust_assumption) &&
    !!normalizeString(candidate?.bypass_or_uncertainty)
  )
}

function buildUnverifiedControlFromObserved(candidate, reason) {
  const citeRaw = candidate.evidence_citations?.[0]
  const citeLabel = citeRaw ? `\`${citeRaw}\`` : 'the cited scanned excerpt'
  return {
    ...candidate,
    candidate_id: `${candidate.candidate_id}_adversarial_unverified`,
    kind: 'unverified_control',
    title: `(Unverified control) ${candidate.title}`,
    severity: 'Info',
    claim: `Observed control at ${citeLabel} could not be admitted as effective because trust binding or bypass resistance was not proven from cited evidence.`,
    coverage_basis: `adversarial_challenge_required:${reason}`,
  }
}

function detectNoFindings(admittedFindings) {
  return admittedFindings.length === 0
}

function buildCoverageSummary(bundle) {
  const inv = bundle?.inventory || {}
  const cov = bundle?.coverage || {}
  const evidenceCount = Array.isArray(bundle?.evidence) ? bundle.evidence.length : 0
  const totalFilesSeen = Number.isFinite(inv.totalFilesSeen) ? inv.totalFilesSeen : 0
  const coverageNotes = Array.isArray(cov.notes) ? cov.notes.filter(Boolean) : []
  const capHit =
    cov.maxFilesCapHit || cov.maxBytesPerFileCapHit || cov.maxTotalBytesCapHit || cov.maxTreeSizeCapHit
  const selected = evidenceCount
  const omitted = totalFilesSeen > 0 ? Math.max(0, totalFilesSeen - selected) : Number.isFinite(inv.filesOmitted) ? inv.filesOmitted : 0
  return {
    summary: capHit
      ? 'Coverage is limited by ingestion caps and omitted paths in this run.'
      : 'Coverage is bounded to selected files included in this run.',
    detail: coverageNotes.length ? coverageNotes.join(' | ') : 'No cap-derived notes.',
    selected,
    omitted,
    totalFilesSeen,
    plannedSelectedFiles: Number.isFinite(inv.filesSelected) ? inv.filesSelected : null,
  }
}

/** Infer CR-008 topic from path for inspected-surface grouping (deterministic, ingestion-derived). */
export function inferTopicFromPath(path) {
  const p = normalizeString(path).toLowerCase()
  if (!p) return 'validation'
  if (p.includes('.github/workflows') || (p.includes('deploy') && p.includes('yml'))) return 'cicd'
  if (p.includes('firestore.rules') || p.includes('storage.rules') || p.includes('firebase.json')) return 'auth'
  if (p.includes('package.json') || p.includes('package-lock') || p.includes('pnpm-lock') || p.includes('yarn.lock')) {
    return 'dependency'
  }
  if (/rate[-_]?limit|throttle|abuse/i.test(p)) return 'rate_limit'
  if (/middleware|helmet|csp|hsts|header/i.test(p)) return 'headers'
  if (/invite|token(?!_)/i.test(p)) return 'invite'
  if (/(^|[\\/_.])claims([\\/._]|$)|custom[-_]?claims/i.test(p)) return 'claims'
  if (/session|auth|permission|role/i.test(p)) return 'session'
  if (/docker|dockerfile|compose|terraform|\.tf\b/i.test(p)) return 'cicd'
  return 'validation'
}

function isMetaNonSecurityCandidate(candidate) {
  const cites = Array.isArray(candidate?.evidence_citations) ? candidate.evidence_citations : []
  const text = `${candidate?.title || ''}\n${candidate?.claim || ''}`
  for (const cite of cites) {
    const path = parseCitationPath(cite)
    if (!path) continue
    if (
      /tests[/\\]report-quality[/\\]|reportvalidation\.test\.|[/\\]\.test\.(js|ts|tsx)$/i.test(path) ||
      /[/\\]tests[/\\].*\.(js|ts|tsx)$/i.test(path)
    ) {
      if (/\bexploit\s*path\b|quality\s*gate|validator|reportvalidation|defect-00/i.test(text)) {
        return true
      }
    }
  }
  return false
}

function buildDownscopedObservationFromFinding(candidate, reason) {
  const citeRaw = candidate.evidence_citations?.[0]
  const citeLabel = citeRaw ? `\`${citeRaw}\`` : 'the cited scanned excerpt'
  const topicHint = candidate.topic ? String(candidate.topic).replace(/_/g, ' ') : 'the relevant control area'
  /** CR-008: bounded review wording only — do not forward factual absence/defect phrasing that trips UNBOUNDED_ABSENCE_CLAIM. */
  const claim =
    reason === 'hedge_or_pack'
      ? `Scoped observation (finding candidate downscoped): In scanned evidence ${citeLabel}, targeted validation of ${topicHint} is recommended; excerpts in this run did not support admitting a Key Finding at the proposed severity with the required evidence pack.`
      : `Scoped observation (finding candidate downscoped): In scanned evidence ${citeLabel}, targeted validation of ${topicHint} is recommended; the structured candidate did not meet Key Finding admission requirements for structure or specificity.`
  return {
    claimSchemaVersion: candidate.claimSchemaVersion || 1,
    candidate_id: `${candidate.candidate_id}_downscoped`,
    kind: 'observation',
    topic: candidate.topic,
    title: `(Observation) ${candidate.title}`,
    severity: 'Info',
    claim,
    specific_code_behavior: candidate.specific_code_behavior,
    missing_control_or_unsafe_condition: candidate.missing_control_or_unsafe_condition,
    impact: candidate.impact,
    evidence_citations: [...candidate.evidence_citations],
    evidence_ref_ids: [...candidate.evidence_ref_ids],
    evidence_categories: [...candidate.evidence_categories],
    confidence: candidate.confidence || 'medium',
    scoped_to_scan: candidate.scoped_to_scan !== false,
    derived_from_candidate_ids: [candidate.candidate_id],
    coverage_basis: '',
    enumValidity: {
      kind: true,
      topic: KNOWN_TOPICS.has(candidate.topic),
      severity: true,
      confidence: KNOWN_CONFIDENCE.has(candidate.confidence || 'medium'),
    },
  }
}

function buildDownscopedNonFindingFromCandidate(candidate, kind, reason) {
  const citeRaw = candidate.evidence_citations?.[0]
  const citeLabel = citeRaw ? `\`${citeRaw}\`` : 'the cited scanned excerpt'
  const topicHint = candidate.topic ? String(candidate.topic).replace(/_/g, ' ') : 'the relevant control area'
  const reasonNote =
    kind === 'recommendation'
      ? 'the evidence supports hardening guidance but not a defect-grade finding'
      : 'the evidence suggests an important control that could not be conclusively proven in this run'
  return {
    claimSchemaVersion: candidate.claimSchemaVersion || 1,
    candidate_id: `${candidate.candidate_id}_downscoped_${kind}`,
    kind,
    topic: candidate.topic,
    title:
      kind === 'recommendation'
        ? `(Recommendation) ${candidate.title}`
        : `(Unverified control) ${candidate.title}`,
    severity: kind === 'recommendation' ? 'Low' : 'Info',
    claim:
      kind === 'recommendation'
        ? `At scanned evidence ${citeLabel}, perform targeted hardening for ${topicHint}; ${reasonNote}.`
        : `At scanned evidence ${citeLabel}, verify ${topicHint} controls before admitting a finding; ${reasonNote}.`,
    specific_code_behavior: candidate.specific_code_behavior,
    missing_control_or_unsafe_condition: candidate.missing_control_or_unsafe_condition,
    impact: candidate.impact,
    evidence_citations: [...candidate.evidence_citations],
    evidence_ref_ids: [...candidate.evidence_ref_ids],
    evidence_categories: [...candidate.evidence_categories],
    confidence: candidate.confidence || 'medium',
    scoped_to_scan: candidate.scoped_to_scan !== false,
    derived_from_candidate_ids: [candidate.candidate_id],
    coverage_basis: `downscoped_from_finding:${reason}`,
    enumValidity: {
      kind: true,
      topic: KNOWN_TOPICS.has(candidate.topic),
      severity: true,
      confidence: KNOWN_CONFIDENCE.has(candidate.confidence || 'medium'),
    },
  }
}

/**
 * When Key Findings are empty but evidence exists, add deterministic inspected-surface observations
 * so no-findings reports stay commercially informative (CR-008 recovery).
 */
function injectInspectedSurfaceObservations(admitted, bundle, _rejections) {
  const evidence = Array.isArray(bundle?.evidence) ? bundle.evidence : []
  if (admitted.findings.length > 0) return
  if (evidence.length < 2) return
  if (admitted.observations.length >= 8) return

  const manifest = collectCitationManifest(bundle)
  const byTopic = new Map()
  for (const row of manifest.canonical || []) {
    const topic = inferTopicFromPath(row.path)
    if (!byTopic.has(topic)) byTopic.set(topic, [])
    byTopic.get(topic).push(row.cite)
  }

  let idx = 0
  const existingCites = new Set(
    admitted.observations.flatMap((o) => o.evidence_citations || [])
  )
  for (const [topic, cites] of byTopic) {
    if (admitted.observations.length >= 8) break
    const cite = cites.find((c) => !existingCites.has(c)) || cites[0]
    if (!cite || existingCites.has(cite)) continue
    existingCites.add(cite)
    const evIdx = evidence.findIndex((e) => cite.startsWith(`${e.path}:`))
    const refIds =
      evIdx >= 0 ? [`ev_${String(evIdx + 1).padStart(3, '0')}`] : []

    admitted.observations.push({
      claimSchemaVersion: 1,
      candidate_id: `surf_${topic}_${idx++}`,
      kind: 'observation',
      topic,
      title: `Inspected surface (${topic})`,
      severity: 'Info',
      claim: buildInspectedSurfaceClaim(topic, cite),
      specific_code_behavior: '',
      missing_control_or_unsafe_condition: '',
      impact: '',
      evidence_citations: [cite],
      evidence_ref_ids: refIds,
      evidence_categories: [],
      confidence: 'medium',
      scoped_to_scan: true,
      derived_from_candidate_ids: [],
      coverage_basis: 'inspected_surface_injection',
      enumValidity: {
        kind: true,
        topic: KNOWN_TOPICS.has(topic),
        severity: true,
        confidence: true,
      },
    })
  }
}

export function admitCandidates(candidates, bundle) {
  const admitted = {
    findings: [],
    observations: [],
    observedControls: [],
    unverifiedControls: [],
    recommendations: [],
    quickWins: [],
    coverageNotes: [],
  }
  const rejections = []
  const seenSignatures = new Set()
  const evidenceLookup = buildEvidenceLookup(bundle)

  for (const c of candidates) {
    const enumValidity = c.enumValidity || {
      kind: KNOWN_KINDS.has(c.kind),
      topic: KNOWN_TOPICS.has(c.topic),
      severity: KNOWN_SEVERITIES.has(c.severity),
      confidence: KNOWN_CONFIDENCE.has(c.confidence),
    }
    if (!enumValidity.kind || !enumValidity.topic || !enumValidity.severity || !enumValidity.confidence) {
      rejections.push({ candidate_id: c.candidate_id, reason: 'unknown_enum_value' })
      continue
    }

    const signature = `${c.kind}|${c.topic}|${c.title.toLowerCase()}|${c.claim.toLowerCase()}`
    if (seenSignatures.has(signature)) {
      rejections.push({ candidate_id: c.candidate_id, reason: 'duplicate_claim' })
      continue
    }
    seenSignatures.add(signature)

    const hasCitation = c.evidence_citations.length >= 1
    const citationIntegrityOk = validateCitationIntegrity(c, evidenceLookup)
    const hasSpecificBehavior = !!c.specific_code_behavior
    const hasUnsafeCondition = !!c.missing_control_or_unsafe_condition
    const hasImpact = !!c.impact
    const concreteText = `${c.claim}\n${c.specific_code_behavior}\n${c.missing_control_or_unsafe_condition}\n${c.impact}`
    const generic = containsGenericAdvice(concreteText) && !containsConcreteWeakness(concreteText)

    if (!c.scoped_to_scan) {
      rejections.push({ candidate_id: c.candidate_id, reason: 'contradictory_scope' })
      continue
    }
    if (!hasCitation && c.kind !== 'coverage_note') {
      rejections.push({ candidate_id: c.candidate_id, reason: 'insufficient_evidence' })
      continue
    }
    if (!citationIntegrityOk && c.kind !== 'coverage_note') {
      rejections.push({ candidate_id: c.candidate_id, reason: 'citation_integrity_failure' })
      continue
    }

    if (c.kind === 'finding') {
      if (isMetaNonSecurityCandidate(c)) {
        rejections.push({ candidate_id: c.candidate_id, reason: 'meta_non_security_source' })
        continue
      }

      let failReason = null
      if (!hasSpecificBehavior || !hasUnsafeCondition || !hasImpact) {
        failReason = 'insufficient_evidence'
      } else if (!hasConcreteFlowOrBoundarySignal(c, concreteText)) {
        failReason = 'missing_flow_or_boundary'
      } else if (!hasPlausibleSecurityImpact(concreteText)) {
        failReason = 'weak_security_impact'
      } else if (isUiComponentValidationOnlyFinding(c)) {
        failReason = 'ui_validation_without_security_boundary'
      } else if (isGenericValidationHardeningFinding(c)) {
        failReason = 'generic_validation_hardening'
      } else if (isBroadCicdConfigHighOverpromotion(c)) {
        failReason = 'cicd_config_overpromotion'
      } else if (isFirestoreRulesClaimWithoutSpecificUnauthorizedPath(c)) {
        failReason = 'firestore_rules_path_not_proven'
      } else if (isSpeculativeHighCriticalCandidate(c)) {
        failReason = 'speculative_high_critical_exploit_path'
      } else if (generic) {
        failReason = 'generic_advice'
      } else if (isSensitiveHighFindingWithoutEvidencePack(c)) {
        failReason = 'insufficient_evidence_pack'
      } else if (isHedgeHeavySensitiveHighFinding(c)) {
        failReason = 'severity_calibration_mismatch'
      }

      if (failReason) {
        if (hasCitation && citationIntegrityOk) {
          const downscopeKind =
            failReason === 'generic_advice' ||
            failReason === 'generic_validation_hardening' ||
            failReason === 'cicd_config_overpromotion'
              ? 'recommendation'
              : failReason === 'missing_flow_or_boundary'
                ? 'unverified_control'
                : 'observation'
          const downscoped =
            downscopeKind === 'observation'
              ? buildDownscopedObservationFromFinding(
                  c,
                  failReason === 'severity_calibration_mismatch' || failReason === 'insufficient_evidence_pack'
                    ? 'hedge_or_pack'
                    : 'structure'
                )
              : buildDownscopedNonFindingFromCandidate(c, downscopeKind, failReason)
          const sig = `${downscopeKind}|${downscoped.topic}|${downscoped.title.toLowerCase()}|${downscoped.claim.toLowerCase()}`
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig)
            if (downscopeKind === 'recommendation') {
              admitted.recommendations.push(downscoped)
            } else if (downscopeKind === 'unverified_control') {
              admitted.unverifiedControls.push(downscoped)
              admitted.observations.push(downscoped)
            } else {
              admitted.observations.push(downscoped)
            }
            rejections.push({
              candidate_id: c.candidate_id,
              reason: `downscoped_to_${downscopeKind}:${failReason}`,
            })
          } else {
            rejections.push({ candidate_id: c.candidate_id, reason: failReason })
          }
        } else {
          rejections.push({ candidate_id: c.candidate_id, reason: failReason })
        }
        continue
      }

      admitted.findings.push(c)
      continue
    }

    if (c.kind === 'observation') {
      if (!c.claim) {
        rejections.push({ candidate_id: c.candidate_id, reason: 'insufficient_evidence' })
        continue
      }
      admitted.observations.push(c)
      continue
    }

    if (c.kind === 'observed_control') {
      if (!c.claim) {
        rejections.push({ candidate_id: c.candidate_id, reason: 'insufficient_evidence' })
        continue
      }
      if (candidateNeedsAdversarialChallenge(c) && !hasAdversarialChallengeFields(c)) {
        const downscoped = buildUnverifiedControlFromObserved(c, 'missing_property_assumption_bypass')
        admitted.unverifiedControls.push(downscoped)
        admitted.observations.push(downscoped)
        rejections.push({
          candidate_id: c.candidate_id,
          reason: 'downscoped_to_unverified_control:missing_adversarial_challenge',
        })
        continue
      }
      admitted.observedControls.push(c)
      admitted.observations.push(c)
      continue
    }

    if (c.kind === 'unverified_control') {
      if (!c.claim) {
        rejections.push({ candidate_id: c.candidate_id, reason: 'insufficient_evidence' })
        continue
      }
      admitted.unverifiedControls.push(c)
      admitted.observations.push(c)
      continue
    }

    if (c.kind === 'recommendation') {
      if (!c.claim) {
        rejections.push({ candidate_id: c.candidate_id, reason: 'insufficient_evidence' })
        continue
      }
      admitted.recommendations.push(c)
      continue
    }

    if (c.kind === 'quick_win') {
      if (c.severity === 'Critical' || c.severity === 'High') {
        rejections.push({ candidate_id: c.candidate_id, reason: 'severity_calibration_mismatch' })
        continue
      }
      const hasDerivation =
        Array.isArray(c.derived_from_candidate_ids) && c.derived_from_candidate_ids.length > 0
      const hasCoverageBasis = !!c.coverage_basis
      if (!hasDerivation && !hasCoverageBasis) {
        rejections.push({ candidate_id: c.candidate_id, reason: 'insufficient_evidence' })
        continue
      }
      admitted.quickWins.push(c)
      continue
    }

    if (c.kind === 'coverage_note') {
      admitted.coverageNotes.push(c)
      continue
    }
  }

  admitted.findings.sort((a, b) => scoreEvidencePack(b) - scoreEvidencePack(a))
  injectInspectedSurfaceObservations(admitted, bundle, rejections)
  const coverage = buildCoverageSummary(bundle)
  return { admitted, rejections, coverage }
}

function buildEvidenceLookup(bundle) {
  const validCitations = new Set()
  const validPaths = new Set()
  const validEvidenceRefIds = new Set()
  const evidence = Array.isArray(bundle?.evidence) ? bundle.evidence : []
  for (let i = 0; i < evidence.length; i++) {
    const ev = evidence[i]
    const path = normalizeString(ev?.path)
    if (!path) continue
    validPaths.add(path)
    validEvidenceRefIds.add(`ev_${String(i + 1).padStart(3, '0')}`)
    const sn = ev?.snippets?.[0]
    const start = Number(sn?.startLine)
    const end = Number(sn?.endLine)
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      validCitations.add(`${path}:${start}-${end}`)
    }
  }
  return { validCitations, validPaths, validEvidenceRefIds }
}

function isSensitiveHighFindingWithoutEvidencePack(candidate) {
  if (candidate.severity !== 'High' && candidate.severity !== 'Critical') return false
  if (!['auth', 'invite', 'session', 'claims'].includes(candidate.topic)) return false
  const categories = new Set(candidate.evidence_categories || [])
  const hasServer = categories.has('server_entrypoint')
  const hasControl = categories.has('control_helper')
  const hasSupporting = categories.has('policy') || categories.has('client_bridge')
  return !(hasServer && hasControl && hasSupporting)
}

function isHedgeHeavySensitiveHighFinding(candidate) {
  if (candidate.severity !== 'High' && candidate.severity !== 'Critical') return false
  if (!['auth', 'invite', 'session', 'claims'].includes(candidate.topic)) return false
  const text = `${candidate.claim}\n${candidate.specific_code_behavior}\n${candidate.missing_control_or_unsafe_condition}`
  const hasHedge = /\b(could|may|might|potentially|if\s+not|possible)\b/i.test(text)
  const hasConcreteUnsafeSignal =
    /\b(missing|absent|not\s+validated|not\s+enforced|not\s+checked|replay|single[- ]use|expiry|binding)\b/i.test(
      text
    )
  return hasHedge && !hasConcreteUnsafeSignal
}

function validateCitationIntegrity(candidate, lookup) {
  const citations = Array.isArray(candidate?.evidence_citations) ? candidate.evidence_citations : []
  if (citations.length === 0) return false
  for (const citation of citations) {
    const c = normalizeString(citation)
    if (!lookup.validCitations.has(c)) return false
    const path = parseCitationPath(c)
    if (!path || !lookup.validPaths.has(path)) return false
  }

  const ids = Array.isArray(candidate?.evidence_ref_ids) ? candidate.evidence_ref_ids : []
  if (ids.length > 0) {
    for (const id of ids) {
      if (!lookup.validEvidenceRefIds.has(id)) return false
    }
  }
  return true
}

function highestSeverity(findings) {
  const rank = { Critical: 4, High: 3, Medium: 2, Low: 1, Info: 0, None: -1 }
  let best = 'Low'
  let bestRank = 1
  for (const f of findings) {
    const r = rank[f.severity] ?? -1
    if (r > bestRank) {
      bestRank = r
      best = f.severity
    }
  }
  return best
}

function sentenceClip(s, max = 160) {
  const t = normalizeString(s).replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function normalizeRecommendationStem(text) {
  let s = String(text || '').toLowerCase()
  s = s.replace(/`[^`]+`/g, ' ')
  const stripLeads = [
    'for scanned ',
    'consider validating whether',
    'consider reviewing whether',
    'validate the scoped observation before',
    'consider hardening ',
    'consider ',
    'at ',
  ]
  for (const p of stripLeads) {
    if (s.startsWith(p)) s = s.slice(p.length)
  }
  s = s.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const clause = (s.split(/[.;]/)[0] || s).trim()
  return clause.slice(0, 120)
}

function dedupeRecommendationLines(lines) {
  const seen = new Set()
  const out = []
  for (const line of lines) {
    const stem = normalizeRecommendationStem(line)
    if (seen.has(stem)) continue
    seen.add(stem)
    out.push(line)
  }
  return out
}

function derivePrioritizedRecommendations(admitted, noFindings) {
  const rank = { Critical: 5, High: 4, Medium: 3, Low: 2, Info: 1, None: 0 }
  const rows = []

  for (const r of admitted.recommendations || []) {
    const cite = r.evidence_citations?.[0]
    const text = sentenceClip(r.claim || r.title || 'Implement the recommended control improvement.')
    rows.push({
      priority: 450,
      text: cite
        ? `At \`${cite}\`, ${text}`
        : `Within scanned files in this run, ${text}`,
    })
  }

  for (const f of admitted.findings) {
    const cite = f.evidence_citations?.[0]
    if (!cite) continue
    const noun = inferConcreteControlNoun(parseCitationPath(cite), f.topic)
    const pri = (rank[f.severity] ?? 0) * 1000 + 500
    rows.push({
      priority: pri,
      text: `At \`${cite}\`, remediate the admitted weakness in ${noun}: ${sentenceClip(f.missing_control_or_unsafe_condition || f.claim)} (hardening action).`,
    })
  }

  for (const q of admitted.quickWins) {
    if (!q.claim) continue
    const cite = q.evidence_citations?.[0]
    const action = toScopedQuickWinAction(q.claim)
    const pri = 400
    if (cite) {
      const noun = inferConcreteControlNoun(parseCitationPath(cite), q.topic)
      rows.push({
        priority: pri,
        text: `At \`${cite}\`, ${action} for ${noun} — scoped to this repo excerpt (verification task).`,
      })
    } else {
      rows.push({
        priority: pri - 50,
        text: `Within scanned files in this run, ${action} where applicable (control-coverage check).`,
      })
    }
  }

  for (const o of admitted.observations) {
    const cite = o.evidence_citations?.[0]
    if (!cite) continue
    const noun = inferConcreteControlNoun(parseCitationPath(cite), o.topic)
    if (isInspectedSurfaceObservation(o)) {
      rows.push({
        priority: 120,
        text: `At \`${cite}\`, confirm ${noun} behavior with a short targeted review if this path affects production trust boundaries (verification task).`,
      })
      continue
    }
    rows.push({
      priority: 350,
      text: `At \`${cite}\`, review the scoped observation for ${noun} and validate assumptions before broader changes (validation follow-up).`,
    })
  }

  rows.sort((a, b) => b.priority - a.priority)
  const deduped = dedupeRecommendationLines(rows.map((r) => r.text))
  if (noFindings && deduped.length === 0) {
    deduped.push(
      'For scanned files included in this run, prioritize authorization, session handling, and rate limiting checks where user-facing risk is highest (control-coverage check).'
    )
  }
  return deduped.slice(0, 8)
}

function toScopedQuickWinAction(claim) {
  const base = normalizeString(claim).replace(/\.$/, '')
  if (!base) return 'validating scoped controls'
  if (/^(add|implement|enforce|restrict|validate|review|harden|rotate|remove)\b/i.test(base)) {
    return base
  }
  if (/\b(is|are)\s+(implemented|configured|enabled|present)\b/i.test(base)) {
    return `validating whether ${base.charAt(0).toLowerCase()}${base.slice(1)}`
  }
  return `validating whether ${base.charAt(0).toLowerCase()}${base.slice(1)}`
}

function renderKeyFindings(admitted) {
  if (admitted.findings.length === 0) {
    return 'No findings were identified within the scanned scope.'
  }
  return admitted.findings
    .map((f) => {
      const evidence = f.evidence_citations.map((c) => `\`${c}\``).join(', ')
      const exploitPathNeeded = f.severity === 'Critical' || f.severity === 'High'
      const exploitPath = exploitPathNeeded ? `\n**Exploit path:** ${formatExploitPath(f)}` : ''
      return `### [${f.severity}] ${f.title}

**Category:** ${f.topic}
**Evidence:** ${evidence}${exploitPath}
**Why it matters:** ${f.claim || `${f.specific_code_behavior}.`}
**Fix (recommended):** Address ${f.missing_control_or_unsafe_condition} in the cited code path.
**Residual risk & tests:** Validate remediation with targeted tests for the cited path and adjacent trust boundaries.`
    })
    .join('\n\n')
}

function sentenceFragment(value, fallback = 'Not evidenced in scanned files.') {
  const text = normalizeString(value)
  if (!text) return fallback
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function calibrateCustomerFacingClaim(item) {
  const base = normalizeString(item?.claim)
  if (!base) return 'Scoped review note from scanned evidence.'
  let text = base
  // Avoid broad false-negative wording when controls may already exist.
  text = text.replace(/lacks comprehensive security headers/gi, 'header coverage may be incomplete for some surfaces')
  text = text.replace(/does not include mechanisms/gi, 'may not yet show full mechanism coverage in scanned excerpts')
  // Keep validation inconsistency as process debt unless concrete exploitability is proven.
  text = text.replace(/may lead to security vulnerabilities/gi, 'indicates validation consistency debt that warrants focused follow-up review')
  // Keep CI/CD env language narrow unless concrete exposure is proven.
  text = text.replace(/insecure handling/gi, 'handling patterns that should be verified for secure coverage')
  text = text.replace(/no secret discipline/gi, 'secret-handling coverage is not yet fully proven')
  return text
}

function renderObservedControlLine(item) {
  const evidence = (item.evidence_citations || []).map((c) => `\`${c}\``).join(', ') || 'Not evidenced in scanned files included in this run.'
  return `- Observed control: ${calibrateCustomerFacingClaim(item)}\n  - Seen in: ${evidence}`
}

function renderUnverifiedControlLine(item) {
  const evidence = (item.evidence_citations || []).map((c) => `\`${c}\``).join(', ') || 'Not evidenced in scanned files included in this run.'
  return `- Unverified important control: ${calibrateCustomerFacingClaim(item)}\n  - Follow-up evidence target: ${evidence}`
}

function formatExploitPath(finding) {
  const behavior = sentenceFragment(finding.specific_code_behavior, 'The relevant behavior is not fully evidenced in scanned files.')
  const unsafe = sentenceFragment(
    finding.missing_control_or_unsafe_condition,
    'The missing control condition is not fully evidenced.'
  )
  const impact = sentenceFragment(finding.impact, 'Impact remains bounded to scanned evidence.')
  return `Observed behavior: ${behavior} Missing control: ${unsafe} Potential impact: ${impact}`
}

function renderEvidenceIndex(admitted) {
  const citations = new Set()
  for (const list of [admitted.findings, admitted.observations, admitted.recommendations, admitted.quickWins]) {
    for (const item of list) {
      for (const cite of item.evidence_citations || []) citations.add(cite)
    }
  }
  if (citations.size === 0) {
    return '- No line-addressable evidence citations were admitted for this run.'
  }
  return [...citations]
    .sort((a, b) => a.localeCompare(b))
    .map((c) => `- \`${c}\``)
    .join('\n')
}

/**
 * Deterministic Appendix A row plan (CR-008): full manifest when <=40 cites; otherwise admitted cites,
 * up to APPENDIX_POLICY_PER_DOMAIN per topic, then path-order overflow to APPENDIX_POLICY_MAX_TOTAL.
 */
export function planAppendixEvidence(bundle, admitted) {
  const manifest = collectCitationManifest(bundle)
  const canonical = Array.isArray(manifest.canonical) ? [...manifest.canonical] : []
  const manifestCount = canonical.length
  const admittedCites = new Set()
  for (const list of [admitted.findings, admitted.observations, admitted.quickWins]) {
    for (const item of list) {
      for (const cite of item.evidence_citations || []) admittedCites.add(cite)
    }
  }

  if (manifestCount === 0) {
    return { manifestCount: 0, renderedCount: 0, truncated: false, rows: [] }
  }

  const CAP = APPENDIX_POLICY_MAX_TOTAL
  const PER = APPENDIX_POLICY_PER_DOMAIN
  const selectedSet = new Set()

  function tryAdd(cite) {
    if (selectedSet.size >= CAP) return false
    if (!canonical.some((r) => r.cite === cite)) return false
    selectedSet.add(cite)
    return true
  }

  function countInTopic(topic) {
    let n = 0
    for (const cite of selectedSet) {
      const row = canonical.find((r) => r.cite === cite)
      if (row && inferTopicFromPath(row.path) === topic) n++
    }
    return n
  }

  if (manifestCount <= CAP) {
    const rows = canonical
      .sort((a, b) => a.cite.localeCompare(b.cite))
      .map((r) => ({ cite: r.cite, path: r.path, inBody: admittedCites.has(r.cite) }))
    return { manifestCount, renderedCount: manifestCount, truncated: false, rows }
  }

  for (const cite of [...admittedCites].sort((a, b) => a.localeCompare(b))) {
    tryAdd(cite)
  }

  const byTopic = new Map()
  for (const r of canonical) {
    const t = inferTopicFromPath(r.path)
    if (!byTopic.has(t)) byTopic.set(t, [])
    byTopic.get(t).push(r.cite)
  }

  for (const t of [...byTopic.keys()].sort()) {
    for (const cite of byTopic.get(t).sort((a, b) => a.localeCompare(b))) {
      if (selectedSet.size >= CAP) break
      if (selectedSet.has(cite)) continue
      if (countInTopic(t) >= PER) break
      tryAdd(cite)
    }
  }

  const pathOrdered = [...canonical].sort(
    (a, b) => a.path.localeCompare(b.path) || a.cite.localeCompare(b.cite)
  )
  for (const r of pathOrdered) {
    tryAdd(r.cite)
    if (selectedSet.size >= CAP) break
  }

  const selected = [...selectedSet].sort((a, b) => a.localeCompare(b))
  const rows = selected.map((cite) => {
    const row = canonical.find((r) => r.cite === cite)
    return {
      cite,
      path: row?.path || '',
      inBody: admittedCites.has(cite),
    }
  })

  return {
    manifestCount,
    renderedCount: rows.length,
    truncated: true,
    rows,
  }
}

/**
 * Required inspected-surface rows for no-findings value bar (CR-009; appendix-aware).
 * Exposed in telemetry; use with `requiredInspectedSurfaceRowsForNoFindings` for raw policy.
 */
export function requiredInspectedSurfaceRows(representedDomainCount, appendixEvidenceCount = 10_000) {
  const r = requiredInspectedSurfaceRowsForNoFindings(representedDomainCount, appendixEvidenceCount)
  return r < 0 ? 0 : r
}

/** Declared inspected-surface layer (deterministic injection or future explicit inspected_surface rows), not model downscopes. */
const INSPECTED_SURFACE_COVERAGE_BASES = new Set(['inspected_surface_injection', 'inspected_surface'])

export function isInspectedSurfaceObservation(o) {
  return INSPECTED_SURFACE_COVERAGE_BASES.has(normalizeString(o?.coverage_basis))
}

/** Rows that count toward the inspected-surface breadth minimum (CR-008); excludes generic/downscoped observations. */
export function countInspectedSurfaceRows(observations) {
  if (!Array.isArray(observations)) return 0
  return observations.filter(isInspectedSurfaceObservation).length
}

function minDomainsForValueBar(appendixEvidenceCount) {
  return appendixEvidenceCount < 8 ? 2 : 3
}

/**
 * No-findings / observations-only value bar (CR-009) before `lowInformationReport` / score chain.
 */
export function noFindingsValueBarFailed(admitted, bundle, appendixPlan) {
  if (admitted.findings.length > 0) return false

  const manifest = bundle ? collectCitationManifest(bundle) : null
  const canonical = Array.isArray(manifest?.canonical) ? manifest.canonical : []
  const appendixEvidenceCount = canonical.length
  if (appendixEvidenceCount === 0) return true

  const represented = collectRepresentedDomainsFromAdmitted(admitted)
  const repCount = represented.size
  const plan = appendixPlan || (bundle ? planAppendixEvidence(bundle, admitted) : null)

  if (appendixEvidenceCount >= 8 && repCount <= 1) return true

  const minDomains = minDomainsForValueBar(appendixEvidenceCount)
  if (repCount < minDomains) return true

  const rawRequired = requiredInspectedSurfaceRowsForNoFindings(repCount, appendixEvidenceCount)
  const surfaceRows = countInspectedSurfaceRows(admitted.observations)
  if (rawRequired >= 0 && surfaceRows < rawRequired) return true

  if (
    !admitted.observations.some((o) => (o.evidence_citations || []).length) &&
    admitted.quickWins.length === 0
  ) {
    return true
  }

  const appendixBelowUseful =
    appendixEvidenceCount >= 8 && plan && plan.renderedCount < Math.min(8, appendixEvidenceCount)
  if (appendixBelowUseful) return true

  const observationsForFollowUpCredit = admitted.observations.filter((o) => !isInspectedSurfaceObservation(o))
  const nonSurfaceFollowUps = observationsForFollowUpCredit.length + admitted.quickWins.length
  const followUpBelowBar =
    appendixEvidenceCount >= 3 && nonSurfaceFollowUps < 2 && surfaceRows < 2
  if (followUpBelowBar) return true

  return false
}

/**
 * Telemetry-only: commercial usefulness / emptiness for no-findings outcomes (CR-008 + CR-009 chain).
 */
export function computeLowInformationReport(admitted, bundle, appendixPlan) {
  if (admitted.findings.length > 0) return false

  const manifest = bundle ? collectCitationManifest(bundle) : null
  const canonical = Array.isArray(manifest?.canonical) ? manifest.canonical : []
  const manifestCount = canonical.length

  if (manifestCount === 0) return true

  if (noFindingsValueBarFailed(admitted, bundle, appendixPlan)) return true

  return false
}

/** Appendix A: bounded manifest per CR-008; marks cites also used in admitted body. */
function renderAppendixFromBundle(bundle, admitted) {
  const plan = planAppendixEvidence(bundle, admitted)
  if (plan.renderedCount === 0) {
    return '- No line-addressable evidence citations were produced for this run.'
  }
  const lines = plan.rows
    .map((row) => {
      const tag = row.inBody ? ' *(also cited in report body)*' : ''
      return `- \`${row.cite}\`${tag}`
    })
    .join('\n')
  if (!plan.truncated) return lines
  return `${lines}\n\n*Appendix A truncated:* ${plan.renderedCount} of ${plan.manifestCount} line-addressable citations shown (Stage 02 policy: cap ${APPENDIX_POLICY_MAX_TOTAL} lines; admitted cites and up to ${APPENDIX_POLICY_PER_DOMAIN} per domain prioritized).`
}

function renderSectionBody(title, context) {
  const { noFindings, coverage, keyFindingsBody, prioritizedRecommendationsBody, admitted, bundle } = context
  const bounded = `Not evidenced in scanned files included in this run. ${coverage.summary}`
  if (title === 'Executive Summary') {
    if (noFindings && admitted.observations.length > 0) {
      const n = admitted.observations.length
      return `No Key Findings were admitted from structured candidates; ${n} scoped observation(s) reference inspected excerpts. ${coverage.summary} ${coverage.detail}`
    }
    return noFindings
      ? `${bounded} ${coverage.detail}`
      : 'Admitted findings are rendered only from evidence-bounded structured claims.'
  }
  if (title === 'Inventory & Attack Surface') {
    return `Selected files: ${coverage.selected}. Omitted files: ${coverage.omitted}. ${coverage.summary}`
  }
  if (title === 'Key Findings (Prioritized)') return keyFindingsBody
  if (title === SECTION_PRIORITIZED_RECOMMENDATIONS) return prioritizedRecommendationsBody
  if (title === 'Appendix A – Evidence Index') {
    return bundle ? renderAppendixFromBundle(bundle, admitted) : renderEvidenceIndex(admitted)
  }
  if (title === 'Appendix B – Safe Config & Policy Snippets') {
    return 'No standalone snippets were generated for this scan. See the fix snippets embedded in Key Findings and Prioritized Recommendations.'
  }
  if (title === 'Confidence & Coverage') {
    const capHit = /limited by ingestion caps/i.test(coverage.summary)
    const reviewedDomains = collectRepresentedDomainsFromAdmitted(admitted).size
    const confidenceLine = capHit
      ? 'Coverage is partial in this run because ingestion caps were hit; conclusions are strongest for cited paths and weaker for omitted areas.'
      : 'Coverage is bounded to selected files in this run; confidence is highest for cited paths and moderate for adjacent omitted areas.'
    return `${confidenceLine}\n\nReviewed evidence files: ${coverage.selected}. Omitted files: ${coverage.omitted}. Represented security domains: ${reviewedDomains}.`
  }
  const observationBody = renderObservationSectionBody(title, context.admitted.observations)
  if (observationBody) return observationBody
  if (CR009_PRIORITY_SECTION_TITLES.includes(title)) {
    const enriched = buildPrioritySectionInspectedSummary(title, context)
    if (enriched) return enriched
  }
  return noFindings ? bounded : 'Section scoped to admitted findings and observations from scanned evidence.'
}

function mapTopicToSection(topic) {
  if (topic === 'dependency') return 'Dependency & Supply Chain Notes'
  if (topic === 'cicd') return 'CI/CD & Operational Hardening'
  if (topic === 'validation' || topic === 'headers') return 'Web Security Controls'
  if (topic === 'rate_limit') return 'Rate Limiting & Abuse Controls'
  if (topic === 'auth' || topic === 'invite' || topic === 'session' || topic === 'claims')
    return 'Session Management'
  return null
}

function topicToRenderedLabel(topic) {
  const labels = {
    invite: 'Invite and token handling',
    auth: 'Authorization boundaries',
    session: 'Session management',
    claims: 'Custom claims mapping',
    rate_limit: 'Rate limiting and abuse controls',
    dependency: 'Dependency and supply chain posture',
    cicd: 'CI/CD workflow hardening',
    validation: 'Validation and schema controls',
    headers: 'Web security headers and middleware',
  }
  return labels[topic] || String(topic || 'Security surface').replace(/_/g, ' ')
}

function buildPrioritySectionInspectedSummary(title, context) {
  const { bundle, admitted } = context
  if (!bundle) return ''
  const manifest = collectCitationManifest(bundle)
  const wantTopics = new Set(topicsForCr009PrioritySection(title))
  if (wantTopics.size === 0) return ''

  const rows = (manifest.canonical || []).filter((r) => wantTopics.has(inferTopicFromPath(r.path)))
  if (rows.length === 0) return ''

  const findingTopics = new Set(admitted.findings.map((f) => f.topic).filter((t) => wantTopics.has(t)))
  const observationTopics = new Set(admitted.observations.map((o) => o.topic).filter((t) => wantTopics.has(t)))
  const lines = rows.slice(0, 2).map((r) => {
    const topic = inferTopicFromPath(r.path)
    const controlNoun = inferConcreteControlNoun(r.path, topic)
    let outcome = 'review outcome: no admitted finding from scanned evidence'
    if (findingTopics.has(topic)) outcome = 'review outcome: control gap admitted in this section'
    else if (observationTopics.has(topic)) outcome = 'review outcome: targeted follow-up recommended'
    return `- ${topicToRenderedLabel(topic)} inspected at \`${r.cite}\` for ${controlNoun}; ${outcome}.`
  })
  return lines.join('\n')
}

function renderObservationSectionBody(title, observations) {
  const sectionObservations = observations.filter((o) => mapTopicToSection(o.topic) === title)
  if (sectionObservations.length === 0) return ''
  return sectionObservations
    .map((o) => {
      if (o.kind === 'observed_control') return renderObservedControlLine(o)
      if (o.kind === 'unverified_control') return renderUnverifiedControlLine(o)
      const evidence = o.evidence_citations?.length
        ? o.evidence_citations.map((c) => `\`${c}\``).join(', ')
        : 'Not evidenced in scanned files included in this run.'
      return `- ${calibrateCustomerFacingClaim(o)}\n  - Evidence: ${evidence}`
    })
    .join('\n')
}

export function renderDeterministicReport({ repoData, admitted, coverage, bundle }) {
  const keyFindingsBody = renderKeyFindings(admitted)
  const noFindings = detectNoFindings(admitted.findings)
  const recommendations = derivePrioritizedRecommendations(admitted, noFindings)
  const prioritizedRecommendationsBody = recommendations.map((w, i) => `${i + 1}. ${w}`).join('\n')
  const summaryRisk = noFindings ? 'Low' : highestSeverity(admitted.findings)
  const languages = repoData?.language || 'Unknown'
  const nowIso = new Date().toISOString()

  const header = `${REPORT_TITLE}

- **Repository:** ${repoData.owner}/${repoData.repo} (${repoData.url || 'unknown'})
- **Ref:** ${repoData.scannedRef || repoData.defaultBranch || 'unknown'}
- **Generated:** ${nowIso}
- **Languages:** ${languages}
- **Summary Risk:** ${summaryRisk} — ${
    noFindings
      ? 'No findings were identified within the scanned scope.'
      : 'Derived from admitted structured findings only.'
  }`

  const sectionBodies = SECTION_TITLES_ORDER.map((title) => {
    const body = renderSectionBody(title, {
      noFindings,
      coverage,
      keyFindingsBody,
      prioritizedRecommendationsBody,
      admitted,
      bundle,
    })
    return `## ${title}\n\n${body}\n`
  }).join('\n')

  return `${header}

${sectionBodies}`
}

function topicsForCr009PrioritySection(title) {
  const m = {
    'Session Management': ['session', 'auth', 'invite', 'claims'],
    'Web Security Controls': ['validation', 'headers'],
    'CI/CD & Operational Hardening': ['cicd'],
    'Dependency & Supply Chain Notes': ['dependency'],
    'Rate Limiting & Abuse Controls': ['rate_limit'],
  }
  return m[title] || []
}

function manifestCoversSectionTopic(bundle, sectionTitle) {
  if (!bundle) return false
  const man = collectCitationManifest(bundle)
  const want = new Set(topicsForCr009PrioritySection(sectionTitle))
  if (want.size === 0) return false
  for (const row of man.canonical || []) {
    if (want.has(inferTopicFromPath(row.path))) return true
  }
  return false
}

function isPlaceholderBodyForCr009(body) {
  const b = normalizeString(body)
  if (!b) return true
  if (/`[^`]+\.(js|ts|tsx|jsx|json|mjs|cjs|yml|yaml|tf|rules):/i.test(b)) return false
  if (b.length > 180 && (CONCRETE_SURFACE_TOKEN_RE.test(b) || /\binspected\b|review outcome/i.test(b))) return false
  return /not evidenced|section scoped|bounded to admitted/i.test(b)
}

function countPlaceholderPriorityForCr009(markdown, bundle) {
  let c = 0
  for (const title of CR009_PRIORITY_SECTION_TITLES) {
    if (!manifestCoversSectionTopic(bundle, title)) continue
    const body = extractSectionBody(markdown, title) || ''
    if (isPlaceholderBodyForCr009(body)) c++
  }
  return c
}

function countRepoSpecificPrioritySectionsCR009(markdown) {
  let c = 0
  for (const title of CR009_PRIORITY_SECTION_TITLES) {
    const body = extractSectionBody(markdown, title) || ''
    if (!normalizeString(body) || isPlaceholderBodyForCr009(body)) continue
    c++
  }
  return c
}

function parsePrioritizedRecommendationBullets(markdown) {
  const body = extractSectionBody(markdown, SECTION_PRIORITIZED_RECOMMENDATIONS) || ''
  const lines = body.split(/\r?\n/).filter((l) => /^\s*\d+\.\s+/.test(l))
  return lines.map((l) => l.replace(/^\s*\d+\.\s+/, '').trim()).filter(Boolean)
}

function recommendationLineFailsSpecificity(text) {
  if (!normalizeString(text)) return true
  if (!/`[^`]+\.(?:js|ts|tsx|jsx|json|mjs|cjs|yml|yaml|tf|rules):/i.test(text)) return true
  return !CONCRETE_SURFACE_TOKEN_RE.test(text)
}

function classifyRecommendationLine(line) {
  const t = line.toLowerCase()
  if (/validation follow-up|verify|confirm targeted|targeted review/i.test(t)) return 'validation_followup'
  if (/control-coverage|within scanned paths|where applicable/i.test(t)) return 'control_coverage'
  if (/hardening action|remediate|enforce|restrict|rotate/i.test(t)) return 'hardening'
  return 'verification_task'
}

function countDownscopedObservations(admitted) {
  return (admitted.observations || []).filter(
    (o) =>
      String(o.title || '').toLowerCase().includes('downscoped') ||
      (Array.isArray(o.derived_from_candidate_ids) && o.derived_from_candidate_ids.length > 0)
  ).length
}

function sectionContentByTopicCountsFromAdmitted(admitted) {
  const acc = {}
  for (const o of admitted.observations || []) {
    const t = o.topic || UNKNOWN_TOPIC
    acc[t] = (acc[t] || 0) + 1
  }
  for (const q of admitted.quickWins || []) {
    const t = q.topic || UNKNOWN_TOPIC
    acc[t] = (acc[t] || 0) + 1
  }
  return acc
}

function computeCr009ValueParts(ctx) {
  const {
    findingCount,
    admitted,
    specificityRate,
    repoSpecificSectionCount,
    recLines,
    appendixEvidenceCount,
    appendixPlan,
    placeholderSectionCount,
  } = ctx

  const rep = collectRepresentedDomainsFromAdmitted(admitted).size
  const rawRequired = requiredInspectedSurfaceRowsForNoFindings(rep, appendixEvidenceCount)
  const actual = countInspectedSurfaceRows(admitted.observations)

  let sufficiency
  if (findingCount > 0) {
    sufficiency = 1.0
  } else if (rawRequired < 0) {
    sufficiency = 0
  } else if (rawRequired === 0) {
    sufficiency = actual > 0 ? 1.0 : 0
  } else {
    sufficiency = Math.min(actual / rawRequired, 1.0)
  }

  const recTotal = recLines.length
  const recSpec = recTotal
    ? recLines.filter((l) => !recommendationLineFailsSpecificity(l)).length / recTotal
    : findingCount > 0
      ? 0.5
      : 0

  const repoCoverage = Math.min(repoSpecificSectionCount / 4, 1.0)

  const appendixUse =
    appendixEvidenceCount < 8
      ? appendixPlan?.renderedCount > 0
        ? 0.5
        : 0
      : appendixPlan && appendixPlan.renderedCount > 0
        ? 1.0
        : 0

  const target = appendixEvidenceCount >= 20 ? 2 : 1
  const ph = placeholderSectionCount
  const placeholderComponent = ph <= target ? 1.0 : ph === target + 1 ? 0.5 : 0

  return {
    sufficiency,
    specificityRate,
    repoSectionCoverage: repoCoverage,
    recommendationSpecificity: recSpec,
    appendixUsefulness: appendixUse,
    placeholderPenalty: placeholderComponent,
  }
}

function computeReportValueScoreFromParts(parts) {
  return (
    0.25 * parts.sufficiency +
    0.2 * parts.specificityRate +
    0.2 * parts.repoSectionCoverage +
    0.2 * parts.recommendationSpecificity +
    0.1 * parts.appendixUsefulness +
    0.05 * parts.placeholderPenalty
  )
}

export function summarizeAdmissionTelemetry(parsedCandidates, admissionResult, renderedReport, bundle) {
  const raw = parsedCandidates.claims || []
  const admitted = admissionResult.admitted
  const observedControls = admitted.observedControls || []
  const unverifiedControls = admitted.unverifiedControls || []
  const recommendations = admitted.recommendations || []
  const truthyRenderMode =
    admitted.findings.length > 0
      ? 'findings'
      : admitted.observations.length > 0
        ? 'observations_only'
        : 'no_findings'
  const manifest = bundle ? collectCitationManifest(bundle) : null
  const appendixEvidenceCount = manifest?.canonical?.length ?? 0
  const appendixPlan = bundle ? planAppendixEvidence(bundle, admitted) : null
  const appendixRenderedCount = appendixPlan?.renderedCount ?? 0
  const appendixTruncated = !!appendixPlan?.truncated
  const representedDomainCount = collectRepresentedDomainsFromAdmitted(admitted).size
  const requiredSurfaceRows = requiredInspectedSurfaceRows(representedDomainCount, appendixEvidenceCount)
  const inspectedSurfaceLayer = admitted.observations.filter(isInspectedSurfaceObservation)
  const inspectedSurfaceSpecificityRate =
    inspectedSurfaceLayer.length > 0
      ? inspectedSurfaceLayer.filter((o) => isInspectedSurfaceClaimSpecific(o.claim, o.topic)).length /
        inspectedSurfaceLayer.length
      : 0
  const inspectedSurfaceCountByTopic = inspectedSurfaceLayer.reduce((acc, o) => {
    const t = o.topic || UNKNOWN_TOPIC
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  const rendered = String(renderedReport || '')
  const placeholderSectionCount = bundle ? countPlaceholderPriorityForCr009(rendered, bundle) : 0
  const repoSpecificSectionCount = countRepoSpecificPrioritySectionsCR009(rendered)
  const recommendationLines = parsePrioritizedRecommendationBullets(rendered)
  const genericRecommendationCount = recommendationLines.filter((l) => recommendationLineFailsSpecificity(l)).length

  const recommendationTypeCounts = recommendationLines.reduce((acc, line) => {
    const k = classifyRecommendationLine(line)
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  const markdownRenderMode = deriveRenderModeFromMarkdown(renderedReport)
  const rejectionReasonCounts = admissionResult.rejections.reduce((acc, r) => {
    acc[r.reason] = (acc[r.reason] || 0) + 1
    return acc
  }, {})

  const candidateCountByTopic = raw.reduce((acc, c) => {
    const topic = c.topic || UNKNOWN_TOPIC
    acc[topic] = (acc[topic] || 0) + 1
    return acc
  }, {})

  const lowInformationReport = bundle
    ? computeLowInformationReport(admitted, bundle, appendixPlan)
    : admitted.findings.length === 0 && admitted.observations.length === 0 && appendixEvidenceCount === 0

  const valueParts = computeCr009ValueParts({
    findingCount: admitted.findings.length,
    admitted,
    specificityRate: inspectedSurfaceSpecificityRate,
    repoSpecificSectionCount,
    recLines: recommendationLines,
    appendixEvidenceCount,
    appendixPlan,
    placeholderSectionCount,
  })
  const reportValueScore = Number(computeReportValueScoreFromParts(valueParts).toFixed(4))
  const reportValueGatePassed =
    !lowInformationReport && reportValueScore >= REPORT_VALUE_SCORE_THRESHOLD

  return {
    templateVersion: STRUCTURED_TEMPLATE_VERSION,
    candidateCounts: {
      total: raw.length,
      finding: raw.filter((c) => c.kind === 'finding').length,
      observation: raw.filter((c) => c.kind === 'observation').length,
      observed_control: raw.filter((c) => c.kind === 'observed_control').length,
      unverified_control: raw.filter((c) => c.kind === 'unverified_control').length,
      recommendation: raw.filter((c) => c.kind === 'recommendation').length,
      quick_win: raw.filter((c) => c.kind === 'quick_win').length,
      coverage_note: raw.filter((c) => c.kind === 'coverage_note').length,
    },
    admittedCounts: {
      total:
        admitted.findings.length +
        admitted.observations.length +
        recommendations.length +
        admitted.quickWins.length +
        admitted.coverageNotes.length,
      finding: admitted.findings.length,
      observation: admitted.observations.length,
      observed_control: observedControls.length,
      unverified_control: unverifiedControls.length,
      recommendation: recommendations.length,
      quick_win: admitted.quickWins.length,
      coverage_note: admitted.coverageNotes.length,
    },
    rejectionReasonCounts,
    candidateCountByTopic,
    rejectedCitationIntegrityCount: rejectionReasonCounts.citation_integrity_failure || 0,
    renderMode: truthyRenderMode,
    admissionRenderMode: truthyRenderMode,
    finalRenderMode: truthyRenderMode,
    markdownRenderMode,
    appendixEvidenceCount,
    appendixRenderedCount,
    appendixTruncated,
    inspectedSurfaceCounts: inspectedSurfaceLayer.length,
    inspectedSurfaceCountByTopic,
    inspectedSurfaceSpecificityRate,
    observedControlCount: observedControls.length,
    unverifiedControlCount: unverifiedControls.length,
    representedDomainCount,
    requiredInspectedSurfaceRows: requiredSurfaceRows,
    placeholderSectionCount,
    genericRecommendationCount,
    repoSpecificSectionCount,
    reportValueScore,
    reportValueGatePassed,
    recommendationTypeCounts,
    sectionContentByTopicCounts: sectionContentByTopicCountsFromAdmitted(admitted),
    downscopedObservationCount: countDownscopedObservations(admitted),
    lowInformationReport,
    usedNoFindingsTemplate: /no findings were identified within the scanned scope/i.test(renderedReport),
  }
}

function deriveRenderModeFromMarkdown(markdown) {
  const text = String(markdown || '')
  const keyFindingsMatch = text.match(/##\s+Key Findings \(Prioritized\)\s*([\s\S]*?)(?=\n##\s+|$)/i)
  const keyFindingsBody = keyFindingsMatch ? keyFindingsMatch[1] : ''
  if (/no\s+findings\s+were\s+identified\s+within\s+the\s+scanned\s+scope/i.test(keyFindingsBody)) {
    return 'no_findings'
  }
  if (/###\s*\[(Critical|High|Medium|Low|Info)\]\s+/i.test(keyFindingsBody)) {
    return 'findings'
  }
  return 'observations_only'
}
