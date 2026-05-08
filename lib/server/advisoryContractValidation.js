import {
  ADVISORY_ALLOWED_APPLICABILITY,
  ADVISORY_ALLOWED_STATUS,
  ADVISORY_CONTRACT_VERSION,
  ADVISORY_PROHIBITED_TERMS,
  advisoryStatusRequiresReasonCode,
  isAllowedAdvisoryApplicability,
  isAllowedAdvisoryStatus,
} from '../shared/advisoryContract.js'
import {
  buildAiIdePromptFromRecommendation,
  splitPromptsByValidity,
} from './aiPromptQuality.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function toAppStatus(runState) {
  const state = String(runState || '').toLowerCase()
  if (state === 'running' || state === 'synthesizing' || state === 'queued') return 'RUNNING'
  if (state === 'failed') return 'FAILED'
  return 'SUCCESS'
}

function toDimensionApplicability(value) {
  const raw = String(value || '').toLowerCase()
  if (raw === 'applicable' || raw === 'not_applicable') return raw
  // Repo-profile / runtime signals outside the strict enum still denote an in-scope dimension review.
  if (raw === 'retry_needed' || raw === 'still_working') return 'applicable'
  return null
}

/** Full successful dimension reviews must emit prompts/tests; partial/failed/skipped runs may legitimately omit them. */
function dimensionStatusRequiresApplicableArtifacts(status) {
  return String(status || '').toUpperCase() === 'SUCCESS'
}

function toDimensionStatus(dimension) {
  const progress = String(dimension?.progress || '').toLowerCase()
  const applicability = toDimensionApplicability(dimension?.applicability?.status)
  if (progress === 'failed') {
    return { status: 'FAILED', reasonCode: 'DIMENSION_ANALYSIS_FAILED' }
  }
  if (applicability === 'not_applicable') {
    return { status: 'SKIPPED', reasonCode: 'DIMENSION_NO_RELEVANT_FILES' }
  }
  if (progress === 'partial') {
    return { status: 'WARNING', reasonCode: 'FILE_OMITTED_BY_CAP' }
  }
  if (progress === 'reviewing' || progress === 'synthesizing' || progress === 'queued') {
    return { status: 'RUNNING', reasonCode: null }
  }
  return { status: 'SUCCESS', reasonCode: null }
}

function recommendationToSuggestedTest(recommendation, dimensionLabel, fallbackFile = '') {
  const text = String(recommendation?.text || recommendation?.title || '').trim()
  const evidenceTarget = String(recommendation?.evidenceTarget || '').trim()
  if (!text) return null
  const targetFiles = evidenceTarget ? [evidenceTarget.split(':')[0]] : [fallbackFile].filter(Boolean)
  return {
    title: recommendation?.title || `Suggested test for ${dimensionLabel || 'dimension'}`,
    testType: 'integration',
    targetFiles,
    testGoal: text,
    prompt: `Create a focused test that verifies whether this risk pattern exists: ${text}`,
  }
}

function containsProhibitedScannerLanguage(value) {
  if (!isNonEmptyString(value)) return false
  const lower = value.toLowerCase()
  return ADVISORY_PROHIBITED_TERMS.some((term) => lower.includes(term))
}

function scanForProhibitedLanguage(value, path = '', found = []) {
  if (typeof value === 'string') {
    if (containsProhibitedScannerLanguage(value)) found.push(path || '<root>')
    return found
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForProhibitedLanguage(entry, `${path}[${index}]`, found))
    return found
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      const nextPath = path ? `${path}.${key}` : key
      scanForProhibitedLanguage(entry, nextPath, found)
    })
  }
  return found
}

