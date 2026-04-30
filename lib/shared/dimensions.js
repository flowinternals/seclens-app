export const DIMENSION_RESULTS_SCHEMA_VERSION = 2

export const DIMENSION_STATUS = Object.freeze([
  'healthy',
  'attention',
  'review_needed',
  'unknown',
])

export const DIMENSION_PROGRESS = Object.freeze([
  'queued',
  'reviewing',
  'synthesizing',
  'ready',
  'partial',
  'failed',
])

export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low'])
export const DIMENSION_APPLICABILITY = Object.freeze([
  'applicable',
  'not_applicable',
  'still_working',
  'retry_needed',
])

export const DIMENSION_CATALOG = Object.freeze([
  {
    id: 'auth_session_authorization',
    label: 'Auth / Session / Authorization',
    shortLabel: 'Auth',
    icon: 'shield-lock',
    passFamily: 'auth_session_authorization',
    topics: ['auth', 'session'],
    order: 0,
  },
  {
    id: 'invite_token_claims',
    label: 'Invite / Token / Claims',
    shortLabel: 'Invite',
    icon: 'ticket',
    passFamily: 'invite_token_claims',
    topics: ['invite', 'claims'],
    order: 1,
  },
  {
    id: 'validation_input_trust_boundaries',
    label: 'Validation / Input / Trust Boundaries',
    shortLabel: 'Validation',
    icon: 'scan-search',
    passFamily: 'validation_input_trust_boundaries',
    topics: ['validation', 'headers'],
    order: 2,
  },
  {
    id: 'rate_limiting_abuse_controls',
    label: 'Rate Limiting / Abuse Controls',
    shortLabel: 'Rate Limit',
    icon: 'gauge',
    passFamily: 'rate_limiting_abuse_controls',
    topics: ['rate_limit'],
    order: 3,
  },
  {
    id: 'cicd_secrets_deployment',
    label: 'CI/CD / Secrets / Deployment',
    shortLabel: 'CI/CD',
    icon: 'workflow',
    passFamily: 'cicd_deployment_secret_handling',
    topics: ['cicd', 'dependency'],
    order: 4,
  },
  {
    id: 'config_policy_rules',
    label: 'Config / Policy / Rules',
    shortLabel: 'Config',
    icon: 'sliders',
    passFamily: 'config_policy_rules',
    topics: ['headers'],
    order: 5,
  },
  {
    id: 'data_access_persistence',
    label: 'Data Access / Persistence',
    shortLabel: 'Data',
    icon: 'database',
    passFamily: 'data_store_access_persistence_controls',
    topics: [],
    order: 6,
  },
  {
    id: 'client_auth_bridge_frontend_guarding',
    label: 'Client Auth Bridge / Frontend Guarding',
    shortLabel: 'Client Guard',
    icon: 'monitor-check',
    passFamily: 'client_auth_bridge_frontend_guarding',
    topics: [],
    order: 7,
  },
])

export const DIMENSION_IDS = new Set(DIMENSION_CATALOG.map((dimension) => dimension.id))

export function getDimensionDefinition(dimensionId) {
  return DIMENSION_CATALOG.find((dimension) => dimension.id === dimensionId) || null
}

export function getDimensionDefinitionByPassFamily(passFamily) {
  return DIMENSION_CATALOG.find((dimension) => dimension.passFamily === passFamily) || null
}

export function defaultCoverageSummary(label) {
  return `This review focused on the files SecLens selected for ${label.toLowerCase()}.`
}

export function createEmptyDimensionResult(dimensionId, overrides = {}) {
  const definition = getDimensionDefinition(dimensionId)
  if (!definition) {
    throw new Error(`Unknown dimension id: ${dimensionId}`)
  }

  return {
    dimensionId,
    label: definition.label,
    status: 'unknown',
    progress: 'queued',
    findings: [],
    observedControls: [],
    unverifiedControls: [],
    recommendations: [],
    coverage: {
      reviewedFiles: 0,
      omittedFilesRelevant: 0,
      capLimited: false,
      confidence: 'low',
      coverageSummary: defaultCoverageSummary(definition.label),
    },
    evidence: {
      topCitations: [],
      reviewedPaths: [],
    },
    applicability: {
      status: 'applicable',
      weight: 1,
      rationale: 'Dimension applicability defaults to applicable unless explicitly excluded.',
      required: true,
    },
    summary: {
      whatWasReviewed: 'Queued for analysis.',
      whatLooksStrong: 'No confirmed controls recorded yet.',
      whatRemainsUnclear: 'This dimension has not completed review.',
      whatToCheckNext: 'Wait for dimension review to complete.',
    },
    ...overrides,
  }
}

