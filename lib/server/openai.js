/**
 * OpenAI client — contract v2 draft, validation, optional critic repair.
 */

import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  OUTPUT_CONTRACT_VERSION,
  buildContractInstructions,
  SECTION_PRIORITIZED_RECOMMENDATIONS,
} from '../prompts/seclens-output-contract-v2.js'
import { buildEvidenceRules } from '../prompts/seclens-evidence-rules-v1.js'
import { buildPhasedAnalysisInstructions } from '../prompts/seclens-phased-analysis-v1.js'
import { validateReport } from './reportValidation.js'
import { ReportQualityGateError } from './reportQualityGateError.js'
import { getIngestionCaps } from './ingestionCaps.js'
import {
  renderEvidenceForPrompt,
  stubEvidenceBundleFromLegacyRepoData,
  renderCitationManifestForPrompt,
  renderScannedPathsHint,
  renderControlEvidenceDigest,
} from './evidenceBundle.js'
import {
  parseCandidatePayload,
  admitCandidates,
  renderDeterministicReport,
  summarizeAdmissionTelemetry,
} from './structuredReportPipeline.js'
import { buildMultiPassPlan, shouldFailForPassFailures } from './multiPassAnalysis.js'

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

function analysisModel() {
  return process.env.SECLENS_ANALYSIS_MODEL || 'gpt-4o-mini'
}

function maxAnalysisTokens() {
  const raw = parseInt(process.env.SECLENS_MAX_ANALYSIS_TOKENS || '6144', 10)
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1024), 16384) : 6144
}

function analysisModelContextTokens() {
  const raw = parseInt(process.env.SECLENS_ANALYSIS_MODEL_CONTEXT_TOKENS || '128000', 10)
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 8192), 2_000_000) : 128000
}

function estimatePromptTokensFromText(text) {
  const bytes = Buffer.byteLength(String(text || ''), 'utf8')
  return Math.ceil(bytes / 4)
}

function selectionReasonPriority(reason) {
  const r = String(reason || '')
  if (r === 'tier1_priority') return 100
  if (r.startsWith('domain_reserve_')) return 90
  if (r === 'tier2_anchor_route') return 88
  if (r === 'tier2_security_surface') return 86
  if (r === 'related_imported_by_anchor') return 84
  if (r === 'related_client_auth_bridge') return 82
  if (r.startsWith('related_')) return 76
  if (r === 'backfill_tier2') return 62
  if (r === 'backfill_tier3') return 50
  return 40
}

