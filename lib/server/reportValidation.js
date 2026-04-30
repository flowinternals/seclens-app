/**
 * Validates SecLens Markdown reports against contract v2 (2.0.4-mvp4 baseline).
 * Categories: STRUCTURE, HEADER_BLOCK, FINDINGS_PATTERN, APPENDIX, LEAKAGE, COVERAGE, SEVERITY_EVIDENCE (DEFECT-001), MISLEADING_SECRET_CLASSIFICATION (DEFECT-003), SPECULATIVE_FINDING (DEFECT-004), KEY_FINDING_ADMISSION (CR-005), UNBOUNDED_ABSENCE_CLAIM (DEFECT-006), SUMMARY_RISK_INCONSISTENT, QUICK_WINS_UNSCOPED, NO_FINDINGS_GAP_ASSERTION, NOT_EVIDENCED_DRIFT, UNKNOWN
 */

import { SECTION_TITLES_ORDER } from '../prompts/seclens-output-contract-v2.js'

const CONSOLIDATED_SECTION_TITLES_ORDER = [
  'Executive Posture Summary',
  'Confirmed Protections',
  'Priority Risks Requiring Review',
  'Dimension Summaries',
  'Prioritized Next Actions',
  'Confidence & Coverage',
  'Evidence Appendix',
]

/** @typedef {'STRUCTURE'|'HEADER_BLOCK'|'FINDINGS_PATTERN'|'APPENDIX'|'LEAKAGE'|'COVERAGE'|'SEVERITY_EVIDENCE'|'MISLEADING_SECRET_CLASSIFICATION'|'SPECULATIVE_FINDING'|'KEY_FINDING_ADMISSION'|'UNBOUNDED_ABSENCE_CLAIM'|'SUMMARY_RISK_INCONSISTENT'|'QUICK_WINS_UNSCOPED'|'NO_FINDINGS_GAP_ASSERTION'|'NOT_EVIDENCED_DRIFT'|'UNKNOWN'} ValidationCategory */

const LEAKAGE_CHECKS = [
  { re: /\bghp_[a-zA-Z0-9]{20,}\b/, label: 'github_classic_pat' },
  { re: /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/i, label: 'github_fine_pat' },
  { re: /\bsk-[a-zA-Z0-9]{20,}\b/, label: 'sk_api_style' },
  { re: /\bOPENAI_API_KEY\s*=\s*["']?[^\s'"']{8,}/i, label: 'openai_key_assignment' },
  { re: /\bGITHUB_TOKEN\s*=\s*["']ghs_[a-zA-Z0-9]/i, label: 'github_token_assignment' },
]

/**
 * Replace patterns that must not be echoed into the critic user prompt (§13 A14).
 * @param {string} markdown
 */
export function redactLeakagePatterns(markdown) {
  let out = markdown
  for (const { re } of LEAKAGE_CHECKS) {
    out = out.replace(re, '[REDACTED]')
  }
  return out
}

/**
 * Normalize markdown heading titles for comparison (§13 A9).
 * @param {string} raw
 */
export function normalizeSectionTitle(raw) {
  return raw
    .trim()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function expectedNormalizedH2s() {
  return SECTION_TITLES_ORDER.map((t) => normalizeSectionTitle(t))
}

function expectedNormalizedConsolidatedH2s() {
  return CONSOLIDATED_SECTION_TITLES_ORDER.map((t) => normalizeSectionTitle(t))
}

/**
 * @param {string} markdown
 * @returns {string[]}
 */
function extractH2Sequence(markdown) {
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  const out = []
  for (const line of lines) {
    const t = line.trimStart()
    if (t.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^##\s+(.+)$/)
    if (m) {
      out.push(normalizeSectionTitle(m[1]))
    }
  }
  return out
}

function checkReportTitle(markdown) {
  const first = markdown.trimStart().split(/\r?\n/).find((l) => l.trim().length > 0)
  if (!first) return false
  return /^#\s+SecLens\s+(Security|Consolidated)\s+Report\s*$/.test(first.trim())
}

function checkMetadataBlock(markdown) {
  const idx = markdown.indexOf('## ')
  const head = idx === -1 ? markdown : markdown.slice(0, idx)
  const need = ['**repository:**', '**ref:**', '**generated:**', '**languages:**', '**summary risk:**']
  const lower = head.toLowerCase()
  return need.every((n) => lower.includes(n))
}

function extractKeyFindingsBody(markdown) {
  const lines = markdown.split(/\r?\n/)
  let i = 0
  let start = -1
  const target = normalizeSectionTitle('Key Findings (Prioritized)')
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+)$/)
    if (m && normalizeSectionTitle(m[1]) === target) {
      start = i + 1
      break
    }
  }
  if (start < 0) return null
  const chunk = []
  for (let j = start; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break
    chunk.push(lines[j])
  }
  return chunk.join('\n')
}

export function extractSectionBody(markdown, sectionTitle) {
  const lines = markdown.split(/\r?\n/)
  const target = normalizeSectionTitle(sectionTitle)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+)$/)
    if (m && normalizeSectionTitle(m[1]) === target) {
      start = i + 1
      break
    }
  }
  if (start < 0) return null
  const chunk = []
  for (let j = start; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break
    chunk.push(lines[j])
  }
  return chunk.join('\n')
}

