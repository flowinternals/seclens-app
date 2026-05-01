/**
 * Scan response telemetry (CR-2.1) — shared by /api/analyze and SCAN-TELEMETRY-LOG append.
 */

import { getIngestionCaps } from './ingestionCaps.js'
import { estimateOpenAIUsageCostUsd, resolveOpenAIModel } from '../shared/openaiModels.js'

/** OpenAI usage → safe telemetry fragment (no extra provider fields). */
export function normalizeUsageFragment(usage) {
  if (!usage) return null
  return {
    prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completion_tokens:
      typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
  }
}

export function estimateUsageCostUsd(totalUsage, modelId) {
  return estimateOpenAIUsageCostUsd(totalUsage, modelId)
}

/**
 * Stable telemetry for scan jobs on both success and failure paths (DEFECT-004).
 * @param {{ outcome: 'completed'|'failed', errorMessage?: string|null, dashboard?: object|null, correlationId?: string|null }} params
 */
export function buildScanJobLifecycleTelemetry(params = {}) {
  const caps = getIngestionCaps()
  const dashboard = params.dashboard || null
  const totals = dashboard?.summary?.totals || null
  const selectedModel = resolveOpenAIModel(params.analysisModel ?? dashboard?.telemetry?.analysisModel).id
  const requestedModel = params.requestedAnalysisModel
    ? String(params.requestedAnalysisModel)
    : null
  return {
    schemaVersion: 1,
    outcome: params.outcome,
    correlationId: params.correlationId ?? null,
    errorMessage: params.errorMessage ? String(params.errorMessage).slice(0, 4000) : null,
    recordedAt: new Date().toISOString(),
    caps: {
      maxFiles: caps.maxFiles,
      maxBytesPerFile: caps.maxBytesPerFile,
      maxTotalBytes: caps.maxTotalBytes,
      maxTreeEntries: caps.maxTreeEntries,
    },
    analysisModel: selectedModel,
    requestedAnalysisModel: requestedModel,
    runState: dashboard?.runState ?? null,
    consolidatedReportAvailable: dashboard?.consolidatedReportAvailable ?? null,
    reportReadinessReasons: Array.isArray(dashboard?.reportReadinessReasons)
      ? dashboard.reportReadinessReasons
      : null,
    dashboardTotals: totals
      ? {
          dimensionsReviewed: totals.dimensionsReviewed,
          totalDimensions: totals.totalDimensions,
          findingsAdmitted: totals.findingsAdmitted,
          progressDistribution: totals.progressDistribution,
          statusDistribution: totals.statusDistribution,
        }
      : null,
    ingestion: dashboard?.telemetry?.ingestion ?? null,
  }
}

export function deriveScanProfileName(caps) {
  const k = `${caps.maxFiles}/${caps.maxBytesPerFile}/${caps.maxTotalBytes}/${caps.maxTreeEntries}`
  const knownProfiles = {
    '40/4000/60000/5000': 'stage02-baseline-40/4k/60k',
    '120/8000/300000/50000': 'stage02-default-120/8k/300k',
    '200/12000/420000/100000': 'stage02-experimental-200/12k/420k',
    '250/12000/500000/150000': 'stage02-burn-250/12k/500k',
    '320/20000/900000/150000': 'stage02-expanded-320/20k/900k',
  }
  return knownProfiles[k] || 'custom'
}

/**
 * @param {object} [analysisResult]
 * @param {object} repoData
 * @param {number} startedAtMs
 */