function evidencePathPriority(path) {
  const p = String(path || '').toLowerCase()
  if (/^functions\/src\/|^src\/|^app\/api\/|^pages\/api\/|^server\/|^lib\//.test(p)) return 16
  if (/firestore\.rules|storage\.rules|firebase\.json|\.github\/workflows\//.test(p)) return 12
  if (/package-lock\.json|package\.json|pnpm-lock\.yaml|yarn\.lock/.test(p)) return 8
  if (/__tests__|\.test\.|\.spec\./.test(p)) return -10
  if (/\.md$/.test(p)) return -16
  return 0
}

function buildPromptBundleWithEvidence(bundle, evidence, trimmedCount = 0) {
  const promptBundle = {
    ...bundle,
    inventory: {
      ...bundle.inventory,
      filesSelected: evidence.length,
      filesOmitted: (bundle.inventory?.filesOmitted || 0) + Math.max(0, trimmedCount),
    },
    coverage: {
      ...bundle.coverage,
      notes: [...(bundle.coverage?.notes || [])],
    },
    evidence,
  }
  if (trimmedCount > 0) {
    promptBundle.coverage.notes.push(
      `Prompt-budget trim applied before model submission (${trimmedCount} lower-priority evidence excerpts omitted).`
    )
  }
  return promptBundle
}

export function preparePromptBoundedBundle(bundle, repoData, opts = {}) {
  const responseReserveTokens = opts.responseReserveTokens || maxAnalysisTokens()
  const contextLimitTokens = opts.contextLimitTokens || analysisModelContextTokens()
  const safetyMarginTokens = opts.safetyMarginTokens || 2048
  const availableInputTokens = Math.max(4096, contextLimitTokens - responseReserveTokens - safetyMarginTokens)
  const selectedByPath = new Map((bundle?.selection?.selected || []).map((row) => [row.path, row]))
  const scoredEvidence = [...(bundle?.evidence || [])]
    .map((ev, idx) => {
      const row = selectedByPath.get(ev.path)
      const reasonScore = selectionReasonPriority(row?.reason)
      const pathScore = evidencePathPriority(ev.path)
      return { ev, idx, score: reasonScore + pathScore }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.idx - b.idx
    })

  const renderPromptText = (promptBundle) => `${buildCoverageBlock(repoData, promptBundle)}

${renderCitationManifestForPrompt(promptBundle)}

${renderScannedPathsHint(promptBundle)}

${renderControlEvidenceDigest(promptBundle)}

${buildContractInstructions()}

${buildEvidenceRules()}

${buildPhasedAnalysisInstructions()}

Repository description: ${repoData.description || 'No description'}
Primary language: ${repoData.language || 'Unknown'}

${renderEvidenceForPrompt(promptBundle)}`

  let kept = scoredEvidence.map((x) => x.ev)
  let trimmedCount = 0
  let promptBundle = buildPromptBundleWithEvidence(bundle, kept, trimmedCount)
  let userContent = renderPromptText(promptBundle)
  let estimatedTokens = estimatePromptTokensFromText(userContent)

  while (kept.length > 1 && estimatedTokens > availableInputTokens) {
    kept = kept.slice(0, kept.length - 1)
    trimmedCount = scoredEvidence.length - kept.length
    promptBundle = buildPromptBundleWithEvidence(bundle, kept, trimmedCount)
    userContent = renderPromptText(promptBundle)
    estimatedTokens = estimatePromptTokensFromText(userContent)
  }

  if (estimatedTokens > availableInputTokens) {
    const caps = getIngestionCaps()
    throw new Error(
      `Prompt budget exceeded before model call. Estimated input ${estimatedTokens} tokens exceeds available budget ${availableInputTokens} for model context ${contextLimitTokens}. Reduce evidence caps or raise context allowance. Current caps: files=${caps.maxFiles}, bytes/file=${caps.maxBytesPerFile}, totalEvidenceBytes=${caps.maxTotalBytes}.`
    )
  }

  return {
    bundle: promptBundle,
    userContent,
    estimatedPromptTokens: estimatedTokens,
    availableInputTokens,
    trimmedEvidenceCount: trimmedCount,
  }
}

function normalizeEnvTemplateSecretFindings(markdown) {
  if (!markdown || !markdown.includes('## Key Findings (Prioritized)')) return markdown

  return markdown.replace(
    /###\s*\[(Critical|High|Medium|Low|Info)\]\s+([^\n]+)\n([\s\S]*?)(?=\n###\s*\[(?:Critical|High|Medium|Low|Info)\]\s+|\n##\s+|$)/g,
    (block, _sev, title, bodyRest) => {
      const blockText = `### [${_sev}] ${title}\n${bodyRest}`
      const evidenceMatch = /\*\*Evidence:\*\*\s*([^\n]+)/i.exec(blockText)
      if (!evidenceMatch) return block
      const evidence = evidenceMatch[1]

      const hasTemplateEnv = /\.env\.(example|sample|template)\b/i.test(evidence)
      const hasNonTemplateCodePath = /\b[\w./-]+\.(js|ts|jsx|tsx|py|go|java|rb|php|cs|json|ya?ml|toml|tf)\b/i.test(
        evidence
      )
      if (!hasTemplateEnv || hasNonTemplateCodePath) return block

      const hasSecretExposureFraming =
        /\b(hardcoded\s+secrets?|environment\s+variable\s+exposure|secret\s+exposure|sensitive\s+information)\b/i.test(
          `${title}\n${blockText}`
        )
      if (!hasSecretExposureFraming) return block

      const rebuilt = `### [Info] Environment Template Configuration Review
**Category:** Configuration Review  
**Evidence:** ${evidence}  
**Why it matters:** These env-template files appear to document placeholder variable names and setup guidance. Template-only evidence does not prove committed secret material or a live credential leak path.  
**Fix (recommended):** Keep placeholders non-sensitive, avoid committing populated credentials, and verify real secrets are stored only in runtime secret managers.  
**Residual risk & tests:** Review the referenced template files for accidental populated values and validate CI secret scanning on real credential patterns.`
      return rebuilt
    }
  )
}

const NON_FINDING_SECTION_TITLES = new Set([
  'Dependency & Supply Chain Notes',
  'CI/CD & Operational Hardening',
  'Web Security Controls',
  'Docker/IaC Observations',
  'Rate Limiting & Abuse Controls',
  'File Upload Security',
  'Session Management',
])

const ABSENCE_CLAIM_PATTERN =
  /\b(no\s+evidence\s+of|no|not observed|not identified|does not(?:\s+\w+){0,3}\s+include|did not(?:\s+\w+){0,3}\s+include|were not observed|cannot be assessed)\b/i
const FILE_PATH_BASIS_PATTERN =
  /[`'][\w./-]+\.(js|ts|jsx|tsx|json|mjs|cjs|yml|yaml|toml|tf|dockerfile|md)[`']/i
const COVERAGE_BASIS_PATTERN =
  /\b(scanned files?|scanned scope|scan coverage|coverage (is )?limited|not evidenced in scanned files|outside the scanned set|files included in this scan|scan did not include|this run did not include)\b/i

function normalizeUnboundedAbsenceClaims(markdown) {
  if (!markdown || typeof markdown !== 'string') return markdown

  const lines = markdown.split(/\r?\n/)
  const sectionRanges = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+)$/)
    if (!m) continue
    const title = m[1].trim()
    sectionRanges.push({ title, start: i + 1, end: lines.length })
  }

  for (let i = 0; i < sectionRanges.length; i++) {
    sectionRanges[i].end = i + 1 < sectionRanges.length ? sectionRanges[i + 1].start - 1 : lines.length
  }

  let changed = false
  for (let idx = sectionRanges.length - 1; idx >= 0; idx--) {
    const section = sectionRanges[idx]
    if (!NON_FINDING_SECTION_TITLES.has(section.title)) continue

    const bodyLines = lines.slice(section.start, section.end)
    const body = bodyLines.join('\n').trim()
    if (!body) continue
    if (!ABSENCE_CLAIM_PATTERN.test(body)) continue

    const hasBasis = FILE_PATH_BASIS_PATTERN.test(body) || COVERAGE_BASIS_PATTERN.test(body)
    if (hasBasis) continue

    const boundedPrefix =
      'Not evidenced in scanned files included in this run. Coverage is limited to files selected for this scan, and omitted paths were not analyzed.'
    const rewritten = `${boundedPrefix}\n\n${body}`
    const rewrittenLines = rewritten.split('\n')

    lines.splice(section.start, section.end - section.start, ...rewrittenLines)
    changed = true
  }

  return changed ? lines.join('\n') : markdown
}

