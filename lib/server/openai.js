/**
 * OpenAI client — contract v2 draft, validation, optional critic repair.
 */

import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { OUTPUT_CONTRACT_VERSION, buildContractInstructions } from '../prompts/seclens-output-contract-v2.js'
import { buildEvidenceRules } from '../prompts/seclens-evidence-rules-v1.js'
import { buildPhasedAnalysisInstructions } from '../prompts/seclens-phased-analysis-v1.js'
import { buildCriticSystemPrompt, buildCriticUserPrompt } from '../prompts/seclens-critic-rubric-v1.js'
import { validateReport, redactLeakagePatterns } from './reportValidation.js'
import { ReportQualityGateError } from './reportQualityGateError.js'
import { getIngestionCaps } from './ingestionCaps.js'
import {
  renderEvidenceForPrompt,
  stubEvidenceBundleFromLegacyRepoData,
  renderCitationManifestForPrompt,
  renderScannedPathsHint,
} from './evidenceBundle.js'

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

/** §13 A11 */
function isCriticEnabled() {
  const v = process.env.SECLENS_CRITIC_ENABLED
  if (v === 'true') return true
  if (v === 'false') return false
  return process.env.NODE_ENV !== 'development'
}

function analysisModel() {
  return process.env.SECLENS_ANALYSIS_MODEL || 'gpt-4o-mini'
}

function criticModel() {
  return process.env.SECLENS_CRITIC_MODEL || analysisModel()
}

function maxAnalysisTokens() {
  const raw = parseInt(process.env.SECLENS_MAX_ANALYSIS_TOKENS || '4096', 10)
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1024), 16384) : 4096
}

function maxCriticTokens() {
  const raw = parseInt(process.env.SECLENS_MAX_CRITIC_TOKENS || '8192', 10)
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1024), 16384) : 8192
}

function needsCalibrationRetry(categories) {
  return (
    categories.includes('MISLEADING_SECRET_CLASSIFICATION') ||
    categories.includes('SPECULATIVE_FINDING') ||
    categories.includes('UNBOUNDED_ABSENCE_CLAIM') ||
    categories.includes('SUMMARY_RISK_INCONSISTENT') ||
    categories.includes('NOT_EVIDENCED_DRIFT')
  )
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

  const userContent = `${buildCoverageBlock(repoData, bundle)}

${renderCitationManifestForPrompt(bundle)}

${renderScannedPathsHint(bundle)}

${buildContractInstructions()}

${buildEvidenceRules()}

${buildPhasedAnalysisInstructions()}

Repository description: ${repoData.description || 'No description'}
Primary language: ${repoData.language || 'Unknown'}

${renderEvidenceForPrompt(bundle)}`

  let completion
  try {
    completion = await client.chat.completions.create({
      model: analysisModel(),
      messages: [
        {
          role: 'system',
          content:
            'You are SecLens, an AI-assisted repository security reviewer. Follow the user instructions exactly. Output a single Markdown document only — no surrounding commentary.',
        },
        { role: 'user', content: userContent },
      ],
      max_tokens: maxAnalysisTokens(),
      temperature: 0.25,
    })
  } catch (error) {
    throw mapOpenAIError(error)
  }

  let report = completion.choices[0]?.message?.content
  if (!report) {
    throw new Error('No response from OpenAI API')
  }
  report = normalizeEnvTemplateSecretFindings(report)
  report = normalizeUnboundedAbsenceClaims(report)
  report = normalizeSpeculativeMediumFindings(report)

  const draftUsage = completion.usage || null
  const criticUsages = []
  let repairedAfterCritic = false
  const originalDraft = report
  let validation = validateReport(report)

  if (!validation.ok && isCriticEnabled()) {
    let draftForCritic = report
    if (validation.categories.includes('LEAKAGE')) {
      draftForCritic = redactLeakagePatterns(report)
    }

    try {
      const criticCompletion = await client.chat.completions.create({
        model: criticModel(),
        messages: [
          { role: 'system', content: buildCriticSystemPrompt() },
          {
            role: 'user',
            content: `${buildCriticUserPrompt({ failureCategories: validation.categories })}\n\n--- DRAFT ---\n\n${draftForCritic}`,
          },
        ],
        max_tokens: maxCriticTokens(),
        temperature: 0.1,
      })

      const repaired = criticCompletion.choices[0]?.message?.content
      criticUsages.push(criticCompletion.usage || null)
      if (repaired && repaired.trim()) {
        report = normalizeEnvTemplateSecretFindings(repaired)
        report = normalizeUnboundedAbsenceClaims(report)
        report = normalizeSpeculativeMediumFindings(report)
        repairedAfterCritic = true
        validation = validateReport(report)
      }

      if (!validation.ok && needsCalibrationRetry(validation.categories)) {
        const strictRetry = await client.chat.completions.create({
          model: criticModel(),
          messages: [
            {
              role: 'system',
              content: `${buildCriticSystemPrompt()}

Hard requirement for this retry:
- Findings tied only to .env.example/.env.sample/.env.template placeholder content MUST NOT remain Medium secret-exposure findings.
- Config/workflow hardening advice without a concrete evidenced unsafe setting MUST NOT remain Medium findings.
- If uncertain, downgrade to [Info] or [Low] with explicit "Not evidenced" boundaries.
- Non-finding sections MUST NOT contain unbounded absence claims (for example "there is no evidence of security checks"). Tie claims to scanned files/scope or add explicit coverage-bound wording.
- Summary Risk MUST align with finding severities unless explicit scan-bounded rationale is provided.
- If a section says "Not evidenced in scanned files", follow-on guidance must stay conditional and scope-limited, not directive.`,
            },
            {
              role: 'user',
              content: `Second repair attempt required. First repair still failed validation categories: ${validation.categories.join(
                ', '
              )}.

Rewrite the draft so those categories are resolved.
Return ONLY the full Markdown report.

--- DRAFT ---

${report}`,
            },
          ],
          max_tokens: maxCriticTokens(),
          temperature: 0,
        })

        const repairedRetry = strictRetry.choices[0]?.message?.content
        criticUsages.push(strictRetry.usage || null)
        if (repairedRetry && repairedRetry.trim()) {
          report = normalizeEnvTemplateSecretFindings(repairedRetry)
          report = normalizeUnboundedAbsenceClaims(report)
          report = normalizeSpeculativeMediumFindings(report)
          repairedAfterCritic = true
          validation = validateReport(report)
        }
      }
    } catch (error) {
      throw mapOpenAIError(error)
    }
  }

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
