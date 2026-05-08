/**
 * OpenAI client - contract v2 draft, validation, optional critic repair.
 */

import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  OUTPUT_CONTRACT_VERSION,
  buildContractInstructions,
} from '../prompts/seclens-output-contract-v2.js'
import { buildEvidenceRules } from '../prompts/seclens-evidence-rules-v1.js'
import { buildPhasedAnalysisInstructions } from '../prompts/seclens-phased-analysis-v1.js'
import { validateReport } from './reportValidation.js'
import { ReportQualityGateError } from './reportQualityGateError.js'
import { getIngestionCaps } from './ingestionCaps.js'
import { getRetrievalPolicy } from './ingestionCaps.js'
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
} from './structuredReportPipeline.js'
import { PASS_FAMILIES, buildMultiPassPlan, shouldFailForPassFailures } from './multiPassAnalysis.js'
import {
  buildDiligenceCorrectiveSupplement,
  dedupeClaimsByCandidateId,
  planDiligenceCorrectivePasses,
} from './evidenceDiligenceCorrective.js'
import { buildAdversarialReasoningBlock } from './adversarialReasoning.js'
import {
  assembleDimensionResult,
  assembleSkippedDimensionResult,
  buildRepositoryDisplay,
  createInitialDimensionRunState,
  dimensionIdForPassFamily,
  renderConsolidatedReport,
} from './dimensionAnalysis.js'
import {
  SCAN_PENDING_APPLICABILITY,
  createDashboardPayload,
  createEmptyDimensionResult,
  DIMENSION_CATALOG,
} from '../shared/dimensions.js'
import {
  buildAdvisoryOutput,
  validateAdvisoryOutputContract,
} from './advisoryContractValidation.js'
import { ADVISORY_CONTRACT_VERSION } from '../shared/advisoryContract.js'
import { inferRepoProfileFromPaths } from '../shared/repoProfile.js'
import { enrichRepoProfileFromDocumentationArtifacts } from '../shared/repoProfileDocs.js'
import { estimateOpenAIUsageCostUsd, resolveOpenAIModel } from '../shared/openaiModels.js'

const ANALYSIS_SYSTEM_PROMPT =
  'You are SecLens structured-claim extractor. Return valid JSON only, no markdown, no commentary.'
const DEFAULT_PLANNED_PASS_FAMILIES = Object.freeze([...PASS_FAMILIES])

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

function analysisModel(overrideModel = null) {
  return resolveOpenAIModel(overrideModel || process.env.SECLENS_ANALYSIS_MODEL).id
}