function normalizeSpeculativeMediumFindings(markdown) {
  if (!markdown || !markdown.includes('## Key Findings (Prioritized)')) return markdown

  return markdown.replace(
    /###\s*\[(Critical|High|Medium|Low|Info)\]\s+([^\n]+)\n([\s\S]*?)(?=\n###\s*\[(?:Critical|High|Medium|Low|Info)\]\s+|\n##\s+|$)/g,
    (block, severity, title, bodyRest) => {
      if (String(severity).toLowerCase() !== 'medium') return block

      const body = String(bodyRest || '')
      const hasEvidenceField = /\*\*Evidence:\*\*/i.test(body)
      const hasHedgePattern =
        /\b(could|may|might|potential|consider|review|ensure|improved|strengthened|if not properly)\b/i.test(
          body
        )

      const hasConcreteWeaknessSignal =
        /\b(does not|fails to|missing|absent|not enforced|insufficient|lacks?)\b/i.test(body) &&
        /\b(validate|verify|authenticate|authorize|sanitize|rate[- ]?limit|csrf|csp|hardening|ownership)\b/i.test(
          body
        )

      const hasPlausibleImpactSignal =
        /\b(attacker|unauthorized|unauthenticated|malicious|abuse|bypass|tamper|exfiltrat|escalat|data breach|information disclosure)\b/i.test(
          body
        )

      if (!hasEvidenceField || !hasHedgePattern || (hasConcreteWeaknessSignal && hasPlausibleImpactSignal)) {
        return block
      }

      return `### [Low] ${title}
${body}`
    }
  )
}