export function buildAdvisoryOutput({ repoData, dashboard }) {
  const criticalFilesSet = new Set()
  const repoProfile = dashboard?.repoProfile && typeof dashboard.repoProfile === 'object' ? dashboard.repoProfile : {}
  const dimensions = safeArray(dashboard?.dimensions).map((dimension) => {
    const reviewedFiles = safeArray(dimension?.evidence?.reviewedPaths).filter((p) => typeof p === 'string')
    reviewedFiles.forEach((path) => criticalFilesSet.add(path))
    const fallbackTargetFile = reviewedFiles[0] || ''
    const applicability = toDimensionApplicability(dimension?.applicability?.status) ?? 'applicable'
    const statusDetails = toDimensionStatus(dimension)
    let dimStatus = statusDetails.status
    let dimReason = statusDetails.reasonCode

    const recommendations = safeArray(dimension?.recommendations).map((item) => ({
      title: item?.title || 'Recommended improvement',
      recommendation: item?.text || item?.claim || item?.title || '',
      priority: item?.priority || 'medium',
      files: item?.evidenceTarget ? [String(item.evidenceTarget).split(':')[0]] : [],
      confidence: item?.confidence || 'medium',
    }))
    const rawPrompts = safeArray(dimension?.recommendations)
      .map((item) =>
        buildAiIdePromptFromRecommendation({
          recommendation: item,
          dimensionId: dimension?.dimensionId,
          dimensionLabel: dimension?.label || 'Dimension',
          reviewedPaths: reviewedFiles,
          repoProfile,
        })
      )
      .filter(Boolean)
    const promptGate = splitPromptsByValidity(rawPrompts, dimension?.dimensionId)
    let aiPrompts = promptGate.promptsForUser
    const suggestedTests = safeArray(dimension?.recommendations)
      .map((item) => recommendationToSuggestedTest(item, dimension?.label, fallbackTargetFile))
      .filter(Boolean)

    const hasUsableRecommendations = recommendations.some((r) => String(r?.recommendation || '').trim())
    const hasPrompts = aiPrompts.length > 0
    const hasTests = suggestedTests.length > 0

    if (applicability === 'applicable' && dimStatus === 'SUCCESS') {
      if (promptGate.total > 0 && promptGate.allInvalid) {
        dimStatus = 'FAILED'
        dimReason = 'AI_PROMPT_QUALITY_FAILED'
        aiPrompts = []
      } else if (promptGate.hasInvalid && promptGate.validCount > 0) {
        dimStatus = 'WARNING'
        dimReason = 'AI_PROMPT_QUALITY_WARNING'
      }
    }

    if (
      applicability === 'applicable' &&
      dimStatus === 'SUCCESS' &&
      (!hasUsableRecommendations || !hasPrompts || !hasTests)
    ) {
      dimStatus = 'WARNING'
      dimReason = 'ADVISORY_ARTIFACTS_INCOMPLETE'
    }

    return {
      dimensionId: dimension?.dimensionId || 'unknown_dimension',
      label: dimension?.label || 'Unknown dimension',
      status: dimStatus,
      applicability,
      reasonCode: dimReason,
      reviewedFiles,
      skippedFiles: [],
      observedBehaviours: [],
      potentialProblemAreas: [],
      recommendations,
      aiPrompts,
      suggestedTests,
      coverage: {
        filesReviewed: Number(dimension?.coverage?.reviewedFiles || 0),
        filesSkipped: Number(dimension?.coverage?.omittedFilesRelevant || 0),
        capLimited: Boolean(dimension?.coverage?.capLimited),
        coverageNotes: [String(dimension?.coverage?.coverageSummary || '').trim()].filter(Boolean),
      },
    }
  })

  const topLevelStatus = toAppStatus(dashboard?.runState)
  const summary = dashboard?.summary?.totals || {}
  const recommendationsCount = dimensions.reduce((acc, d) => acc + d.recommendations.length, 0)
  const promptsCount = dimensions.reduce((acc, d) => acc + d.aiPrompts.length, 0)
  const testsCount = dimensions.reduce((acc, d) => acc + d.suggestedTests.length, 0)
  const warningCount = dimensions.filter((d) => d.status === 'WARNING').length
  const failedCount = dimensions.filter((d) => d.status === 'FAILED').length

  return {
    contractVersion: ADVISORY_CONTRACT_VERSION,
    runId: dashboard?.telemetry?.runId || dashboard?.telemetry?.correlationId || 'unknown-run',
    status: topLevelStatus,
    reasonCode: topLevelStatus === 'SUCCESS' ? null : 'ADVISORY_IN_PROGRESS',
    repository: {
      url: repoData?.url || '',
      owner: repoData?.owner || '',
      name: repoData?.repo || '',
      branch: repoData?.scannedRef || repoData?.defaultBranch || '',
      commitSha: repoData?.scannedSha || '',
    },
    repoProfile: {
      primaryProfile: dashboard?.repoProfile?.primaryProfile || 'unknown',
      profiles: safeArray(dashboard?.repoProfile?.profiles),
      technologyStack: safeArray(dashboard?.repoProfile?.technologyStack),
      architectureSignals: safeArray(dashboard?.repoProfile?.architectureSignals),
      profileSummary: typeof dashboard?.repoProfile?.profileSummary === 'string' ? dashboard.repoProfile.profileSummary : '',
      applicationPurpose: typeof dashboard?.repoProfile?.applicationPurpose === 'string' ? dashboard.repoProfile.applicationPurpose : '',
      documentationPathsRead: safeArray(dashboard?.repoProfile?.documentationPathsRead),
      architectureConfidence:
        dashboard?.repoProfile?.architectureConfidence || dashboard?.repoProfile?.confidence || 'low',
      stackConfidence: dashboard?.repoProfile?.stackConfidence || 'low',
      confidence: dashboard?.repoProfile?.confidence || 'low',
    },
    criticalFiles: [...criticalFilesSet].map((path) => ({ path })),
    dimensions,
    summary: {
      overallStatus: topLevelStatus,
      dimensionsReviewed: Number(summary?.dimensionsReviewed || 0),
      recommendationsCount,
      promptsCount,
      testsCount,
      warningsCount: warningCount,
      errorsCount: failedCount,
    },
    warnings: [],
    errors: [],
    export: {
      markdownAvailable: true,
      textAvailable: true,
      pdfAvailable: true,
    },
  }
}