function resolvePlannedPassFamilies(options = {}) {
  const explicitFamilies = Array.isArray(options?.includePassFamilies)
    ? options.includePassFamilies.map((family) => String(family || '').trim()).filter(Boolean)
    : null
  if (explicitFamilies && explicitFamilies.length) {
    return [...new Set(explicitFamilies)].filter((family) => PASS_FAMILIES.includes(family))
  }

  return [...DEFAULT_PLANNED_PASS_FAMILIES]
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
  return Math.ceil(bytes / 3)
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

function evidencePathPriority(path, retrievalPolicy = getRetrievalPolicy()) {
  const p = String(path || '').toLowerCase()
  if (/^functions\/src\/|^src\/|^app\/api\/|^pages\/api\/|^server\/|^lib\//.test(p)) return 16
  if (/firestore\.rules|storage\.rules|firebase\.json|\.github\/workflows\//.test(p)) return 12
  if (/package-lock\.json|package\.json|pnpm-lock\.yaml|yarn\.lock/.test(p)) return 8
  if (retrievalPolicy.recallFirst && /\.(md|txt|adoc|rst|ya?ml|json|toml|ini|env|pdf|docx?)$/.test(p)) return 6
  if (/__tests__|\.test\.|\.spec\./.test(p)) return -10
  if (/\.md$/.test(p) && !retrievalPolicy.recallFirst) return -16
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

export function preparePromptBoundedBundles(bundle, repoData, opts = {}) {
  const responseReserveTokens = opts.responseReserveTokens || maxAnalysisTokens()
  const contextLimitTokens = opts.contextLimitTokens || analysisModelContextTokens()
  const safetyMarginTokens = opts.safetyMarginTokens || 2048
  const staticPromptOverhead = String(opts.staticPromptOverhead || '')
  const availableInputTokens = Math.max(4096, contextLimitTokens - responseReserveTokens - safetyMarginTokens)
  const retrievalPolicy = getRetrievalPolicy()
  const selectedByPath = new Map((bundle?.selection?.selected || []).map((row) => [row.path, row]))
  const scoredEvidence = [...(bundle?.evidence || [])]
    .map((ev, idx) => {
      const row = selectedByPath.get(ev.path)
      const reasonScore = selectionReasonPriority(row?.reason)
      const pathScore = evidencePathPriority(ev.path, retrievalPolicy)
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

  const chunks = []
  let cursor = 0

  while (cursor < scoredEvidence.length) {
    let kept = []
    let bestFit = null

    for (let i = cursor; i < scoredEvidence.length; i++) {
      kept = [...kept, scoredEvidence[i].ev]
      const promptBundle = buildPromptBundleWithEvidence(bundle, kept, 0)
      const userContent = renderPromptText(promptBundle)
      const estimatedTokens = estimatePromptTokensFromText(`${staticPromptOverhead}\n${userContent}`)

      if (estimatedTokens <= availableInputTokens) {
        bestFit = {
          bundle: promptBundle,
          userContent,
          estimatedPromptTokens: estimatedTokens,
          availableInputTokens,
          evidencePaths: promptBundle.evidence.map((ev) => ev.path),
        }
        continue
      }
      break
    }

    if (!bestFit) {
      const caps =
        opts.ingestionCaps && typeof opts.ingestionCaps === 'object' ? opts.ingestionCaps : getIngestionCaps()
      throw new Error(
        `Prompt budget exceeded before model call. A single evidence excerpt exceeded the available input budget ${availableInputTokens} for model context ${contextLimitTokens}. Raise context allowance or reduce per-file evidence size. Current caps: files=${caps.maxFiles}, bytes/file=${caps.maxBytesPerFile}, totalEvidenceBytes=${caps.maxTotalBytes}.`
      )
    }

    chunks.push(bestFit)
    cursor += bestFit.bundle.evidence.length
  }

  return {
    chunks,
    availableInputTokens,
    chunked: chunks.length > 1,
  }
}

export function preparePromptBoundedBundle(bundle, repoData, opts = {}) {
  const planned = preparePromptBoundedBundles(bundle, repoData, opts)
  if (planned.chunks.length !== 1) {
    throw new Error('preparePromptBoundedBundle only supports single-chunk bundles. Use preparePromptBoundedBundles instead.')
  }
  return {
    ...planned.chunks[0],
    trimmedEvidenceCount: 0,
  }
}

function buildPassScopedCoverage() {
  return {
    maxFilesCapHit: false,
    maxBytesPerFileCapHit: false,
    maxTotalBytesCapHit: false,
    maxTreeSizeCapHit: false,
    notes: [],
  }
}

function buildExtractionPrompt(userContent, pass, chunkIndex, chunkCount, adversarialBlock = '') {
  return `${userContent}

Pass focus:
- Pass id: ${pass.id}
- Pass family: ${pass.family}
- Analyze only this domain-specific evidence cluster.
- Chunk: ${chunkIndex + 1} of ${chunkCount}

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
      "claimed_security_property": "string",
      "trust_assumption": "string",
      "bypass_or_uncertainty": "string",
      "adversarial_outcome": "finding|unverified_control|coverage_note|observed_control",
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
- If this pass includes any evidence excerpts or cited paths, emit at least one recommendation or quick_win claim with evidence_citations grounded in that evidence (concrete follow-up for this domain). Do not end with zero recommendation and zero quick_win when excerpts were reviewed unless the only emitted items are coverage_note entries explaining total irrelevance.
- Use observation for scoped non-defect notes.
- Do NOT emit finding for UI/component prop validation unless citations show trust boundary, auth decision, sensitive data flow, or attacker-controlled input path.
- Do NOT emit finding for generic validation hardening that lacks named missing rule/control.
- Do NOT emit finding for rate-limit concerns when cited code already shows limiter usage and no bypass/threshold weakness is evidenced.
- Do NOT emit High/Critical for CI/CD or config-only concerns unless citations prove secret exposure, deployment compromise path, bypass, or unauthorized access path.
- Do NOT emit finding for Firestore/rules concerns unless a specific rule path, role predicate, and unauthorized read/write path are identified.
- For High/Critical finding candidates include explicit attacker entry point, missing check, and security impact in the claim fields.
- When excerpts include API route handlers, server-side scan/job orchestration, rate-limiter implementation, or browser UI that persists credentials or tokens, do not end with an empty claim list unless you emit at least one scoped coverage_note or unverified_control tied to those paths explaining the residual uncertainty.
${adversarialBlock ? `\n\n${adversarialBlock}` : ''}`
}

async function runStructuredPassExtraction(
  client,
  pass,
  passBundle,
  repoData,
  analysisModelId,
  supplementBlock = '',
  promptOpts = {}
) {
  const adversarialBlock = buildAdversarialReasoningBlock(pass.family, pass.evidencePaths || [])
  const staticOverhead = `${ANALYSIS_SYSTEM_PROMPT}\n${buildExtractionPrompt('', pass, 998, 999, adversarialBlock)}${
    supplementBlock ? `\n${String(supplementBlock)}` : ''
  }`
  const promptPlan = preparePromptBoundedBundles(passBundle, repoData, {
    staticPromptOverhead: staticOverhead,
    ...promptOpts,
  })
  const parsedClaims = []
  const chunkUsages = []
  const chunkEstimatedTokens = []
  const chunkAvailableTokens = []
  let chunkParseError = false
  for (let chunkIndex = 0; chunkIndex < promptPlan.chunks.length; chunkIndex++) {
    const promptPrep = promptPlan.chunks[chunkIndex]
    const extractionPrompt = buildExtractionPrompt(
      promptPrep.userContent,
      pass,
      chunkIndex,
      promptPlan.chunks.length,
      adversarialBlock
    )
    const extractionCompletion = await client.chat.completions.create({
      model: analysisModelId,
      messages: [
        {
          role: 'system',
          content: ANALYSIS_SYSTEM_PROMPT,
        },
        { role: 'user', content: extractionPrompt },
      ],
      max_tokens: maxAnalysisTokens(),
      temperature: 0.1,
    })
    const extractionContent = extractionCompletion.choices[0]?.message?.content || ''
    const parsedChunk = parseCandidatePayload(extractionContent)
    parsedClaims.push(...(parsedChunk.claims || []))
    chunkParseError = chunkParseError || Boolean(parsedChunk.parseError)
    chunkUsages.push(extractionCompletion.usage || null)
    chunkEstimatedTokens.push(promptPrep.estimatedPromptTokens)
    chunkAvailableTokens.push(promptPrep.availableInputTokens)
  }
  return {
    parsed: {
      claims: parsedClaims,
      parseError: chunkParseError ? 'partial' : null,
    },
    usage: sumUsage(...chunkUsages),
    promptBudgetTrimmedEvidenceCount: 0,
    promptChunkCount: promptPlan.chunks.length,
    promptBudgetEstimatedTokens: Math.max(0, ...chunkEstimatedTokens),
    promptBudgetAvailableInputTokens: Math.max(0, ...chunkAvailableTokens),
  }
}

function normalizeUsageFragment(usage) {
  if (!usage) return null
  return {
    prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
  }
}

function estimateUsageCostUsd(totalUsage, modelId) {
  return estimateOpenAIUsageCostUsd(totalUsage, modelId)
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
- Inventory (paths seen): ${inv.totalFilesSeen}; tier-eligible counts - tier1 ${inv.filesEligibleByTier.tier1}, tier2 ${inv.filesEligibleByTier.tier2}, tier3 ${inv.filesEligibleByTier.tier3}
- Paths selected by strategy (${inv.filesSelected}); paths omitted (${inv.filesOmitted}) - categories summarized only.
- Line-addressable evidence excerpts included below (${bundle.evidence.length}).
- Caps & honesty: ${capNotes || 'within configured limits'}${cov.notes?.length ? ` - ${cov.notes.join(' | ')}` : ''}
- Do not claim full-file or full-repository review unless clearly supported; state limitations in Confidence & Coverage.`
}

function inferRepositoryProfile(repoData, bundle) {
  if (repoData?.repoProfile && Array.isArray(repoData.repoProfile.profiles)) {
    let rp = repoData.repoProfile
    if (!String(rp.applicationPurpose || '').trim()) {
      rp = enrichRepoProfileFromDocumentationArtifacts(rp, repoData.files || [], repoData.description || '')
    }
    return rp
  }
  const paths = [
    ...((bundle?.selection?.selected || []).map((row) => String(row.path || '').toLowerCase()) || []),
    ...((bundle?.selection?.omitted || []).map((row) => String(row.path || '').toLowerCase()) || []),
  ]
  const base = inferRepoProfileFromPaths(paths, repoData?.language || '')
  return enrichRepoProfileFromDocumentationArtifacts(base, repoData.files || [], repoData.description || '')
}

/**
 * Runs repository security analysis with output contract v2 validation.
 * @returns {Promise<{ report: string, reportContractVersion: string, reportValidation: { ok: boolean, repairedAfterCritic: boolean }, correlationId: string, tokenUsage: { draft: object|null, critic: object|null, total: { prompt_tokens: number, completion_tokens: number, total_tokens: number } } }>}
 */
export async function analyzeSecurity(repoData, options = {}) {
  const correlationId = randomUUID()
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const selectedAnalysisModel = analysisModel(options?.analysisModel)

  if (!repoData?.files || !Array.isArray(repoData.files)) {
    throw new Error('Invalid repository data: files array is missing or invalid')
  }

  const caps = getIngestionCaps()
  const bundle =
    repoData.evidenceBundle && typeof repoData.evidenceBundle === 'object'
      ? repoData.evidenceBundle
      : stubEvidenceBundleFromLegacyRepoData(repoData, caps)

  const client = getOpenAIClient()
  const repository = buildRepositoryDisplay(repoData.url, repoData)
  const dimensionRuntime = createInitialDimensionRunState()
  const repoProfile = inferRepositoryProfile(repoData, bundle)

  const selectedPassFamilies = resolvePlannedPassFamilies(options)
  const plan = buildMultiPassPlan(bundle, { includePassFamilies: selectedPassFamilies })
  if (!plan.analysisPassCount) {
    throw new Error('Stage A mapping produced zero analysis passes')
  }

  const dimensionResults = new Map(
    DIMENSION_CATALOG.map((dimension) => [
      dimension.id,
      createEmptyDimensionResult(dimension.id, { applicability: { ...SCAN_PENDING_APPLICABILITY } }),
    ])
  )
  const scanStartedAt = new Date().toISOString()
  // Resolve no-evidence dimensions up front so dashboard progress matches pass order: otherwise
  // later catalog rows can show live % while earlier rows stay "queued 0%" until the post-pass sweep.
  for (const dimension of DIMENSION_CATALOG) {
    if (plan.clusterSkipReasons?.[dimension.passFamily] !== 'no_relevant_evidence') continue
    dimensionResults.set(
      dimension.id,
      assembleSkippedDimensionResult(dimension.id, 'no_relevant_evidence', repoProfile)
    )
    dimensionRuntime[dimension.id] = {
      startedAt: dimensionRuntime[dimension.id]?.startedAt || scanStartedAt,
      completedAt: new Date().toISOString(),
      lastError: null,
    }
  }
  const baseDashboardTelemetry = {
    ingestion: repoData.ingestion || null,
    analysisModel: selectedAnalysisModel,
    correlationId,
    selectedPassFamilies,
  }
  const emitDashboard = ({ runState = 'running', completedAt = null, report = null, reportValidation = null, telemetry = null } = {}) => {
    if (!onProgress) return null
    const payload = createDashboardPayload({
      repository,
      dimensions: [...dimensionResults.values()],
      repoProfile,
      startedAt: scanStartedAt,
      updatedAt: new Date().toISOString(),
      completedAt,
      runState,
      report,
      reportValidation,
      telemetry: telemetry || baseDashboardTelemetry,
      dimensionRuntime,
    })
    onProgress(payload)
    return payload
  }

  emitDashboard({ runState: 'running' })

  const passRuns = []
  for (const pass of plan.passes) {
    const dimensionId = dimensionIdForPassFamily(pass.family)
    if (dimensionId) {
      dimensionRuntime[dimensionId] = {
        startedAt: dimensionRuntime[dimensionId]?.startedAt || new Date().toISOString(),
        completedAt: null,
        lastError: null,
      }
      dimensionResults.set(
        dimensionId,
        createEmptyDimensionResult(dimensionId, {
          progress: 'reviewing',
          applicability: { ...SCAN_PENDING_APPLICABILITY },
          summary: {
            whatWasReviewed: `SecLens is reviewing ${dimensionResults.get(dimensionId)?.label.toLowerCase() || 'this dimension'} now.`,
            whatLooksStrong: 'No confirmed controls recorded yet.',
            whatRemainsUnclear: 'This dimension is in active analysis and launch action will be provided after pass completion.',
            whatToCheckNext: 'Wait for analysis to finish.',
          },
        })
      )
      emitDashboard({ runState: 'running' })
    }

    try {
      const passBundle = { ...bundle, evidence: pass.evidence }
      const extraction = await runStructuredPassExtraction(
        client,
        pass,
        passBundle,
        repoData,
        selectedAnalysisModel,
        '',
        { ingestionCaps: caps }
      )
      const parsed = extraction.parsed
      const passRun = {
        ok: true,
        passId: pass.id,
        family: pass.family,
        requiredHighRisk: pass.requiredHighRisk,
        parsed,
        usage: extraction.usage,
        promptBudgetTrimmedEvidenceCount: extraction.promptBudgetTrimmedEvidenceCount,
        promptChunkCount: extraction.promptChunkCount,
        promptBudgetEstimatedTokens: extraction.promptBudgetEstimatedTokens,
        promptBudgetAvailableInputTokens: extraction.promptBudgetAvailableInputTokens,
        examinedFiles: pass.evidencePaths,
        examinedEvidenceCount: pass.evidence.length,
      }
      passRuns.push(passRun)

      if (dimensionId) {
        const perPassAdmission = admitCandidates(parsed.claims || [], passBundle)
        dimensionRuntime[dimensionId] = {
          startedAt: dimensionRuntime[dimensionId]?.startedAt || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          lastError: null,
        }
        dimensionResults.set(
          dimensionId,
          assembleDimensionResult({
            dimensionId,
            admitted: perPassAdmission.admitted,
            reviewedPaths: pass.evidencePaths,
            reviewedEvidence: pass.evidence,
            promptTrimmedEvidenceCount: 0,
            runtime: {
              progress: parsed.parseError ? 'partial' : 'completed',
            },
            coverage: buildPassScopedCoverage(),
            repoProfile,
          })
        )
        emitDashboard({ runState: 'running' })
      }
    } catch (error) {
      const mappedError = mapOpenAIError(error).message
      passRuns.push({
        ok: false,
        passId: pass.id,
        family: pass.family,
        requiredHighRisk: pass.requiredHighRisk,
        error: mappedError,
        examinedFiles: pass.evidencePaths,
        examinedEvidenceCount: pass.evidence.length,
      })
      if (dimensionId) {
        dimensionRuntime[dimensionId] = {
          startedAt: dimensionRuntime[dimensionId]?.startedAt || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          lastError: mappedError,
        }
        dimensionResults.set(
          dimensionId,
          assembleDimensionResult({
            dimensionId,
            admitted: {
              findings: [],
              observedControls: [],
              unverifiedControls: [],
              recommendations: [],
              quickWins: [],
            },
            reviewedPaths: pass.evidencePaths,
            reviewedEvidence: pass.evidence,
            runtime: {
              progress: 'failed',
            },
            coverage: buildPassScopedCoverage(0),
            repoProfile,
          })
        )
        emitDashboard({ runState: 'running' })
      }
    }
  }

  const diligenceCorrectiveTelemetry = {
    enabled: process.env.SECLENS_CORRECTIVE_PASS !== 'false',
    attemptedFamilies: [],
    appliedFamilies: [],
    errors: [],
  }
  if (diligenceCorrectiveTelemetry.enabled) {
    const correctiveTargets = planDiligenceCorrectivePasses(plan, passRuns, dimensionResults)
    for (const t of correctiveTargets) {
      const pass = plan.passes.find((p) => p.id === t.passId)
      if (!pass) continue
      const dimensionId = dimensionIdForPassFamily(pass.family)
      if (!dimensionId) continue
      diligenceCorrectiveTelemetry.attemptedFamilies.push(pass.family)
      try {
        const passBundle = { ...bundle, evidence: pass.evidence }
        const supplement = buildDiligenceCorrectiveSupplement(t.highSignalPaths, pass.family)
        const correctiveOut = await runStructuredPassExtraction(
          client,
          pass,
          passBundle,
          repoData,
          selectedAnalysisModel,
          supplement,
          { ingestionCaps: caps }
        )
        const prior = passRuns.find((p) => p.ok && p.passId === pass.id)
        if (!prior) continue
        const mergedClaims = dedupeClaimsByCandidateId([
          ...(prior.parsed?.claims || []),
          ...(correctiveOut.parsed?.claims || []),
        ])
        const mergedParsed = {
          claims: mergedClaims,
          parseError: prior.parsed?.parseError || correctiveOut.parsed?.parseError || null,
        }
        prior.parsed = mergedParsed
        prior.usage = sumUsage(prior.usage || null, correctiveOut.usage)
        prior.promptChunkCount = (prior.promptChunkCount || 0) + (correctiveOut.promptChunkCount || 0)
        prior.promptBudgetEstimatedTokens = Math.max(
          prior.promptBudgetEstimatedTokens || 0,
          correctiveOut.promptBudgetEstimatedTokens || 0
        )
        prior.promptBudgetAvailableInputTokens = Math.max(
          prior.promptBudgetAvailableInputTokens || 0,
          correctiveOut.promptBudgetAvailableInputTokens || 0
        )

        const perPassAdmission = admitCandidates(mergedClaims, passBundle)
        dimensionRuntime[dimensionId] = {
          startedAt: dimensionRuntime[dimensionId]?.startedAt || scanStartedAt,
          completedAt: new Date().toISOString(),
          lastError: null,
        }
        dimensionResults.set(
          dimensionId,
          assembleDimensionResult({
            dimensionId,
            admitted: perPassAdmission.admitted,
            reviewedPaths: pass.evidencePaths,
            reviewedEvidence: pass.evidence,
            promptTrimmedEvidenceCount: 0,
            runtime: {
              progress: mergedParsed.parseError ? 'partial' : 'completed',
            },
            coverage: buildPassScopedCoverage(),
            repoProfile,
          })
        )
        diligenceCorrectiveTelemetry.appliedFamilies.push(pass.family)
        emitDashboard({ runState: 'running' })
      } catch (err) {
        diligenceCorrectiveTelemetry.errors.push({
          family: pass.family,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

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
  for (const dimension of DIMENSION_CATALOG) {
    if (dimensionResults.has(dimension.id) && dimensionResults.get(dimension.id).progress !== 'queued') {
      continue
    }
    const skipReason = plan.clusterSkipReasons[dimension.passFamily] || 'no_relevant_evidence'
    dimensionResults.set(dimension.id, assembleSkippedDimensionResult(dimension.id, skipReason, repoProfile))
    if (!dimensionRuntime[dimension.id]?.completedAt) {
      dimensionRuntime[dimension.id] = {
        startedAt: dimensionRuntime[dimension.id]?.startedAt || scanStartedAt,
        completedAt: new Date().toISOString(),
        lastError: null,
      }
    }
  }

  emitDashboard({ runState: 'synthesizing' })

  const preReportDashboard = createDashboardPayload({
    repository,
    dimensions: [...dimensionResults.values()],
    repoProfile,
    startedAt: scanStartedAt,
    updatedAt: new Date().toISOString(),
    runState: 'synthesizing',
    telemetry: baseDashboardTelemetry,
    dimensionRuntime,
  })
  const report = renderConsolidatedReport({
    repository: {
      ...repository,
      language: repoData.language,
    },
    dashboard: preReportDashboard,
  })

  const draftUsage = sumUsage(...successfulPasses.map((p) => p.usage))
  const criticUsages = []
  const repairedAfterCritic = false
  const originalDraft = report
  const validation = validateReport(report)
  const completedDashboard = createDashboardPayload({
    repository: {
      ...repository,
      language: repoData.language,
    },
    dimensions: [...dimensionResults.values()],
    repoProfile,
    startedAt: scanStartedAt,
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    runState: 'completed',
    report,
    telemetry: baseDashboardTelemetry,
    dimensionRuntime,
  })
  const structuredTelemetry = {
    analysisModel: selectedAnalysisModel,
    analysisPassCount: plan.analysisPassCount,
    selectedPassFamilies,
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
    dimensionCount: completedDashboard.dimensions.length,
    dimensionStatusCounts: completedDashboard.summary.totals.statusDistribution,
    dimensionProgressCounts: completedDashboard.summary.totals.progressDistribution,
    dimensionReviewedCount: completedDashboard.summary.totals.dimensionsReviewed,
    dimensionFindingCount: completedDashboard.summary.totals.findingsAdmitted,
    observedControlCount: completedDashboard.summary.totals.observedControls,
    unverifiedControlCount: completedDashboard.summary.totals.unverifiedControls,
    recommendationQueueCount: completedDashboard.recommendationQueue.length,
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
    candidateCounts: {
      total: parsed.claims.length,
      finding: parsed.claims.filter((claim) => claim.kind === 'finding').length,
      observation: parsed.claims.filter((claim) => claim.kind === 'observation').length,
      observed_control: parsed.claims.filter((claim) => claim.kind === 'observed_control').length,
      unverified_control: parsed.claims.filter((claim) => claim.kind === 'unverified_control').length,
      recommendation: parsed.claims.filter((claim) => claim.kind === 'recommendation').length,
      quick_win: parsed.claims.filter((claim) => claim.kind === 'quick_win').length,
      coverage_note: parsed.claims.filter((claim) => claim.kind === 'coverage_note').length,
    },
    admittedCounts: summarizeAdmittedCounts(admissionResult.admitted),
    rejectionReasonCounts: admissionResult.rejections.reduce((acc, rejection) => {
      acc[rejection.reason] = (acc[rejection.reason] || 0) + 1
      return acc
    }, {}),
    clusterInventory: plan.clusterInventory,
    clusterSkipReasons: plan.clusterSkipReasons,
    passFailureCount: failedPasses.length,
    passFailureReasons: failedPasses.map((p) => ({ passId: p.passId, family: p.family, error: p.error })),
    passFailurePolicyTriggered: failDecision.reason,
    diligenceCorrective: diligenceCorrectiveTelemetry,
  }
  const coverageObservations = []
  const bundleCoverage = bundle?.coverage || {}
  if (bundleCoverage.maxFilesCapHit) coverageObservations.push('MAX_FILES_FETCHED')
  if (bundleCoverage.maxBytesPerFileCapHit) coverageObservations.push('MAX_BYTES_PER_FILE')
  if (bundleCoverage.maxTotalBytesCapHit) coverageObservations.push('MAX_TOTAL_BYTES_TO_MODEL')
  if (bundleCoverage.maxTreeSizeCapHit) coverageObservations.push('MAX_REPO_TREE_ENTRIES')
  const initialValidationCategories = [
    ...(parsed.parseError ? ['STRUCTURED_PARSE_ERROR'] : []),
    ...(admissionResult.rejections.length > 0 ? ['STRUCTURED_ADMISSION_REJECTIONS'] : []),
  ]
  const finalValidationCategories = validation.ok ? [] : [...validation.categories]

  if (!validation.ok) {
    const validationCats = validation.ok
      ? []
      : validation.categories.length
        ? validation.categories
        : ['UNKNOWN']
    const cats = [...new Set([...validationCats])]
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
        estimatedCostUsd: estimateUsageCostUsd(totalUsage, selectedAnalysisModel),
      },
      structuredTelemetry,
      coverageObservations,
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

  const advisoryOutput = buildAdvisoryOutput({
    repoData,
    dashboard: { ...completedDashboard, telemetry: baseDashboardTelemetry },
  })
  const advisoryValidation = validateAdvisoryOutputContract(advisoryOutput)
  if (!advisoryValidation.ok) {
    const detail =
      advisoryValidation.errors?.length > 0 ? `: ${advisoryValidation.errors.join('; ')}` : ''
    throw new ReportQualityGateError(`Advisory contract validation failed${detail}`, {
      correlationId,
      categories: ['ADVISORY_CONTRACT_INVALID'],
      validationErrors: advisoryValidation.errors,
    })
  }

  emitDashboard({
    runState: 'completed',
    completedAt: completedDashboard.completedAt,
    report,
    reportValidation: {
      ok: true,
      repairedAfterCritic,
      structuredTelemetry,
      initialValidationCategories,
      finalValidationCategories,
      normalizersApplied: ['dimension_synthesis_only'],
    },
    advisoryValidation: {
      ok: true,
      contractVersion: ADVISORY_CONTRACT_VERSION,
    },
    telemetry: {
      ...baseDashboardTelemetry,
      structured: structuredTelemetry,
    },
  })

  return {
    analysisModel: selectedAnalysisModel,
    report,
    reportContractVersion: OUTPUT_CONTRACT_VERSION,
    reportValidation: {
      ok: true,
      repairedAfterCritic,
      structuredTelemetry,
      coverageObservations,
      initialValidationCategories,
      finalValidationCategories,
      normalizersApplied: ['dimension_synthesis_only'],
    },
    advisoryContractVersion: ADVISORY_CONTRACT_VERSION,
    advisoryValidation: {
      ok: true,
      contractVersion: ADVISORY_CONTRACT_VERSION,
    },
    advisoryOutput,
    correlationId,
    dashboard: {
      ...completedDashboard,
      reportValidation: {
        ok: true,
        repairedAfterCritic,
        structuredTelemetry,
        initialValidationCategories,
        finalValidationCategories,
        normalizersApplied: ['dimension_synthesis_only'],
      },
      advisoryValidation: {
        ok: true,
        contractVersion: ADVISORY_CONTRACT_VERSION,
      },
      telemetry: {
        ...baseDashboardTelemetry,
        structured: structuredTelemetry,
      },
    },
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