function normalizeKeyFindingAdmission(markdown) {
  if (!markdown || !markdown.includes('## Key Findings (Prioritized)')) return markdown

  const headingRe = /^##\s+(.+)$/gm
  const headings = []
  let hm
  while ((hm = headingRe.exec(markdown)) !== null) {
    headings.push({ idx: hm.index, title: hm[1].trim() })
  }
  const keyIdx = headings.findIndex((h) => h.title === 'Key Findings (Prioritized)')
  if (keyIdx === -1) return markdown

  const keyStart = headings[keyIdx].idx
  const keyBodyStart = markdown.indexOf('\n', keyStart) + 1
  const keyEnd = keyIdx + 1 < headings.length ? headings[keyIdx + 1].idx : markdown.length
  const keyBody = markdown.slice(keyBodyStart, keyEnd)

  const recIdx = headings.findIndex((h) => h.title === SECTION_PRIORITIZED_RECOMMENDATIONS)
  if (recIdx === -1) return markdown
  const recStart = headings[recIdx].idx
  const recBodyStart = markdown.indexOf('\n', recStart) + 1
  const recEnd = recIdx + 1 < headings.length ? headings[recIdx + 1].idx : markdown.length
  const quickBody = markdown.slice(recBodyStart, recEnd)

  const blockRe = /(^###\s*\[(Critical|High|Medium|Low|Info)\]\s+[^\n]+\n[\s\S]*?)(?=^###\s*\[(?:Critical|High|Medium|Low|Info)\]\s+|^##\s+|\s*$)/gm
  const blocks = []
  let bm
  while ((bm = blockRe.exec(keyBody)) !== null) {
    blocks.push({ full: bm[1], severity: bm[2] })
  }
  if (blocks.length === 0) return markdown

  const keep = []
  const demotedQuickWins = []
  const parseEvidencePaths = (evidenceText) => {
    const out = []
    const re = /`([^`\n]+?)`/g
    let m
    while ((m = re.exec(String(evidenceText || '')))) {
      const raw = String(m[1] || '')
      const path = raw.split(':')[0].trim()
      if (path) out.push(path)
    }
    return [...new Set(out)]
  }
  const isConfigLikePath = (p) =>
    /^\.github\/workflows\//i.test(p) ||
    /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|eslint|prettier|vite|vitest|tailwind|postcss|firebase\.json|vercel\.json|tsconfig(\.[^/]+)?\.json)$/i.test(
      p
    ) ||
    /\.(ya?ml|json|toml|md|rules)$/i.test(p)
  const isDomainCodePath = (p) =>
    /(^|\/)(functions\/src\/|src\/|app\/api\/|pages\/api\/|server\/|lib\/)/i.test(p) &&
    /\.(ts|tsx|js|jsx|mjs|cjs|go|py)$/i.test(p)
  const isServerEntrypointPath = (p) =>
    /(^|\/)(functions\/src\/(index|main|app|server)|app\/api\/|pages\/api\/|server\/(index|main|app|server)|server\/routes\/)/i.test(
      p
    ) && /\.(ts|tsx|js|jsx|mjs|cjs|go|py)$/.test(p)
  const isControlHelperPath = (p) =>
    /(^|\/)(middleware|auth|authorization|authentication|validation|validate|schema|schemas|zod|error|errors|rateLimit|rate-limit|throttle|inviteToken|claims?|permissions|roles)\b/i.test(
      p
    ) && /\.(ts|tsx|js|jsx|mjs|cjs|go|py)$/.test(p)
  const isClientBridgePath = (p) =>
    /^src\/contexts\/AuthContext\.(ts|tsx|js|jsx)$/i.test(p) ||
    /^src\/components\/Auth\/(AuthCallback|SessionProtectedRoute)\.(ts|tsx|js|jsx)$/i.test(p)
  const isPolicyPath = (p) => /(^|\/)(firestore\.rules|storage\.rules|firebase\.json|\.github\/workflows\/)/i.test(p)

  for (const b of blocks) {
    const full = b.full.trim()
    const titleMatch = full.match(/^###\s*\[(?:Critical|High|Medium|Low|Info)\]\s+([^\n]+)/i)
    const title = (titleMatch?.[1] || '').trim()
    const evidence = (/\*\*Evidence:\*\*\s*([\s\S]*?)(?=\n\*\*[^*\n]+:\*\*|$)/i.exec(full)?.[1] || '').trim()
    const why = (/\*\*Why it matters:\*\*\s*([\s\S]*?)(?=\n\*\*[^*\n]+:\*\*|$)/i.exec(full)?.[1] || '').trim()
    const fix = (/\*\*Fix \(recommended\):\*\*\s*([\s\S]*?)(?=\n\*\*[^*\n]+:\*\*|$)/i.exec(full)?.[1] || '').trim()
    const text = `${title}\n${evidence}\n${why}\n${fix}`
    const evidencePaths = parseEvidencePaths(evidence)

    const looksGeneric =
      /\b(inadequate\s+authentication\s+checks?|lack\s+of\s+rate[- ]?limit(?:ing)?(?:\s+on\s+[^.\n]+)?|insecure\s+ci\/cd\s+configuration|linting\s+and\s+code\s+quality|code\s+quality|best\s+practices?)\b/i.test(text) ||
      /\b(implement|enhance|enforce|review|ensure|consider)\b/i.test(text)
    const hasConcreteSignal =
      /\b(missing|absent|not\s+set|set\s+to\s+false|not\s+enforced|does\s+not)\b/i.test(text) &&
      /\b(permission|permissions|environment\s+protection|audit-level|header|csp|csrf|rate[- ]?limit|ownership|auth(?:orization|entication)?)\b/i.test(
        text
      )
    const missingCoreFields = !evidence || !why || !fix
    const hasAnyEvidencePath = evidencePaths.length > 0
    const hasDomainEvidence = evidencePaths.some((p) => isDomainCodePath(p))
    const hasServerEntrypointEvidence = evidencePaths.some((p) => isServerEntrypointPath(p))
    const hasControlHelperEvidence = evidencePaths.some((p) => isControlHelperPath(p))
    const hasClientBridgeEvidence = evidencePaths.some((p) => isClientBridgePath(p))
    const hasPolicyEvidence = evidencePaths.some((p) => isPolicyPath(p))
    const configOnlyEvidence = hasAnyEvidencePath && evidencePaths.every((p) => isConfigLikePath(p))
    const authOrRateOrValidationClaim =
      /\b(auth|authorization|authentication|session|rbac|rate[- ]?limit|abuse|validation|input)\b/i.test(
        `${title}\n${why}`
      )
    const authInviteSessionClaim = /\b(auth|authorization|authentication|session|invite|token|claims?)\b/i.test(
      `${title}\n${why}`
    )
    const hasMinimalEvidencePack =
      hasServerEntrypointEvidence && hasControlHelperEvidence && (hasClientBridgeEvidence || hasPolicyEvidence)

    if (
      ((looksGeneric || missingCoreFields) && !hasConcreteSignal) ||
      !hasAnyEvidencePath ||
      (authOrRateOrValidationClaim && !hasDomainEvidence) ||
      (authInviteSessionClaim && !hasMinimalEvidencePack) ||
      (configOnlyEvidence && !hasConcreteSignal)
    ) {
      if (fix) demotedQuickWins.push(fix.replace(/\s+/g, ' ').trim())
      continue
    }
    keep.push(full)
  }

  let newKeyBody = keep.join('\n\n')
  if (!newKeyBody.trim()) {
    newKeyBody = 'No findings were identified within the scanned scope.'
  }

  let newQuickBody = quickBody
  if (demotedQuickWins.length > 0) {
    const deduped = [...new Set(demotedQuickWins)]
    const existingCount = (newQuickBody.match(/^\s*\d+\.\s+/gm) || []).length
    const appended = deduped.map((w, i) => `${existingCount + i + 1}. ${w}`).join('\n')
    newQuickBody = `${newQuickBody.trim()}\n${newQuickBody.trim() ? '\n' : ''}${appended}\n`
  }

  return `${markdown.slice(0, keyBodyStart)}${newKeyBody}\n\n${markdown.slice(keyEnd, recBodyStart)}${newQuickBody}${markdown.slice(recEnd)}`
}

function normalizeQuickWinsEvidenceBound(markdown) {
  if (!markdown || !markdown.includes(`## ${SECTION_PRIORITIZED_RECOMMENDATIONS}`)) return markdown

  const headingRe = /^##\s+(.+)$/gm
  const headings = []
  let hm
  while ((hm = headingRe.exec(markdown)) !== null) {
    headings.push({ idx: hm.index, title: hm[1].trim() })
  }
  const quickIdx = headings.findIndex((h) => h.title === SECTION_PRIORITIZED_RECOMMENDATIONS)
  if (quickIdx === -1) return markdown
  const keyIdx = headings.findIndex((h) => h.title === 'Key Findings (Prioritized)')

  const quickStart = headings[quickIdx].idx
  const quickBodyStart = markdown.indexOf('\n', quickStart) + 1
  const quickEnd = quickIdx + 1 < headings.length ? headings[quickIdx + 1].idx : markdown.length
  const quickBody = markdown.slice(quickBodyStart, quickEnd)

  let keyBody = ''
  if (keyIdx >= 0) {
    const keyStart = headings[keyIdx].idx
    const keyBodyStart = markdown.indexOf('\n', keyStart) + 1
    const keyEnd = keyIdx + 1 < headings.length ? headings[keyIdx + 1].idx : markdown.length
    keyBody = markdown.slice(keyBodyStart, keyEnd)
  }
  const noFindings = /no\s+findings\s+were\s+identified\s+within\s+the\s+scanned\s+scope/i.test(keyBody)

  const citationMatches = [...markdown.matchAll(/`([\w./-]+\.(?:js|ts|jsx|tsx|json|mjs|cjs|ya?ml|toml|tf|rules):\d+\s*-\s*\d+)`/gi)].map(
    (m) => m[1]
  )
  const citations = [...new Set(citationMatches)]
  const extractBarePaths = (item) => {
    const hits = []
    const re = /(?:`)?([\w./-]+\.(?:js|ts|jsx|tsx|json|mjs|cjs|ya?ml|toml|tf|rules))(?:`)?/gi
    let m
    while ((m = re.exec(item))) {
      hits.push(String(m[1] || ''))
    }
    return [...new Set(hits)]
  }
  const findCitationFromExplicitPath = (item) => {
    const barePaths = extractBarePaths(item)
    for (const p of barePaths) {
      const hit = citations.find((c) => c.toLowerCase().startsWith(`${p.toLowerCase()}:`))
      if (hit) return { citation: hit, barePath: p }
    }
    return { citation: null, barePath: barePaths[0] || null }
  }

  const lines = quickBody.split(/\r?\n/)
  const bulletLines = lines.filter((l) => /^\s*(\d+\.\s+|-+\s+)/.test(l))
  if (bulletLines.length === 0) return markdown

  const scopedRe = /\b(if present|if applicable|where applicable|consider|may|might|could|scanned files?|included in this run|coverage is limited|not evidenced in scanned files)\b/i
  const lineCiteRe = /`[\w./-]+\.(?:js|ts|jsx|tsx|json|mjs|cjs|ya?ml|toml|tf|rules):\d+\s*-\s*\d+`/i
  const imperativeLeadRe = /^(implement|enhance|enforce|review|add|establish|require)\b/i

  const rewritten = []
  let n = 1
  for (const raw of bulletLines) {
    const item = raw.replace(/^\s*(\d+\.\s+|-+\s+)/, '').trim()
    const alreadyScoped = scopedRe.test(item) || lineCiteRe.test(item)
    if (alreadyScoped) {
      rewritten.push(`${n}. ${item}`)
      n++
      continue
    }
    const { citation, barePath } = findCitationFromExplicitPath(item)
    const lower = item.charAt(0).toLowerCase() + item.slice(1)
    const action = imperativeLeadRe.test(item) ? lower : `review whether ${lower}`
    if (noFindings) {
      if (barePath) {
        rewritten.push(
          `${n}. For scanned \`${barePath}\`, consider validating this behavior in targeted follow-up checks if applicable.`
        )
      } else {
        rewritten.push(`${n}. For scanned files in this run, consider ${action.replace(/\.$/, '')} if applicable.`)
      }
    } else if (citation) {
      rewritten.push(`${n}. For scanned \`${citation}\`, consider ${action.replace(/\.$/, '')}.`)
    } else if (barePath) {
      rewritten.push(
        `${n}. For scanned \`${barePath}\`, consider ${action.replace(/\.$/, '')} if additional evidence confirms a concrete gap.`
      )
    } else {
      rewritten.push(`${n}. Consider ${action.replace(/\.$/, '')} based on scanned evidence.`)
    }
    n++
  }

  const newQuickBody = `${rewritten.join('\n')}\n`
  return `${markdown.slice(0, quickBodyStart)}${newQuickBody}${markdown.slice(quickEnd)}`
}

