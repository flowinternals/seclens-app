/**
 * Validates SecLens Markdown reports against contract v2 (2.0.3-mvp4).
 * Categories: STRUCTURE, HEADER_BLOCK, FINDINGS_PATTERN, APPENDIX, LEAKAGE, COVERAGE, SEVERITY_EVIDENCE (DEFECT-001), MISLEADING_SECRET_CLASSIFICATION (DEFECT-003), SPECULATIVE_FINDING (DEFECT-004), UNBOUNDED_ABSENCE_CLAIM (DEFECT-006), UNKNOWN
 */

import { SECTION_TITLES_ORDER } from '../prompts/seclens-output-contract-v2.js'

/** @typedef {'STRUCTURE'|'HEADER_BLOCK'|'FINDINGS_PATTERN'|'APPENDIX'|'LEAKAGE'|'COVERAGE'|'SEVERITY_EVIDENCE'|'MISLEADING_SECRET_CLASSIFICATION'|'SPECULATIVE_FINDING'|'UNBOUNDED_ABSENCE_CLAIM'|'UNKNOWN'} ValidationCategory */

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
  return /^#\s+SecLens\s+Security\s+Report\s*$/.test(first.trim())
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

function extractSectionBody(markdown, sectionTitle) {
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
    /\b(api|src|server|tests|\.github)\/[\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs)\b/i.test(t) ||
    /[`'][\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs)[`']/i.test(t) ||
    /\b[\w.-]+\.(js|ts|jsx|tsx|json|mjs|cjs)(:\s*line\s+unknown)?\b/i.test(t)
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
    if (!mentionsFirebasePublicConfig) continue

    const explainsPublicNature =
      /\b(public|client-side|client side)\b/i.test(body) &&
      /\bnot\b[^.\n]{0,60}\b(secret|private credential|proof of compromise|leak)\b/i.test(body)

    const labelsAsSecretExposure =
      /\b(secret|sensitive)\b[^.\n]{0,60}\b(exposure|leak(age)?)\b/i.test(body) ||
      /\bexposure\s+of\s+environment\s+variables\b/i.test(body)

    const sev = severity.toLowerCase()
    if (!explainsPublicNature && (sev !== 'info' || labelsAsSecretExposure)) {
      return true
    }
  }
  return false
}

/**
 * Detect speculative Medium findings that are conditional/generic without concrete weakness evidence (DEFECT-004).
 * @param {string} keyFindingsBody
 */
export function hasSpeculativeMediumFinding(keyFindingsBody) {
  const blocks = splitFindingBlocks(keyFindingsBody)
  if (!blocks.length) return false

  const speculativePattern = /\b(if\s+not\s+properly\s+configured|could\s+be\s+(exposed|strengthened)|could\s+be\s+further\s+strengthened|consider|review|ensure)\b/i

  for (const { severity, body } of blocks) {
    if (severity.toLowerCase() !== 'medium') continue
    if (!speculativePattern.test(body)) continue

    const hasConcreteMissingValidationPath =
      /\bwithout\s+validat/i.test(body) ||
      /\bmissing\s+(auth(orization)?|ownership|validation|sanitization|rate[- ]?limit)\b/i.test(body) ||
      /\b(no|lacks?)\s+(auth(orization)?|ownership|validation|sanitization|rate[- ]?limit)\b/i.test(body)
    const hasPlausibleImpactPath =
      /\b(allows?|can|could)\b[^.\n]{0,80}\b(attacker|unauthenticated|unauthorized|abuse|bypass|tamper|exfiltrat|escalat|execute)\b/i.test(body)
    const evidence = fieldBodyAfter(body, 'Evidence')
    const hasPathEvidence = evidenceContainsRepoPath(evidence || '')

    if (!(hasConcreteMissingValidationPath && hasPlausibleImpactPath && hasPathEvidence)) {
      return true
    }
  }
  return false
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
const FILE_PATH_BASIS_PATTERN = /[`'][\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|yml|yaml|toml|tf|dockerfile|md)[`']/i
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
  const actual = extractH2Sequence(markdown)
  if (actual.length < expected.length) {
    categories.push('STRUCTURE')
  } else {
    for (let i = 0; i < expected.length; i++) {
      if (actual[i] !== expected[i]) {
        categories.push('STRUCTURE')
        break
      }
    }
  }

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

  if (hasUnboundedAbsenceClaim(markdown)) {
    categories.push('UNBOUNDED_ABSENCE_CLAIM')
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