export function validateAdvisoryOutputContract(contract) {
  const errors = []
  if (!contract || typeof contract !== 'object') {
    return { ok: false, errors: ['contract must be an object'] }
  }

  if (contract.contractVersion !== ADVISORY_CONTRACT_VERSION) {
    errors.push(`contractVersion must be ${ADVISORY_CONTRACT_VERSION}`)
  }

  if (!isAllowedAdvisoryStatus(contract.status)) {
    errors.push(`status must be one of: ${ADVISORY_ALLOWED_STATUS.join(', ')}`)
  }
  if (advisoryStatusRequiresReasonCode(contract.status) && !isNonEmptyString(contract.reasonCode)) {
    errors.push('reasonCode is required for WARNING, FAILED, and SKIPPED statuses')
  }

  if (!Array.isArray(contract.dimensions) || contract.dimensions.length === 0) {
    errors.push('dimensions must be a non-empty array')
  } else {
    contract.dimensions.forEach((dimension, index) => {
      if (!isAllowedAdvisoryStatus(dimension?.status)) {
        errors.push(`dimensions[${index}].status must be one of: ${ADVISORY_ALLOWED_STATUS.join(', ')}`)
      }
      if (advisoryStatusRequiresReasonCode(dimension?.status) && !isNonEmptyString(dimension?.reasonCode)) {
        errors.push(`dimensions[${index}].reasonCode is required for WARNING, FAILED, and SKIPPED`)
      }
      if (!isAllowedAdvisoryApplicability(dimension?.applicability)) {
        errors.push(
          `dimensions[${index}].applicability must be one of: ${ADVISORY_ALLOWED_APPLICABILITY.join(', ')}`
        )
      }
      if (
        String(dimension?.applicability || '') === 'applicable' &&
        dimensionStatusRequiresApplicableArtifacts(dimension?.status)
      ) {
        if (!Array.isArray(dimension?.recommendations) || dimension.recommendations.length === 0) {
          errors.push(`dimensions[${index}] applicable dimensions must include recommendations`)
        }
        if (!Array.isArray(dimension?.aiPrompts) || dimension.aiPrompts.length === 0) {
          errors.push(`dimensions[${index}] applicable dimensions must include aiPrompts`)
        }
        if (!Array.isArray(dimension?.suggestedTests) || dimension.suggestedTests.length === 0) {
          errors.push(`dimensions[${index}] applicable dimensions must include suggestedTests`)
        }
      }
    })
  }

  const prohibitedLocations = scanForProhibitedLanguage(contract)
  if (prohibitedLocations.length > 0) {
    errors.push(
      `prohibited scanner-confirmation language found in contract fields: ${prohibitedLocations.join(', ')}`
    )
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}