function normalizeNoFindingsNarrativeBounded(markdown) {
  if (!markdown || !markdown.includes('## Key Findings (Prioritized)')) return markdown
  const keyBodyMatch = markdown.match(
    /##\s+Key Findings \(Prioritized\)\s*([\s\S]*?)(?=\n##\s+|$)/i
  )
  const keyBody = keyBodyMatch ? keyBodyMatch[1] : ''
  const noFindings = /no\s+findings\s+were\s+identified\s+within\s+the\s+scanned\s+scope/i.test(keyBody)
  if (!noFindings) return markdown

  const targetSections = [
    'Executive Summary',
    'CI/CD & Operational Hardening',
    'Web Security Controls',
    'Rate Limiting & Abuse Controls',
    'Session Management',
  ]
  let out = markdown
  for (const title of targetSections) {
    const sectionRe = new RegExp(
      `(##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*)([\\s\\S]*?)(?=\\n##\\s+|$)`,
      'i'
    )
    out = out.replace(sectionRe, (_m, hdr, body) => {
      let b = String(body || '')
      b = b.replace(
        /\b(additional\s+measures?\s+are\s+needed|require\s+attention|there\s+are\s+still\s+gaps?|should\s+be\s+(implemented|added|enhanced|considered)|additional\s+measures?\s+such\s+as\b[^.\n]{0,120}\bshould\s+be\s+considered)\b/gi,
        (txt) => {
          const t = txt.toLowerCase()
          if (t.includes('needed')) return 'may be needed if present outside scanned files'
          if (t.includes('require attention')) return 'may require attention depending on omitted paths'
          if (t.includes('gaps')) return 'potential gaps may exist outside scanned files'
          return 'could be considered where applicable'
        }
      )
      if (!/not evidenced in scanned files|coverage is limited|if applicable|if present|may|might|could/i.test(b)) {
        b = `Not fully evidenced in scanned files included in this run. Coverage is limited by omitted paths.\n\n${b.trim()}`
      }
      return `${hdr}${b}`
    })
  }
  return out
}