export function buildTelemetry(analysisResult = {}, repoData, startedAtMs) {
  const draft =
    normalizeUsageFragment(analysisResult.tokenUsage?.draft) ||
    ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
  const critic = normalizeUsageFragment(analysisResult.tokenUsage?.critic)
  const rawTotal = analysisResult.tokenUsage?.total || {}
  const total = {
    prompt_tokens: typeof rawTotal.prompt_tokens === 'number' ? rawTotal.prompt_tokens : 0,
    completion_tokens:
      typeof rawTotal.completion_tokens === 'number' ? rawTotal.completion_tokens : 0,
    total_tokens: typeof rawTotal.total_tokens === 'number' ? rawTotal.total_tokens : 0,
  }
  const selectedModel = resolveOpenAIModel(
    analysisResult.analysisModel ?? analysisResult.dashboard?.telemetry?.analysisModel
  ).id
  const requestedModel = analysisResult.requestedAnalysisModel
    ? String(analysisResult.requestedAnalysisModel)
    : null
  const caps = getIngestionCaps()
  const elapsedMs = Math.max(0, Date.now() - startedAtMs)
  const coverage = repoData?.evidenceBundle?.coverage || null
  const inventory = repoData?.evidenceBundle?.inventory || null
  const selectedEvidenceCount =
    typeof repoData?.ingestion?.selectedFileCount === 'number'
      ? repoData.ingestion.selectedFileCount
      : Array.isArray(repoData?.evidenceBundle?.evidence)
        ? repoData.evidenceBundle.evidence.length
        : null
  const totalEvidenceBytes = Array.isArray(repoData?.evidenceBundle?.evidence)
    ? repoData.evidenceBundle.evidence.reduce((acc, ev) => {
        const text = ev?.snippets?.[0]?.text || ''
        return acc + Buffer.byteLength(text, 'utf8')
      }, 0)
    : null

  return {
    correlationId: analysisResult.correlationId ?? null,
    profile: deriveScanProfileName(caps),
    caps: {
      maxFiles: caps.maxFiles,
      maxBytesPerFile: caps.maxBytesPerFile,
      maxTotalEvidenceBytes: caps.maxTotalBytes,
      maxTreeEntries: caps.maxTreeEntries,
    },
    duration: {
      elapsedMs,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
    },
    analysisModel: selectedModel,
    requestedAnalysisModel: requestedModel,
    estimatedCostUsd: estimateUsageCostUsd(total, selectedModel),
    criticRepairRan: !!analysisResult.reportValidation?.repairedAfterCritic,
    ingestion: {
      strategyVersion: repoData?.ingestion?.strategyVersion ?? null,
      selectedFileCount: repoData?.ingestion?.selectedFileCount ?? null,
      omittedFileCount: repoData?.ingestion?.omittedFileCount ?? null,
      capHits: Array.isArray(repoData?.ingestion?.capHits) ? repoData.ingestion.capHits : [],
      coverageSummary: repoData?.ingestion?.coverageSummary ?? null,
      selectedReasonCounts: repoData?.ingestion?.selectedReasonCounts ?? null,
      anchorCount: repoData?.ingestion?.anchorCount ?? null,
      relatedContextCount: repoData?.ingestion?.relatedContextCount ?? null,
      backfillCount: repoData?.ingestion?.backfillCount ?? null,
      plannedSelectedReasonCounts: repoData?.ingestion?.plannedSelectedReasonCounts ?? null,
      plannedAnchorCount: repoData?.ingestion?.plannedAnchorCount ?? null,
      plannedRelatedContextCount: repoData?.ingestion?.plannedRelatedContextCount ?? null,
      plannedBackfillCount: repoData?.ingestion?.plannedBackfillCount ?? null,
      domainReservationCount: repoData?.ingestion?.domainReservationCount ?? null,
      domainReservationByDomain: repoData?.ingestion?.domainReservationByDomain ?? null,
      plannedDomainReservationCount: repoData?.ingestion?.plannedDomainReservationCount ?? null,
      plannedDomainReservationByDomain: repoData?.ingestion?.plannedDomainReservationByDomain ?? null,
      totalEvidenceBytes,
      coverage: coverage
        ? {
            maxFilesCapHit: !!coverage.maxFilesCapHit,
            maxBytesPerFileCapHit: !!coverage.maxBytesPerFileCapHit,
            maxTotalBytesCapHit: !!coverage.maxTotalBytesCapHit,
            maxTreeSizeCapHit: !!coverage.maxTreeSizeCapHit,
          }
        : null,
      inventory: inventory
        ? {
            totalFilesSeen: inventory.totalFilesSeen,
            filesSelected:
              typeof selectedEvidenceCount === 'number' ? selectedEvidenceCount : inventory.filesSelected,
            filesOmitted: inventory.filesOmitted,
          }
        : null,
    },
    tokenUsage: {
      draft,
      critic,
      total,
    },
    initialValidationCategories: analysisResult.reportValidation?.initialValidationCategories || [],
    finalValidationCategories: analysisResult.reportValidation?.finalValidationCategories || [],
    normalizersApplied: analysisResult.reportValidation?.normalizersApplied || [],
    candidateCounts: analysisResult.reportValidation?.structuredTelemetry?.candidateCounts || null,
    admittedCounts: analysisResult.reportValidation?.structuredTelemetry?.admittedCounts || null,
    rejectionReasonCounts: analysisResult.reportValidation?.structuredTelemetry?.rejectionReasonCounts || null,
    candidateCountByTopic: analysisResult.reportValidation?.structuredTelemetry?.candidateCountByTopic || null,
    rejectedCitationIntegrityCount:
      analysisResult.reportValidation?.structuredTelemetry?.rejectedCitationIntegrityCount || 0,
    templateVersion: analysisResult.reportValidation?.structuredTelemetry?.templateVersion || null,
    renderMode: analysisResult.reportValidation?.structuredTelemetry?.renderMode || null,
    markdownRenderMode: analysisResult.reportValidation?.structuredTelemetry?.markdownRenderMode || null,
    appendixEvidenceCount: analysisResult.reportValidation?.structuredTelemetry?.appendixEvidenceCount ?? null,
    appendixRenderedCount: analysisResult.reportValidation?.structuredTelemetry?.appendixRenderedCount ?? null,
    appendixTruncated: !!analysisResult.reportValidation?.structuredTelemetry?.appendixTruncated,
    representedDomainCount: analysisResult.reportValidation?.structuredTelemetry?.representedDomainCount ?? null,
    requiredInspectedSurfaceRows:
      analysisResult.reportValidation?.structuredTelemetry?.requiredInspectedSurfaceRows ?? null,
    inspectedSurfaceCounts:
      analysisResult.reportValidation?.structuredTelemetry?.inspectedSurfaceCounts ?? null,
    inspectedSurfaceCountByTopic:
      analysisResult.reportValidation?.structuredTelemetry?.inspectedSurfaceCountByTopic || null,
    inspectedSurfaceSpecificityRate:
      analysisResult.reportValidation?.structuredTelemetry?.inspectedSurfaceSpecificityRate ?? null,
    placeholderSectionCount:
      analysisResult.reportValidation?.structuredTelemetry?.placeholderSectionCount ?? null,
    genericRecommendationCount:
      analysisResult.reportValidation?.structuredTelemetry?.genericRecommendationCount ?? null,
    repoSpecificSectionCount:
      analysisResult.reportValidation?.structuredTelemetry?.repoSpecificSectionCount || null,
    reportValueScore: analysisResult.reportValidation?.structuredTelemetry?.reportValueScore ?? null,
    reportValueGatePassed:
      !!analysisResult.reportValidation?.structuredTelemetry?.reportValueGatePassed,
    recommendationTypeCounts:
      analysisResult.reportValidation?.structuredTelemetry?.recommendationTypeCounts || null,
    analysisPassCount: analysisResult.reportValidation?.structuredTelemetry?.analysisPassCount ?? null,
    analysisPasses: analysisResult.reportValidation?.structuredTelemetry?.analysisPasses || null,
    passTypeCounts: analysisResult.reportValidation?.structuredTelemetry?.passTypeCounts || null,
    passEvidenceCounts: analysisResult.reportValidation?.structuredTelemetry?.passEvidenceCounts || null,
    passTrimmedEvidenceCounts:
      analysisResult.reportValidation?.structuredTelemetry?.passTrimmedEvidenceCounts || null,
    passPromptEstimatedTokens:
      analysisResult.reportValidation?.structuredTelemetry?.passPromptEstimatedTokens || null,
    passPromptAvailableInputTokens:
      analysisResult.reportValidation?.structuredTelemetry?.passPromptAvailableInputTokens || null,
    candidateCountsByPass: analysisResult.reportValidation?.structuredTelemetry?.candidateCountsByPass || null,
    admittedCountsByPass: analysisResult.reportValidation?.structuredTelemetry?.admittedCountsByPass || null,
    observedControlCount: analysisResult.reportValidation?.structuredTelemetry?.observedControlCount ?? null,
    unverifiedControlCount:
      analysisResult.reportValidation?.structuredTelemetry?.unverifiedControlCount ?? null,
    reportSynthesisDedupedFindingCount:
      analysisResult.reportValidation?.structuredTelemetry?.reportSynthesisDedupedFindingCount ?? null,
    reportSynthesisDedupedRecommendationCount:
      analysisResult.reportValidation?.structuredTelemetry?.reportSynthesisDedupedRecommendationCount ?? null,
    clusterInventory: analysisResult.reportValidation?.structuredTelemetry?.clusterInventory || null,
    clusterSkipReasons: analysisResult.reportValidation?.structuredTelemetry?.clusterSkipReasons || null,
    sectionContentByTopicCounts:
      analysisResult.reportValidation?.structuredTelemetry?.sectionContentByTopicCounts || null,
    downscopedObservationCount:
      analysisResult.reportValidation?.structuredTelemetry?.downscopedObservationCount ?? null,
    lowInformationReport: !!analysisResult.reportValidation?.structuredTelemetry?.lowInformationReport,
    usedNoFindingsTemplate: !!analysisResult.reportValidation?.structuredTelemetry?.usedNoFindingsTemplate,
    diligenceCorrective: analysisResult.reportValidation?.structuredTelemetry?.diligenceCorrective ?? null,
  }
}