function uniqueBy(items, toKey) {
  const seen = new Set()
  const out = []
  for (const item of items || []) {
    const key = toKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function normalizePriorityText(value) {
  return String(value || '').toLowerCase()
}

function priorityRank(item) {
  const basis = normalizePriorityText(item?.priority || item?.severity || item?.confidence)
  if (basis.includes('critical') || basis.includes('p0') || basis.includes('high')) return 0
  if (basis.includes('medium') || basis.includes('p1')) return 1
  if (basis.includes('low') || basis.includes('p2')) return 2
  return 3
}

function pathFromCitation(citation) {
  return String(citation || '').split(':')[0].trim()
}

function collectFindingEvidencePaths(dimension) {
  const paths = new Set()
  for (const finding of dimension?.findings || []) {
    for (const citation of finding?.evidence_citations || []) {
      const path = pathFromCitation(citation)
      if (path) paths.add(path)
    }
  }
  return paths
}

export function summarizeDashboard(dimensions) {
  const list = [...(dimensions || [])].sort((a, b) => {
    const left = getDimensionDefinition(a.dimensionId)?.order ?? Number.MAX_SAFE_INTEGER
    const right = getDimensionDefinition(b.dimensionId)?.order ?? Number.MAX_SAFE_INTEGER
    return left - right
  })
  const reviewedPathSet = new Set()
  const issuePathSet = new Set()
  for (const dimension of list) {
    for (const path of dimension?.evidence?.reviewedPaths || []) {
      if (path) reviewedPathSet.add(path)
    }
    for (const path of collectFindingEvidencePaths(dimension)) {
      issuePathSet.add(path)
    }
  }

  const totals = list.reduce(
    (acc, dimension) => {
      acc.totalDimensions += 1
      if (dimension.progress === 'ready' || dimension.progress === 'partial') {
        acc.dimensionsReviewed += 1
      }
      acc.findingsAdmitted += dimension.findings.length
      acc.observedControls += dimension.observedControls.length
      acc.unverifiedControls += dimension.unverifiedControls.length
      acc.reviewedFiles += dimension.coverage.reviewedFiles || 0
      acc.omittedFilesRelevant += dimension.coverage.omittedFilesRelevant || 0
      acc.statusDistribution[dimension.status] = (acc.statusDistribution[dimension.status] || 0) + 1
      acc.progressDistribution[dimension.progress] =
        (acc.progressDistribution[dimension.progress] || 0) + 1
      if (dimension.coverage.capLimited) acc.capLimitedDimensions += 1
      if (dimension.coverage.confidence === 'high') acc.highConfidenceDimensions += 1
      if (dimension.coverage.confidence === 'medium') acc.mediumConfidenceDimensions += 1
      if (dimension.coverage.confidence === 'low') acc.lowConfidenceDimensions += 1
      return acc
    },
    {
      totalDimensions: 0,
      dimensionsReviewed: 0,
      findingsAdmitted: 0,
      observedControls: 0,
      unverifiedControls: 0,
      reviewedFiles: 0,
      omittedFilesRelevant: 0,
      capLimitedDimensions: 0,
      highConfidenceDimensions: 0,
      mediumConfidenceDimensions: 0,
      lowConfidenceDimensions: 0,
      statusDistribution: {
        healthy: 0,
        attention: 0,
        review_needed: 0,
        unknown: 0,
      },
      progressDistribution: {
        queued: 0,
        reviewing: 0,
        synthesizing: 0,
        ready: 0,
        partial: 0,
        failed: 0,
      },
    }
  )
  totals.totalFilesExamined = reviewedPathSet.size
  totals.filesExaminedWithIssue = issuePathSet.size
  totals.filesExaminedWithoutIssue = Math.max(0, reviewedPathSet.size - issuePathSet.size)

  const recommendationQueue = uniqueBy(
    list.flatMap((dimension) =>
      (dimension.recommendations || []).map((recommendation, index) => ({
        id:
          recommendation.id ||
          `${dimension.dimensionId}-recommendation-${index + 1}-${String(
            recommendation.title || recommendation.text || 'item'
          )
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')}`,
        dimensionId: dimension.dimensionId,
        dimensionLabel: dimension.label,
        priority: recommendation.priority || recommendation.severity || 'medium',
        text: recommendation.text || recommendation.claim || recommendation.title || 'Review this area',
        evidenceTarget:
          recommendation.evidenceTarget ||
          recommendation.evidence_citations?.[0] ||
          dimension.evidence.topCitations?.[0] ||
          dimension.evidence.reviewedPaths?.[0] ||
          'Scanned evidence',
        confidence: recommendation.confidence || dimension.coverage.confidence,
      }))
    ),
    (item) => `${item.dimensionId}:${item.text}:${item.evidenceTarget}`
  ).sort((left, right) => {
    const rankDelta = priorityRank(left) - priorityRank(right)
    if (rankDelta !== 0) return rankDelta
    return left.text.localeCompare(right.text)
  })

  const selectedDimension =
    list.find((dimension) => dimension.status === 'review_needed') ||
    list.find((dimension) => dimension.status === 'attention') ||
    list.find((dimension) => dimension.progress === 'reviewing') ||
    list[0] ||
    null

  const reportReadinessReasons = []
  if (totals.dimensionsReviewed < totals.totalDimensions) {
    reportReadinessReasons.push('Not all dimensions have completed review yet.')
  }
  if (totals.progressDistribution.failed > 0) {
    reportReadinessReasons.push('One or more dimensions failed and require a rerun before export.')
  }
  const unresolvedRequired = list.filter(
    (dimension) =>
      dimension?.applicability?.required !== false &&
      ['still_working', 'retry_needed'].includes(dimension?.applicability?.status)
  )
  if (unresolvedRequired.length > 0) {
    reportReadinessReasons.push(
      `Required dimensions are unresolved: ${unresolvedRequired
        .map((dimension) => dimension.label)
        .join(', ')}.`
    )
  }

  const overallStatus =
    totals.statusDistribution.review_needed > 0
      ? 'review_needed'
      : totals.statusDistribution.attention > 0
        ? 'attention'
        : totals.dimensionsReviewed === 0
          ? 'unknown'
          : totals.statusDistribution.healthy > 0
            ? 'healthy'
            : 'unknown'

  return {
    totals,
    overallStatus,
    recommendationQueue,
    selectedDimensionId: selectedDimension?.dimensionId || null,
    consolidatedReportAvailable: reportReadinessReasons.length === 0,
    reportReadinessReasons,
  }
}

export function createDashboardPayload({
  repository,
  dimensions,
  repoProfile = null,
  startedAt = new Date().toISOString(),
  completedAt = null,
  updatedAt = startedAt,
  runState = 'queued',
  report = null,
  reportValidation = null,
  telemetry = null,
  dimensionRuntime = {},
} = {}) {
  const safeDimensions = [...(dimensions || [])].sort((left, right) => {
    const leftOrder = getDimensionDefinition(left.dimensionId)?.order ?? Number.MAX_SAFE_INTEGER
    const rightOrder = getDimensionDefinition(right.dimensionId)?.order ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder
  })
  const summary = summarizeDashboard(safeDimensions)

  return {
    dimensionResultsSchemaVersion: DIMENSION_RESULTS_SCHEMA_VERSION,
    runState,
    startedAt,
    completedAt,
    updatedAt,
    repository,
    repoProfile,
    dimensions: safeDimensions,
    dimensionRuntime,
    summary,
    selectedDimensionId: summary.selectedDimensionId,
    recommendationQueue: summary.recommendationQueue,
    consolidatedReportAvailable: summary.consolidatedReportAvailable,
    reportReadinessReasons: summary.reportReadinessReasons,
    report,
    reportValidation,
    telemetry,
  }
}

export function validateDimensionResult(result) {
  if (!result || typeof result !== 'object') return false
  if (!DIMENSION_IDS.has(result.dimensionId)) return false
  if (!DIMENSION_STATUS.includes(result.status)) return false
  if (!DIMENSION_PROGRESS.includes(result.progress)) return false
  if (!CONFIDENCE_LEVELS.includes(result.coverage?.confidence)) return false
  if (!Array.isArray(result.findings)) return false
  if (!Array.isArray(result.observedControls)) return false
  if (!Array.isArray(result.unverifiedControls)) return false
  if (!Array.isArray(result.recommendations)) return false
  if (!Array.isArray(result.evidence?.topCitations)) return false
  if (!Array.isArray(result.evidence?.reviewedPaths)) return false
  if (!DIMENSION_APPLICABILITY.includes(result?.applicability?.status)) return false
  if (!Number.isFinite(result?.applicability?.weight)) return false
  if (typeof result?.applicability?.rationale !== 'string') return false
  return true
}

export function createMockDashboardPayload() {
  const dimensions = [
    createEmptyDimensionResult('auth_session_authorization', {
      status: 'attention',
      progress: 'ready',
      findings: [],
      observedControls: [
        {
          id: 'auth-oc-1',
          title: 'Protected route middleware is present',
          claim: 'Protected handlers appear to enforce session checks before state-changing actions.',
          confidence: 'high',
        },
      ],
      unverifiedControls: [
        {
          id: 'auth-uv-1',
          title: 'Cross-tenant ownership binding was not proven for all write paths',
          claim: 'Ownership binding was visible in some reviewed handlers, but not every related path was selected.',
          confidence: 'medium',
        },
      ],
      recommendations: [
        {
          id: 'auth-rec-1',
          priority: 'high',
          text: 'Confirm ownership checks on every state-changing account route.',
          evidenceTarget: 'app/api/account/update/route.ts:10-60',
          confidence: 'medium',
        },
      ],
      coverage: {
        reviewedFiles: 7,
        omittedFilesRelevant: 2,
        capLimited: false,
        confidence: 'medium',
        coverageSummary:
          'Reviewed auth handlers, middleware, and route guards. A few adjacent write paths were outside the selected scope.',
      },
      evidence: {
        topCitations: ['app/api/account/update/route.ts:10-60', 'lib/auth/session.ts:1-55'],
        reviewedPaths: ['app/api/account/update/route.ts', 'lib/auth/session.ts', 'src/components/AuthGuard.jsx'],
      },
      summary: {
        whatWasReviewed: 'Auth middleware, session helpers, and selected write handlers were reviewed.',
        whatLooksStrong: 'Session checks appear present on the main protected flow.',
        whatRemainsUnclear: 'Full ownership binding was not proven across every related write path.',
        whatToCheckNext: 'Verify tenant or owner predicates on adjacent update handlers.',
      },
    }),
    createEmptyDimensionResult('invite_token_claims', {
      status: 'healthy',
      progress: 'ready',
      findings: [],
      observedControls: [
        {
          id: 'invite-oc-1',
          title: 'Invite claim verification is visible',
          claim: 'Invite acceptance and claims plumbing appear scoped to explicit token checks in reviewed code.',
          confidence: 'high',
        },
      ],
      coverage: {
        reviewedFiles: 4,
        omittedFilesRelevant: 0,
        capLimited: false,
        confidence: 'high',
        coverageSummary: 'Invite handlers and claims helpers were directly reviewed.',
      },
      evidence: {
        topCitations: ['functions/src/validateInvite.ts:1-40'],
        reviewedPaths: ['functions/src/validateInvite.ts', 'functions/src/customClaims.ts'],
      },
      summary: {
        whatWasReviewed: 'Invite validation and claims wiring were reviewed.',
        whatLooksStrong: 'Reviewed token and claims handling looks deliberate and bounded.',
        whatRemainsUnclear: 'No major uncertainty remained in the selected files.',
        whatToCheckNext: 'Keep token expiry and single-use checks covered in future scans.',
      },
    }),
    createEmptyDimensionResult('validation_input_trust_boundaries', {
      status: 'review_needed',
      progress: 'ready',
      findings: [
        {
          id: 'validation-f-1',
          severity: 'Medium',
          title: 'Ownership binding is missing on a state-changing handler',
          claim: 'A reviewed update path accepts a target id without a visible ownership check.',
          evidence_citations: ['app/api/account/update/route.ts:10-60'],
          confidence: 'high',
        },
      ],
      recommendations: [
        {
          id: 'validation-rec-1',
          priority: 'high',
          text: 'Add explicit ownership binding before account updates are applied.',
          evidenceTarget: 'app/api/account/update/route.ts:10-60',
          confidence: 'high',
        },
      ],
      coverage: {
        reviewedFiles: 6,
        omittedFilesRelevant: 1,
        capLimited: false,
        confidence: 'high',
        coverageSummary: 'Reviewed request handlers, validation helpers, and schema-adjacent code for trust-boundary enforcement.',
      },
      evidence: {
        topCitations: ['app/api/account/update/route.ts:10-60', 'lib/validation/accountSchema.ts:1-44'],
        reviewedPaths: ['app/api/account/update/route.ts', 'lib/validation/accountSchema.ts'],
      },
      summary: {
        whatWasReviewed: 'Input handling and trust-boundary logic were reviewed around selected account update routes.',
        whatLooksStrong: 'Schema-driven validation is present on adjacent input parsing.',
        whatRemainsUnclear: 'One reviewed route did not show the expected ownership predicate.',
        whatToCheckNext: 'Fix the reviewed route, then compare neighboring write paths for the same pattern.',
      },
    }),
    createEmptyDimensionResult('rate_limiting_abuse_controls', {
      progress: 'reviewing',
      summary: {
        whatWasReviewed: 'SecLens is reviewing rate limiting helpers and abuse-control surfaces now.',
        whatLooksStrong: 'No confirmed controls recorded yet.',
        whatRemainsUnclear: 'This dimension is still gathering evidence.',
        whatToCheckNext: 'Wait for rate limiting analysis to finish.',
      },
    }),
    createEmptyDimensionResult('cicd_secrets_deployment', {
      status: 'attention',
      progress: 'partial',
      coverage: {
        reviewedFiles: 3,
        omittedFilesRelevant: 2,
        capLimited: true,
        confidence: 'low',
        coverageSummary: 'Reviewed selected workflow and deployment files, but prompt trimming limited adjacent infrastructure context.',
      },
      evidence: {
        topCitations: ['.github/workflows/ci.yml:1-20'],
        reviewedPaths: ['.github/workflows/ci.yml', 'vercel.json'],
      },
      summary: {
        whatWasReviewed: 'Selected workflow and deployment config files were reviewed.',
        whatLooksStrong: 'No admitted CI/CD finding is recorded from reviewed evidence.',
        whatRemainsUnclear: 'Coverage was limited by selected-file scope and prompt trimming.',
        whatToCheckNext: 'Review adjacent deployment and secret-management files in a follow-up scan.',
      },
    }),
    createEmptyDimensionResult('config_policy_rules', {
      status: 'healthy',
      progress: 'ready',
      observedControls: [
        {
          id: 'config-oc-1',
          title: 'Policy files are present in reviewed scope',
          claim: 'Policy and configuration files were present and readable in the selected evidence set.',
          confidence: 'medium',
        },
      ],
      coverage: {
        reviewedFiles: 3,
        omittedFilesRelevant: 0,
        capLimited: false,
        confidence: 'medium',
        coverageSummary: 'Reviewed policy and config files directly relevant to the selected scan scope.',
      },
      evidence: {
        topCitations: ['firestore.rules:1-40'],
        reviewedPaths: ['firestore.rules', 'firebase.json'],
      },
      summary: {
        whatWasReviewed: 'Selected config and policy files were reviewed.',
        whatLooksStrong: 'The scan located explicit rules and config surfaces rather than inferring them indirectly.',
        whatRemainsUnclear: 'A full policy audit would need more adjoining path coverage.',
        whatToCheckNext: 'Review policy predicates in the exported report if coverage limits matter.',
      },
    }),
    createEmptyDimensionResult('data_access_persistence', {
      status: 'unknown',
      progress: 'queued',
    }),
    createEmptyDimensionResult('client_auth_bridge_frontend_guarding', {
      status: 'unknown',
      progress: 'queued',
    }),
  ]

  return createDashboardPayload({
    repository: {
      url: 'https://github.com/flowinternals/example-app',
      owner: 'flowinternals',
      name: 'example-app',
      displayName: 'flowinternals/example-app',
      scannedRef: 'main',
    },
    dimensions,
    startedAt: '2026-04-30T01:00:00.000Z',
    updatedAt: '2026-04-30T01:02:10.000Z',
    runState: 'running',
    report: null,
  })
}