function normalizeUsageFragment(usage) {
  if (!usage) return null
  return {
    prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
  }
}

function estimateUsageCostUsd(totalUsage) {
  const promptTokens = typeof totalUsage?.prompt_tokens === 'number' ? totalUsage.prompt_tokens : 0
  const completionTokens =
    typeof totalUsage?.completion_tokens === 'number' ? totalUsage.completion_tokens : 0

  // Planning assumption used by the launch-readiness telemetry log for gpt-4o-mini.
  const inputCost = (promptTokens / 1_000_000) * 0.15
  const outputCost = (completionTokens / 1_000_000) * 0.60
  return Number((inputCost + outputCost).toFixed(5))
}

function writeQualityGateDebugArtifact(payload) {
  if (process.env.NODE_ENV !== 'development') return

  try {
    const outDir = resolve(process.env.SECLENS_QG_DEBUG_OUT || '.seclens-quality-gate')
    mkdirSync(outDir, { recursive: true })
    const outPath = join(outDir, `${payload.correlationId}.json`)
    writeFileSync(outPath, JSON.stringify(payload, null, 2))
    console.error(`[ReportQualityGate][debug] wrote ${outPath}`)
  } catch (error) {
    console.error(
      '[ReportQualityGate][debug] failed to write artifact:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function buildCoverageBlock(repoData, bundle) {
  const inv = bundle.inventory
  const cov = bundle.coverage
  const refLine = bundle.repository.scannedSha
    ? `Ref: ${bundle.repository.scannedRef} @ ${bundle.repository.scannedSha.slice(0, 7)} (default branch: ${bundle.repository.defaultBranch})`
    : `Ref: ${bundle.repository.scannedRef} (default branch: ${bundle.repository.defaultBranch})`

  const capNotes = [
    cov.maxFilesCapHit ? 'file count cap' : null,
    cov.maxBytesPerFileCapHit ? 'per-file excerpt cap' : null,
    cov.maxTotalBytesCapHit ? 'total evidence bytes cap' : null,
    cov.maxTreeSizeCapHit ? 'repository tree size cap' : null,
  ]
    .filter(Boolean)
    .join('; ')

  return `Scan coverage for this analysis:
- Repository URL: ${repoData.url || 'unknown'}
- Owner/name: ${repoData.owner}/${repoData.repo}
- Generated timestamp: ${new Date().toISOString()}
- ${refLine}
- Tier meaning for report readers: Tier 1 = high-signal repository/security/config files such as manifests, lockfiles, CI workflows, Docker/IaC, env templates, and policy files; Tier 2 = application security surface such as routes, middleware, auth, API handlers, server code, and tests around those paths; Tier 3 = supporting application/source context that may help explain findings but is lower-priority when the scan budget is tight.
- Inventory (paths seen): ${inv.totalFilesSeen}; tier-eligible counts — tier1 ${inv.filesEligibleByTier.tier1}, tier2 ${inv.filesEligibleByTier.tier2}, tier3 ${inv.filesEligibleByTier.tier3}
- Paths selected by strategy (${inv.filesSelected}); paths omitted (${inv.filesOmitted}) — categories summarized only.
- Line-addressable evidence excerpts included below (${bundle.evidence.length}).
- Caps & honesty: ${capNotes || 'within configured limits'}${cov.notes?.length ? ` — ${cov.notes.join(' | ')}` : ''}
- Do not claim full-file or full-repository review unless clearly supported; state limitations in Confidence & Coverage.`
}

/**
 * Runs repository security analysis with output contract v2 validation.
 * @returns {Promise<{ report: string, reportContractVersion: string, reportValidation: { ok: boolean, repairedAfterCritic: boolean }, correlationId: string, tokenUsage: { draft: object|null, critic: object|null, total: { prompt_tokens: number, completion_tokens: number, total_tokens: number } } }>}
 */
export async function analyzeSecurity(repoData) {
  const correlationId = randomUUID()

  if (!repoData?.files || !Array.isArray(repoData.files)) {
    throw new Error('Invalid repository data: files array is missing or invalid')
  }

  const caps = getIngestionCaps()
  const bundle =
    repoData.evidenceBundle && typeof repoData.evidenceBundle === 'object'
      ? repoData.evidenceBundle
      : stubEvidenceBundleFromLegacyRepoData(repoData, caps)

  const client = getOpenAIClient()

  const plan = buildMultiPassPlan(bundle)
  if (!plan.analysisPassCount) {
    throw new Error('Stage A mapping produced zero analysis passes')
  }

  const passRuns = await Promise.all(
    plan.passes.map(async (pass) => {
      try {
        const passBundle = { ...bundle, evidence: pass.evidence }
        const promptPrep = preparePromptBoundedBundle(passBundle, repoData)
        const userContent = promptPrep.userContent
        const extractionPrompt = `${userContent}

Pass focus:
- Pass id: ${pass.id}
- Pass family: ${pass.family}
- Analyze only this domain-specific evidence cluster.

Output JSON only with this shape:
{
  "claims": [
    {
      "claimSchemaVersion": 1,
      "candidate_id": "cand_001",
      "kind": "finding|observation|observed_control|unverified_control|recommendation|quick_win|coverage_note",
      "topic": "auth|invite|rate_limit|validation|cicd|headers|session|dependency",
      "title": "string",
      "severity": "Critical|High|Medium|Low|Info|None",
      "claim": "string",
      "specific_code_behavior": "string",
      "missing_control_or_unsafe_condition": "string",
      "impact": "string",
      "evidence_citations": ["path:start-end"],
      "evidence_ref_ids": ["ev_001"],
      "evidence_categories": ["server_entrypoint","control_helper","policy","client_bridge"],
      "confidence": "high|medium|low",
      "scoped_to_scan": true,
      "derived_from_candidate_ids": ["cand_002"],
      "coverage_basis": "string"
    }
  ]
}

Rules:
- Return only JSON.
- Do not output markdown.
- Use coverage-bounded language for uncertain/no-findings claims.
- quick_win must never be High/Critical.
- coverage_note must not claim concrete vulnerabilities.
- finding is reserved for concrete evidence-backed weaknesses only.
- Use observed_control when controls appear present in cited code.
- Use unverified_control when an important control could not be proven from cited code.
- Use recommendation for actionable hardening or follow-up work.
- Use observation for scoped non-defect notes.
- Do NOT emit finding for UI/component prop validation unless citations show trust boundary, auth decision, sensitive data flow, or attacker-controlled input path.
- Do NOT emit finding for generic validation hardening that lacks named missing rule/control.
- Do NOT emit finding for rate-limit concerns when cited code already shows limiter usage and no bypass/threshold weakness is evidenced.
- Do NOT emit High/Critical for CI/CD or config-only concerns unless citations prove secret exposure, deployment compromise path, bypass, or unauthorized access path.
- Do NOT emit finding for Firestore/rules concerns unless a specific rule path, role predicate, and unauthorized read/write path are identified.
- For High/Critical finding candidates include explicit attacker entry point, missing check, and security impact in the claim fields.`
        const extractionCompletion = await client.chat.completions.create({
          model: analysisModel(),
          messages: [
            {
              role: 'system',
              content:
                'You are SecLens structured-claim extractor. Return valid JSON only, no markdown, no commentary.',
            },
            { role: 'user', content: extractionPrompt },
          ],
          max_tokens: maxAnalysisTokens(),
          temperature: 0.1,
        })
        const extractionContent = extractionCompletion.choices[0]?.message?.content || ''
        const parsed = parseCandidatePayload(extractionContent)
        return {
          ok: true,
          passId: pass.id,
          family: pass.family,
          requiredHighRisk: pass.requiredHighRisk,
          parsed,
          usage: extractionCompletion.usage || null,
          promptBudgetTrimmedEvidenceCount: promptPrep.trimmedEvidenceCount,
          promptBudgetEstimatedTokens: promptPrep.estimatedPromptTokens,
          promptBudgetAvailableInputTokens: promptPrep.availableInputTokens,
          examinedFiles: pass.evidencePaths,
          examinedEvidenceCount: pass.evidence.length,
        }
      } catch (error) {
        return {
          ok: false,
          passId: pass.id,
          family: pass.family,
          requiredHighRisk: pass.requiredHighRisk,
          error: mapOpenAIError(error).message,
          examinedFiles: pass.evidencePaths,
          examinedEvidenceCount: pass.evidence.length,
        }
      }
    })
  )

  const failedPasses = passRuns.filter((p) => !p.ok)
  const failDecision = shouldFailForPassFailures(plan, failedPasses)
  if (failDecision.fail) {
    throw new Error(`Multi-pass analysis failed: ${failDecision.reason}`)
  }

  const successfulPasses = passRuns.filter((p) => p.ok)
  const mergedClaims = successfulPasses.flatMap((p) => p.parsed.claims || [])
  const evidenceByPath = new Map((bundle.evidence || []).map((ev) => [ev.path, ev]))
  const admittedCountsByPass = successfulPasses.reduce((acc, p) => {
    const passBundle = {
      ...bundle,
      evidence: (p.examinedFiles || []).map((path) => evidenceByPath.get(path)).filter(Boolean),
    }
    const perPassAdmission = admitCandidates(p.parsed.claims || [], passBundle)
    acc[p.passId] = summarizeAdmittedCounts(perPassAdmission.admitted)
    return acc
  }, {})
  const parsed = {
    claims: mergedClaims,
    parseError: successfulPasses.some((p) => p.parsed.parseError) ? 'partial' : null,
  }
  const admissionResult = admitCandidates(parsed.claims, bundle)
  let report = renderDeterministicReport({
    repoData: {
      owner: repoData.owner,
      repo: repoData.repo,
      url: repoData.url,
      language: repoData.language,
      scannedRef: repoData.scannedRef,
      defaultBranch: repoData.defaultBranch,
    },
    admitted: admissionResult.admitted,
    coverage: admissionResult.coverage,
    bundle,
  })

  // CR-008 deterministic contract: do not run post-render semantic normalizers.
  // Semantic mutation after deterministic render can desync Summary Risk / Prioritized Recommendations
  // from Key Findings state and create hidden second-phase admission behavior.

  const draftUsage = sumUsage(...successfulPasses.map((p) => p.usage))
  const criticUsages = []
  const repairedAfterCritic = false
  const originalDraft = report
  const validation = validateReport(report)
  const structuredTelemetry = {
    ...summarizeAdmissionTelemetry(parsed, admissionResult, report, bundle),
    analysisPassCount: plan.analysisPassCount,
    analysisPasses: passRuns.map((p) => ({
      passId: p.passId,
      family: p.family,
      ok: p.ok,
      examinedEvidenceCount: p.examinedEvidenceCount,
      examinedFiles: p.examinedFiles,
      promptBudgetTrimmedEvidenceCount: p.promptBudgetTrimmedEvidenceCount || 0,
      promptBudgetEstimatedTokens: p.promptBudgetEstimatedTokens || 0,
      promptBudgetAvailableInputTokens: p.promptBudgetAvailableInputTokens || 0,
    })),
    passTypeCounts: passRuns.reduce((acc, p) => {
      acc[p.family] = (acc[p.family] || 0) + 1
      return acc
    }, {}),
    passEvidenceCounts: passRuns.reduce((acc, p) => {
      acc[p.passId] = p.examinedEvidenceCount || 0
      return acc
    }, {}),
    passTrimmedEvidenceCounts: passRuns.reduce((acc, p) => {
      acc[p.passId] = p.promptBudgetTrimmedEvidenceCount || 0
      return acc
    }, {}),
    passPromptEstimatedTokens: passRuns.reduce((acc, p) => {
      acc[p.passId] = p.promptBudgetEstimatedTokens || 0
      return acc
    }, {}),
    passPromptAvailableInputTokens: passRuns.reduce((acc, p) => {
      acc[p.passId] = p.promptBudgetAvailableInputTokens || 0
      return acc
    }, {}),
    candidateCountsByPass: successfulPasses.reduce((acc, p) => {
      acc[p.passId] = (p.parsed.claims || []).length
      return acc
    }, {}),
    admittedCountsByPass,
    reportSynthesisDedupedFindingCount:
      (parsed.claims || []).filter((c) => c.kind === 'finding').length - admissionResult.admitted.findings.length,
    reportSynthesisDedupedRecommendationCount:
      (parsed.claims || []).filter((c) => c.kind === 'recommendation' || c.kind === 'quick_win').length -
      (admissionResult.admitted.recommendations.length + admissionResult.admitted.quickWins.length),
    clusterInventory: plan.clusterInventory,
    clusterSkipReasons: plan.clusterSkipReasons,
    passFailureCount: failedPasses.length,
    passFailureReasons: failedPasses.map((p) => ({ passId: p.passId, family: p.family, error: p.error })),
    passFailurePolicyTriggered: failDecision.reason,
  }
  const initialValidationCategories = [
    ...(parsed.parseError ? ['STRUCTURED_PARSE_ERROR'] : []),
    ...(admissionResult.rejections.length > 0 ? ['STRUCTURED_ADMISSION_REJECTIONS'] : []),
  ]
  const finalValidationCategories = validation.ok ? [] : [...validation.categories]

  if (!validation.ok) {
    const cats = validation.categories.length ? validation.categories : ['UNKNOWN']
    const totalUsage = sumUsage(draftUsage, ...criticUsages)
    writeQualityGateDebugArtifact({
      correlationId,
      generatedAt: new Date().toISOString(),
      categories: cats,
      repairedAfterCritic,
      repository: {
        owner: repoData.owner,
        repo: repoData.repo,
        url: repoData.url,
        defaultBranch: bundle.repository.defaultBranch,
        scannedRef: bundle.repository.scannedRef,
        scannedSha: bundle.repository.scannedSha || null,
      },
      ingestion: repoData.ingestion || null,
      bundleSummary: {
        inventory: bundle.inventory,
        coverage: bundle.coverage,
      },
      tokenUsage: {
        draft: normalizeUsageFragment(draftUsage),
        critic: normalizeUsageFragment(sumUsage(...criticUsages)),
        total: totalUsage,
        estimatedCostUsd: estimateUsageCostUsd(totalUsage),
      },
      structuredTelemetry,
      initialValidationCategories,
      finalValidationCategories,
      reports: {
        originalDraft,
        finalRejectedReport: report,
      },
    })
    throw new ReportQualityGateError('Report failed SecLens quality validation.', {
      correlationId,
      categories: cats,
    })
  }

  return {
    report,
    reportContractVersion: OUTPUT_CONTRACT_VERSION,
    reportValidation: {
      ok: true,
      repairedAfterCritic,
      structuredTelemetry,
      initialValidationCategories,
      finalValidationCategories,
      normalizersApplied: [
        'none_post_render_semantic_mutation',
      ],
    },
    correlationId,
    tokenUsage: {
      draft: draftUsage,
      critic: sumUsage(...criticUsages),
      total: sumUsage(draftUsage, ...criticUsages),
    },
  }
}

function sumUsage(...usages) {
  return usages.reduce(
    (acc, usage) => {
      if (!usage) return acc
      acc.prompt_tokens += usage.prompt_tokens || 0
      acc.completion_tokens += usage.completion_tokens || 0
      acc.total_tokens += usage.total_tokens || 0
      return acc
    },
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  )
}

function mapOpenAIError(error) {
  const status = error?.status
  if (status === 401) {
    return new Error('Invalid OpenAI API key')
  }
  if (status === 429) {
    return new Error('OpenAI API rate limit exceeded')
  }
  if (status === 500) {
    return new Error('OpenAI API server error')
  }
  return error instanceof Error ? error : new Error(String(error))
}

function summarizeAdmittedCounts(admitted) {
  const observations = admitted.observations || []
  const observedControls = admitted.observedControls || []
  const unverifiedControls = admitted.unverifiedControls || []
  const recommendations = admitted.recommendations || []
  const quickWins = admitted.quickWins || []
  const coverageNotes = admitted.coverageNotes || []
  return {
    total:
      (admitted.findings || []).length +
      observations.length +
      recommendations.length +
      quickWins.length +
      coverageNotes.length,
    finding: (admitted.findings || []).length,
    observation: observations.length,
    observed_control: observedControls.length,
    unverified_control: unverifiedControls.length,
    recommendation: recommendations.length,
    quick_win: quickWins.length,
    coverage_note: coverageNotes.length,
  }
}