function findingsPatternOk(body) {
  if (!body || !body.trim()) return false
  const hasBracketedFinding = /###\s*\[(Critical|High|Medium|Low|Info)\]\s+/i.test(body)
  const zeroFindings =
    /no\s+findings\s+were\s+identified\s+within\s+the\s+scanned\s+scope/i.test(body) ||
    /none\s+identified\s+within\s+the\s+scanned\s+scope/i.test(body)
  return hasBracketedFinding || zeroFindings
}

function appendixPresent(markdown, sectionTitleFromContract) {
  const want = normalizeSectionTitle(sectionTitleFromContract)
  const h2 = extractH2Sequence(markdown)
  return h2.includes(want)
}

function detectLeakage(markdown) {
  for (const { re } of LEAKAGE_CHECKS) {
    if (re.test(markdown)) return true
  }
  return false
}

/**
 * Split Key Findings body into individual finding blocks (### [Severity] …).
 * @param {string} keyFindingsBody
 * @returns {{ severity: string, body: string }[]}
 */
export function splitFindingBlocks(keyFindingsBody) {
  if (!keyFindingsBody || !keyFindingsBody.trim()) return []
  const text = keyFindingsBody
  const re = /^###\s*\[(Critical|High|Medium|Low|Info)\]\s+/gim
  const hits = []
  let m
  while ((m = re.exec(text)) !== null) {
    hits.push({ index: m.index, severity: m[1] })
  }
  if (hits.length === 0) return []
  const blocks = []
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length
    blocks.push({
      severity: hits[i].severity,
      body: text.slice(start, end).trim(),
    })
  }
  return blocks
}

/**
 * Text after a **Label:** marker until the next **Field:** line.
 * @param {string} block
 * @param {string} label e.g. "Evidence" or "Exploit path"
 */
function fieldBodyAfter(block, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hdr = new RegExp(`\\*\\*${escaped}:\\*\\*`, 'i')
  const match = hdr.exec(block)
  if (!match) return null
  const start = match.index + match[0].length
  const tail = block.slice(start)
  const next = tail.search(/\n\*\*[^*\n]+:\*\*/)
  const chunk = next === -1 ? tail : tail.slice(0, next)
  return chunk.trim()
}

/**
 * Evidence must reference a plausible repo path from supplied slices (DEFECT-001).
 */
function evidenceContainsRepoPath(evidenceText) {
  if (!evidenceText || evidenceText.length < 3) return false
  const t = evidenceText.trim()
  if (/^\s*not evidenced\b/i.test(t)) return false
  return (
    /\b(api|src|server|tests|lib|app|pages|functions|packages|scripts|extensions|mcps|\.github)\/[\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|ya?ml|rules)\b/i.test(
      t
    ) ||
    /[`'][\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|ya?ml|rules)[`']/i.test(t) ||
    /\b[\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|ya?ml|rules)(:\s*line\s+unknown|\s*:\s*\d+\s*-\s*\d+)?\b/i.test(
      t
    )
  )
}

function hasTemplateEnvPath(text) {
  return /\.env\.(example|sample|template)\b/i.test(text || '')
}

function appearsTemplateOrPlaceholderOnly(text) {
  return (
    /\b(example|sample|template|placeholder|instruction|setup|commented)\b/i.test(text || '') ||
    /\bempty\s+(assignment|value|values)\b/i.test(text || '') ||
    /\b(file\s+path|path)\s+(to|for)\s+(secret|credential)\b/i.test(text || '')
  )
}

function evidenceListsOnlyTemplateEnv(evidenceText) {
  const text = evidenceText || ''
  if (!hasTemplateEnvPath(text)) return false
  return !/\b[\w./-]+\.(js|ts|jsx|tsx|py|go|java|rb|php|cs|json|ya?ml|toml|tf)\b/i.test(text)
}

function hasVulnerabilitySecretFraming(text) {
  return (
    /\b(hardcoded\s+secrets?|secret\s+exposure|environment\s+variable\s+exposure|exposure\s+of\s+environment\s+variables)\b/i.test(
      text || ''
    ) ||
    /\b(sensitive|secret)\b[^.\n]{0,80}\b(exposure|leak(age)?|compromise)\b/i.test(text || '')
  )
}

/**
 * True if any Critical/High finding fails DEFECT-001 bar.
 */
export function validateSeverityEvidence(keyFindingsBody) {
  const blocks = splitFindingBlocks(keyFindingsBody)
  for (const { severity, body } of blocks) {
    const sev = severity.toLowerCase()
    if (sev !== 'critical' && sev !== 'high') continue

    if (/\bnot evidenced\b/i.test(body)) {
      return false
    }

    if (!/\*\*Evidence:\*\*/i.test(body)) return false
    if (!/\*\*Exploit path:\*\*/i.test(body)) return false
    if (!/\*\*Why it matters:\*\*/i.test(body)) return false
    if (!/\*\*Fix\s*\(recommended\):\*\*/i.test(body)) return false

    const ev = fieldBodyAfter(body, 'Evidence')
    const ex = fieldBodyAfter(body, 'Exploit path')
    if (!ev || !evidenceContainsRepoPath(ev)) return false
    if (!ex || ex.length < 12 || /\bnot evidenced\b/i.test(ex)) return false
  }
  return true
}

/**
 * Detect alarmist wording that treats Firebase public client config as secret leakage (DEFECT-003).
 * @param {string} keyFindingsBody
 */
export function hasMisleadingFirebaseSecretClassification(keyFindingsBody) {
  const blocks = splitFindingBlocks(keyFindingsBody)
  if (!blocks.length) return false

  for (const { severity, body } of blocks) {
    const mentionsFirebasePublicConfig =
      /\bNEXT_PUBLIC_FIREBASE_(API_KEY|AUTH_DOMAIN|PROJECT_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|APP_ID)\b/i.test(body) ||
      /\bfirebase\s+client\s+config/i.test(body)
    const evidence = fieldBodyAfter(body, 'Evidence') || ''
    const mentionsTemplateEnv = hasTemplateEnvPath(evidence) || hasTemplateEnvPath(body)
    if (!mentionsFirebasePublicConfig && !mentionsTemplateEnv) continue
    const onlyTemplateEnvEvidence = evidenceListsOnlyTemplateEnv(evidence)

    const explainsPublicNature =
      /\b(public|client-side|client side)\b/i.test(body) &&
      /\bnot\b[^.\n]{0,60}\b(secret|private credential|proof of compromise|leak)\b/i.test(body)

    const explainsTemplateNature =
      /\b(template|placeholder|example|sample)\b/i.test(body) &&
      /\bnot\b[^.\n]{0,70}\b(secret|credential\s+exposure|proof\s+of\s+compromise|leak(age)?)\b/i.test(body)

    const labelsAsSecretExposure = hasVulnerabilitySecretFraming(body)
    const negatesSecretExposure =
      /\bnot\b[^.\n]{0,80}\b(secret|sensitive)\b[^.\n]{0,40}\b(exposure|leak(age)?)\b/i.test(body)
    const alarmingSecretExposureClaim = labelsAsSecretExposure && !negatesSecretExposure

    const sev = severity.toLowerCase()
    const describesPlaceholderOnly = mentionsTemplateEnv && appearsTemplateOrPlaceholderOnly(body)
    if (
      (!explainsPublicNature && mentionsFirebasePublicConfig) ||
      (!explainsTemplateNature && describesPlaceholderOnly && !explainsPublicNature)
    ) {
      if (sev !== 'info' || alarmingSecretExposureClaim) {
        return true
      }
    }

    if (describesPlaceholderOnly && alarmingSecretExposureClaim) {
      return true
    }

    if (onlyTemplateEnvEvidence && alarmingSecretExposureClaim) {
      return true
    }
  }
  return false
}

/**
 * Hedge wording must be evaluated on the finding's claim (Why it matters / narrative), not on
 * **Fix (recommended):** — words like "ensure", "review", "consider" are normal there (DEFECT-004 FP).
 */
function hedgeWordDetectionSurface(block) {
  const why = fieldBodyAfter(block, 'Why it matters')
  if (why && why.trim().length > 0) return why

  const fixMatch = /\n\*\*Fix \(recommended\):\*\*/i.exec(block)
  if (fixMatch) return block.slice(0, fixMatch.index)

  const residualMatch = /\n\*\*Residual risk & tests:\*\*/i.exec(block)
  if (residualMatch) return block.slice(0, residualMatch.index)

  return block
}

/** Medium-only hedge phrasing that needs a substantive escape hatch (DEFECT-004). */
function hasSpeculativeHedgeWording(text) {
  if (
    /\b(if\s+not\s+properly\s+configured|could\s+be\s+(exposed|strengthened)|could\s+be\s+further\s+strengthened)\b/i.test(
      text
    )
  ) {
    return true
  }
  if (/\bensure\b/i.test(text)) return true
  if (/\bconsider\s+(adding|implementing|using|whether|switching|applying)\b/i.test(text)) return true
  if (/\breview\s+(access|controls|configuration|settings|permissions|policies|credentials)\b/i.test(text)) return true
  if (/\b(please\s+review|should\s+consider)\b/i.test(text)) return true
  return false
}

/**
 * Concrete weakness / defect signal (broader than access-control-only; DEFECT-004 escape).
 */
function hasConcreteWeaknessSignal(body) {
  return (
    /\bwithout\s+validat/i.test(body) ||
    /\bmissing\s+(auth(orization)?|ownership|validation|sanitization|rate[- ]?limit|csrf|csp|hardening)\b/i.test(body) ||
    /\b(no|lacks?)\s+(auth(orization)?|ownership|validation|sanitization|rate[- ]?limit)\b/i.test(body) ||
    /\bdoes\s+not\s+[\w\s]{0,20}\b(validate|verify|authenticate|authorize|sanitize|check)\b/i.test(body) ||
    /\bfails?\s+to\s+(validate|verify|authenticate|sanitize|enforce)\b/i.test(body) ||
    /\bnot\s+(adequately\s+)?(validated|verified|authenticated|sanitized)\b/i.test(body) ||
    /\b(absence|lack)\s+of\b[^.\n]{0,80}\b(auth|encryption|validation|verification|tls|rate[- ]?limit)\b/i.test(body) ||
    /\b(insecure|insufficient|weak)\b[^.\n]{0,40}\b(default|cookie|session|tls|transport|cipher|config)\b/i.test(body) ||
    /\b(vulnerable\s+to|susceptible\s+to|prone\s+to)\b/i.test(body) ||
    /\b(hardcoded|plaintext|cleartext)\b[^.\n]{0,80}\b(secret|password|token|credential|api\s*key)\b/i.test(body) ||
    /\b(unparameterized|unsanitized|string\s+concatenation)\b/i.test(body) ||
    /\b(open\s+redirect|injection|xss|ssrf|path\s+traversal)\b/i.test(body)
  )
}

/**
 * Plausible impact / abuse scenario (modal + threat need not sit on one line; DEFECT-004 escape).
 */
function hasPlausibleImpactSignal(body) {
  return (
    /\b(allows?|can|could|may|enables?)\b[\s\S]{0,180}?\b(attacker|unauthenticated|unauthorized|malicious|adversary|abuse|bypass|tamper|exfiltrat|escalat|execute|spoof|forge)\b/i.test(
      body
    ) ||
    /\b(unauthorized|unauthenticated|malicious)\b[^.\n]{0,120}\b(access|party|actor|request|users?|clients?)\b/i.test(body) ||
    /\b(account\s+takeover|privilege\s+escalat|broken\s+access)\b/i.test(body) ||
    /\b(data\s+(exposure|exfiltration|leak)|sensitive\s+data)\b/i.test(body) ||
    /\b(information\s+disclosure|secret\s+leak|credential\s+theft)\b/i.test(body) ||
    /\b(allows?|could|may|enables?)\b[^.\n]{0,160}\b(tamper|modify|read|overwrite|delete|invoke|execute)\b[^.\n]{0,80}\b(data|accounts?|records?|requests?)\b/i.test(
      body
    )
  )
}

function isConfigOrWorkflowEvidence(evidenceText) {
  const text = evidenceText || ''
  return (
    /(^|[\s`'"])\.github\/workflows\/[\w./-]+\.ya?ml\b/i.test(text) ||
    /\b[\w./-]+\.(ya?ml|json|toml)\b/i.test(text) ||
    /\b(vercel\.json|firebase\.json|dockerfile|compose\.ya?ml)\b/i.test(text)
  )
}

function hasConcreteConfigDefectSignal(body) {
  const text = body || ''
  return (
    /\b(missing|absent|disabled|not\s+set|not\s+enforced|set\s+to\s+false)\b[^.\n]{0,80}\b(control|check|gate|header|csp|csrf|auth|authorization|rate[- ]?limit|audit[- ]?level|permission|permissions|fail(-fast)?|blocking)\b/i.test(
      text
    ) ||
    /`[^`\n]{0,80}(--[\w-]+|(?<![/.])\b[a-zA-Z_][\w.-]{0,40}\s*[:=]\s*[\w.-]+|audit-level|permissions?)`/i.test(
      text
    )
  )
}

function hasPolicyStyleOnlyWording(body) {
  return (
    /\b(could\s+allow|could\s+be\s+improved|should\s+be\s+stricter|additional\s+checks?\s+should|recommended|best\s+practices?)\b/i.test(
      body || ''
    ) ||
    /\b(consider|review|ensure|enhance|further)\b/i.test(body || '')
  )
}

function hasSpecificValidationGapSignal(body) {
  const text = body || ''
  return (
    /\b(field|parameter|payload|property|claim|header|role|owner(ship)?|tenant|account|id)\b/i.test(text) ||
    /\b(missing|fails?\s+to|does\s+not)\b[^.\n]{0,120}\b(allowlist|denylist|schema|type|length|range|enum|ownership|authorization|authenticat|sanitiz|normaliz|canonicaliz|csrf)\b/i.test(
      text
    ) ||
    /\b(trust\s+boundary|cross[- ]tenant|idor|insecure\s+direct\s+object\s+reference|mass\s+assignment)\b/i.test(
      text
    )
  )
}

function findingHeadingTitle(block) {
  const m = String(block || '').match(/^###\s*\[(Critical|High|Medium|Low|Info)\]\s+([^\n]+)/i)
  return m ? m[2].trim() : ''
}

function findingLooksLikeGenericAdvice(title, text) {
  const t = `${title}\n${text}`
  return (
    /\b(inadequate|insufficient|lack|missing|potential|possible)\b[^.\n]{0,80}\b(input\s+validation|rate[-\s]*limit(?:ing)?|security\s+headers?|sensitive\s+data\s+exposure)\b/i.test(
      t
    ) ||
    /\b(code\s+quality|linting\s+standards|best\s+practice|hardening)\b/i.test(t) ||
    /\b(consider|review|ensure|should|recommended)\b/i.test(t)
  )
}

function hasSpecificControlOrRuleSignal(body) {
  const text = body || ''
  return (
    hasConcreteWeaknessSignal(text) ||
    hasSpecificValidationGapSignal(text) ||
    (/\b(missing|absent|not\s+set|not\s+applied|not\s+returned|not\s+enforced|does\s+not)\b/i.test(text) &&
      /\b(csp|hsts|x-frame-options|x-content-type-options|content-security-policy|strict-transport-security|rate[- ]?limit|throttl)\b/i.test(
        text
      ))
  )
}

/**
 * CR-005: Key Findings must be concrete/evidence-bound weaknesses, not generic advice.
 * @param {string} keyFindingsBody
 */
export function hasGenericKeyFindingAdmissionFailure(keyFindingsBody) {
  const blocks = splitFindingBlocks(keyFindingsBody)
  if (!blocks.length) return false

  for (const { severity, body } of blocks) {
    const sev = String(severity || '').toLowerCase()
    const title = findingHeadingTitle(body)
    const evidence = fieldBodyAfter(body, 'Evidence') || ''
    const why = fieldBodyAfter(body, 'Why it matters') || body
    const category = fieldBodyAfter(body, 'Category') || ''
    const text = `${category}\n${why}`

    const genericAdvice = findingLooksLikeGenericAdvice(title, text)
    if (!genericAdvice) continue

    const hasPathEvidence = evidenceContainsRepoPath(evidence)
    const hasSpecificControlSignal = hasSpecificControlOrRuleSignal(text)
    const validationLike =
      /\binput\s+validation|validation|sanitization|trust\s+boundary|injection|idor|mass\s+assignment\b/i.test(
        `${title}\n${category}\n${text}`
      )
    const hasSpecificValidationSignal = hasSpecificValidationGapSignal(text)

    if (!hasPathEvidence || !hasSpecificControlSignal) return true
    if ((sev === 'high' || sev === 'medium') && validationLike && !hasSpecificValidationSignal) return true
    if (sev === 'info' && /\b(vulnerab|risk|exposure|attack)\b/i.test(text) && !hasSpecificControlSignal) {
      return true
    }
  }
  return false
}

function isGenericValidationTighteningClaim(body) {
  const text = body || ''
  return (
    /\b(lack|insufficient)\s+of\s+(strict\s+)?validation\b/i.test(text) ||
    /\b(validation|input\s+handling)\b[^.\n]{0,80}\b(could\s+be\s+improved|should\s+be\s+stricter|can\s+be\s+strengthened)\b/i.test(
      text
    ) ||
    /\b(some|basic)\s+validation\b/i.test(text)
  )
}

/**
 * Detect speculative Medium findings that are conditional/generic without concrete weakness evidence (DEFECT-004).
 * @param {string} keyFindingsBody
 */
export function hasSpeculativeMediumFinding(keyFindingsBody) {
  const blocks = splitFindingBlocks(keyFindingsBody)
  if (!blocks.length) return false

  for (const { severity, body } of blocks) {
    if (severity.toLowerCase() !== 'medium') continue

    const evidence = fieldBodyAfter(body, 'Evidence')
    const category = fieldBodyAfter(body, 'Category') || ''
    const onlyTemplateEnvEvidence = evidenceListsOnlyTemplateEnv(evidence || '')
    const claimsControlAbsent =
      /\b(not\s+enforced|absent|missing|insufficient|lacks?)\b/i.test(body) &&
      /\b(rate[- ]?limit|abuse|validation|auth(orization)?|security headers?|csp|csrf|session)\b/i.test(body)
    if (onlyTemplateEnvEvidence && claimsControlAbsent) {
      return true
    }

    if (isConfigOrWorkflowEvidence(evidence || '')) {
      const isWorkflowEvidence = /\.github\/workflows\/[\w./-]+\.ya?ml\b/i.test(evidence || '')
      if (
        isWorkflowEvidence &&
        /\b(could\s+allow|should\s+be\s+stricter|additional\s+checks?)\b/i.test(body) &&
        !/`[^`\n]{0,120}npm\s+audit\s+--audit-level=(moderate|medium|high|critical)[^`\n]*`/i.test(body)
      ) {
        return true
      }
      const hasConcreteConfigDefect = hasConcreteConfigDefectSignal(body)
      if (hasPolicyStyleOnlyWording(body) && !hasConcreteConfigDefect) {
        return true
      }
    }

    const categoryHintsValidation = /\binput\s+validation|validation\b/i.test(category)
    const claimSurface = fieldBodyAfter(body, 'Why it matters') || body
    const bodyHintsValidation = /\binput\s+validation|validation\b/i.test(claimSurface)
    if (
      (categoryHintsValidation || bodyHintsValidation) &&
      isGenericValidationTighteningClaim(claimSurface)
    ) {
      if (!hasSpecificValidationGapSignal(claimSurface)) {
        return true
      }
    }

    const hedgeSurface = hedgeWordDetectionSurface(body)
    if (!hasSpeculativeHedgeWording(hedgeSurface)) continue

    const hasConcrete = hasConcreteWeaknessSignal(body)
    const hasImpact = hasPlausibleImpactSignal(body)
    const hasPathEvidence = evidenceContainsRepoPath(evidence || '')

    if (!(hasConcrete && hasImpact && hasPathEvidence)) {
      return true
    }
  }
  return false
}

function extractSummaryRiskLine(markdown) {
  const idx = markdown.indexOf('## ')
  const head = idx === -1 ? markdown : markdown.slice(0, idx)
  const m = head.match(/- \*\*Summary Risk:\*\*\s*([^\n]+)/i)
  return m ? m[1].trim() : null
}

function severityRank(sev) {
  const s = String(sev || '').toLowerCase()
  if (s.startsWith('critical')) return 4
  if (s.startsWith('high')) return 3
  if (s.startsWith('medium')) return 2
  if (s.startsWith('low')) return 1
  if (s.startsWith('info')) return 0
  return -1
}

function highestFindingSeverityRank(keyFindingsBody) {
  const blocks = splitFindingBlocks(keyFindingsBody)
  if (!blocks.length) return -1
  let top = -1
  for (const { severity } of blocks) {
    top = Math.max(top, severityRank(severity))
  }
  return top
}

function keyFindingsExplicitNoFindings(keyFindingsBody) {
  const text = keyFindingsBody || ''
  return (
    /no\s+findings\s+were\s+identified\s+within\s+the\s+scanned\s+scope/i.test(text) ||
    /none\s+identified\s+within\s+the\s+scanned\s+scope/i.test(text)
  )
}

function summaryHasCoverageBoundedRationale(summaryRiskLine) {
  const text = summaryRiskLine || ''
  const hasCausalCue = /\b(because|due to|given|reflects|driven by|based on)\b/i.test(text)
  const hasBoundedCue =
    /\b(scanned|scan|coverage|selected|omitted|paths?|files\s+reviewed|this\s+run|included\s+in\s+this\s+run|limited)\b/i.test(
      text
    )
  return hasCausalCue && hasBoundedCue
}

export function hasSummaryRiskInconsistentWithFindings(markdown, keyFindingsBody) {
  const summaryRiskLine = extractSummaryRiskLine(markdown)
  if (!summaryRiskLine) return false
  const summaryRank = severityRank(summaryRiskLine)
  const findingsTopRank = highestFindingSeverityRank(keyFindingsBody || '')
  if (summaryRank < 0) return false
  if (findingsTopRank < 0) {
    if (!keyFindingsExplicitNoFindings(keyFindingsBody || '')) return false
    // No-admitted-findings reports must not carry Medium+ summary risk without explicit bounded rationale.
    return summaryRank > 1 && !summaryHasCoverageBoundedRationale(summaryRiskLine)
  }
  if (summaryRank <= findingsTopRank) return false
  return !summaryHasCoverageBoundedRationale(summaryRiskLine)
}

const NON_FINDING_SECTIONS = [
  'Dependency & Supply Chain Notes',
  'CI/CD & Operational Hardening',
  'Web Security Controls',
  'Docker/IaC Observations',
  'Rate Limiting & Abuse Controls',
  'File Upload Security',
  'Session Management',
]

const ABSENCE_CLAIM_PATTERN = /\b(no|not observed|not identified|does not(?:\s+\w+){0,3}\s+include|did not(?:\s+\w+){0,3}\s+include|were not observed|cannot be assessed)\b/i
/** Line-range citations `path:12-34` count as file basis (CR-008 / Stage 02). */
const FILE_PATH_BASIS_PATTERN =
  /[`'][\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|yml|yaml|toml|tf|dockerfile|md|rules)(?::\d+(?:\s*-\s*\d+)?)?[`']/i
const COVERAGE_BASIS_PATTERN = /\b(scanned files?|scanned scope|scan coverage|coverage (is )?limited|not evidenced in scanned files|outside the scanned set|files included in this scan|scan did not include|this run did not include)\b/i

/**
 * Detect broad absence claims in non-finding sections that lack file/category/coverage basis (DEFECT-006).
 * @param {string} markdown
 */
export function hasUnboundedAbsenceClaim(markdown) {
  for (const section of NON_FINDING_SECTIONS) {
    const body = extractSectionBody(markdown, section)
    if (!body || !body.trim()) continue
    if (!ABSENCE_CLAIM_PATTERN.test(body)) continue
    const hasBasis = FILE_PATH_BASIS_PATTERN.test(body) || COVERAGE_BASIS_PATTERN.test(body)
    if (!hasBasis) return true
  }
  return false
}

export function hasNotEvidencedRecommendationDrift(markdown) {
  for (const section of NON_FINDING_SECTIONS) {
    const body = extractSectionBody(markdown, section)
    if (!body || !body.trim()) continue
    if (!/\bnot evidenced in scanned files\b/i.test(body)) continue

    const hasStrongDirective =
      /\b(implement|enforce|restrict|establish|configure|require|must)\b/i.test(body) &&
      !/\b(consider|may|might|could|can|if|where applicable|as applicable|recommended|recommend)\b/i.test(
        body
      )
    if (hasStrongDirective) return true

    if (
      /\bnot evidenced in scanned files\b/i.test(body) &&
      /\b(the\s+repository\s+(lacks?|does\s+not\s+have)|there\s+is\s+no\s+evidence\s+of|no\s+\w+(\s+\w+){0,4}\s+in\s+the\s+repository)\b/i.test(
        body
      ) &&
      !FILE_PATH_BASIS_PATTERN.test(body) &&
      !COVERAGE_BASIS_PATTERN.test(body)
    ) {
      return true
    }
  }
  return false
}

export function hasUnscopedGenericQuickWins(markdown) {
  const body = extractSectionBody(markdown, 'Prioritized Recommendations')
  if (!body || !body.trim()) return false

  const lines = body.split(/\r?\n/)
  const bulletLike = lines
    .map((l) => l.trim())
    .filter((l) => /^(\d+\.\s+|-+\s+)/.test(l))
    .map((l) => l.replace(/^(\d+\.\s+|-+\s+)/, '').trim())

  const items = bulletLike.length ? bulletLike : [body.trim()]
  for (const item of items) {
    const hasGenericHardening =
      /\b(stricter\s+authorization|authorization\s+checks?|duplicate\s+organization|rate[- ]?limit(?:ing)?|security\s+scanning|integrate\s+security\s+tools)\b/i.test(
        item
      ) ||
      /\b(implement|enhance|enforce|strengthen|add)\b/i.test(item)
    if (!hasGenericHardening) continue

    const hasLineCitationBasis =
      /`[\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|yml|yaml|toml|tf|dockerfile|md|rules):\d+\s*-\s*\d+`/i.test(
        item
      )
    const hasScopedBasis =
      /\b(scanned files?|scanned scope|included in this run|not evidenced in scanned files|coverage is limited)\b/i.test(
        item
      )
    const hasConditionalBoundedLanguage = /\b(if present|if applicable|where applicable|consider)\b/i.test(item)
    if (!(hasLineCitationBasis || hasScopedBasis || hasConditionalBoundedLanguage)) {
      return true
    }
  }
  return false
}

export function hasNoFindingsContradictoryGapAssertions(markdown, keyFindingsBody) {
  if (!keyFindingsExplicitNoFindings(keyFindingsBody || '')) return false

  const sectionsToCheck = ['Executive Summary', ...NON_FINDING_SECTIONS]
  for (const section of sectionsToCheck) {
    const body = extractSectionBody(markdown, section)
    if (!body || !body.trim()) continue

    const hasAssertivePhrase =
      /\b(gaps?\s+in|missing|insufficient|lacks?|are\s+needed|needs?\s+to\s+be\s+addressed|further\s+enhancements?\s+are\s+needed|require\s+attention|should\s+be\s+(implemented|added|enhanced|considered)|additional\s+measures?\s+are\s+needed|additional\s+measures?\s+such\s+as\b[^.\n]{0,120}\bshould\s+be\s+considered)\b/i.test(
        body
      )
    const hasSecurityTopic =
      /\b(validation|error\s+handling|authorization|authentication|rate[- ]?limit|security\s+headers?|csp|content-security-policy|session|user-facing\s+endpoints?)\b/i.test(
        body
      ) || section === 'Rate Limiting & Abuse Controls'
    const hasAssertiveGapClaim = hasAssertivePhrase && hasSecurityTopic
    if (!hasAssertiveGapClaim) continue

    const hasScopedBasis =
      /\b(not evidenced in scanned files|scanned scope|coverage is limited|included in this run|outside scanned)\b/i.test(
        body
      ) || /`[\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|yml|yaml|toml|tf|dockerfile|md|rules):\d+\s*-\s*\d+`/i.test(body)
    const hasConditionalFraming = /\b(may|might|could|if present|if applicable|if .* exist|not fully evidenced)\b/i.test(
      body
    )

    if (!(hasScopedBasis || hasConditionalFraming)) {
      return true
    }
  }

  return false
}

/**
 * Full validation result.
 * @param {string} markdown
 * @returns {{ ok: boolean, categories: ValidationCategory[], repairable: boolean }}
 */
export function validateReport(markdown) {
  /** @type {ValidationCategory[]} */
  const categories = []

  if (typeof markdown !== 'string' || !markdown.trim()) {
    return { ok: false, categories: ['STRUCTURE'], repairable: true }
  }

  if (detectLeakage(markdown)) {
    categories.push('LEAKAGE')
  }

  if (!checkReportTitle(markdown)) {
    categories.push('STRUCTURE')
  }

  if (!checkMetadataBlock(markdown)) {
    categories.push('HEADER_BLOCK')
  }

  const expected = expectedNormalizedH2s()
  const expectedConsolidated = expectedNormalizedConsolidatedH2s()
  const actual = extractH2Sequence(markdown)
  const legacyStructureMatches =
    actual.length >= expected.length && expected.every((title, index) => actual[index] === title)
  const consolidatedStructureMatches =
    actual.length >= expectedConsolidated.length &&
    expectedConsolidated.every((title, index) => actual[index] === title)

  if (!legacyStructureMatches && !consolidatedStructureMatches) {
    categories.push('STRUCTURE')
  }

  if (legacyStructureMatches) {
    const appA = appendixPresent(markdown, SECTION_TITLES_ORDER[SECTION_TITLES_ORDER.length - 2])
    const appB = appendixPresent(markdown, SECTION_TITLES_ORDER[SECTION_TITLES_ORDER.length - 1])
    if (!appA || !appB) {
      categories.push('APPENDIX')
    }

    const kf = extractKeyFindingsBody(markdown)
    if (!findingsPatternOk(kf || '')) {
      categories.push('FINDINGS_PATTERN')
    }

    if (kf && findingsPatternOk(kf) && !validateSeverityEvidence(kf)) {
      categories.push('SEVERITY_EVIDENCE')
    }

    if (kf && findingsPatternOk(kf) && hasMisleadingFirebaseSecretClassification(kf)) {
      categories.push('MISLEADING_SECRET_CLASSIFICATION')
    }

    if (kf && findingsPatternOk(kf) && hasSpeculativeMediumFinding(kf)) {
      categories.push('SPECULATIVE_FINDING')
    }

    if (kf && findingsPatternOk(kf) && hasGenericKeyFindingAdmissionFailure(kf)) {
      categories.push('KEY_FINDING_ADMISSION')
    }

    if (hasUnboundedAbsenceClaim(markdown)) {
      categories.push('UNBOUNDED_ABSENCE_CLAIM')
    }

    if (kf && findingsPatternOk(kf) && hasSummaryRiskInconsistentWithFindings(markdown, kf)) {
      categories.push('SUMMARY_RISK_INCONSISTENT')
    }

    if (hasUnscopedGenericQuickWins(markdown)) {
      categories.push('QUICK_WINS_UNSCOPED')
    }

    if (kf && findingsPatternOk(kf) && hasNoFindingsContradictoryGapAssertions(markdown, kf)) {
      categories.push('NO_FINDINGS_GAP_ASSERTION')
    }

    if (hasNotEvidencedRecommendationDrift(markdown)) {
      categories.push('NOT_EVIDENCED_DRIFT')
    }
  }

  const uniq = [...new Set(categories)]
  const ok = uniq.length === 0
  const repairable = true

  return {
    ok,
    categories: ok ? [] : uniq,
    repairable,
  }
}
