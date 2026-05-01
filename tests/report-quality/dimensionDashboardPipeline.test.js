import { describe, expect, it } from 'vitest'
import {
  createDashboardPayload,
  createEmptyDimensionResult,
  createMockDashboardPayload,
  summarizeDashboard,
  validateDimensionResult,
} from '../../lib/shared/dimensions.js'
import {
  assembleDimensionResult,
  assembleSkippedDimensionResult,
  renderConsolidatedReport,
} from '../../lib/server/dimensionAnalysis.js'
import { validateReport } from '../../lib/server/reportValidation.js'
import { sanitizeText } from '../../lib/server/sanitize.js'

describe('dimension dashboard pipeline', () => {
  it('exposes a canonical mock payload with valid dimension results', () => {
    const dashboard = createMockDashboardPayload()
    expect(dashboard.dimensionResultsSchemaVersion).toBe(2)
    expect(dashboard.dimensions).toHaveLength(8)
    expect(dashboard.dimensions.every((dimension) => validateDimensionResult(dimension))).toBe(true)
  })

  it('aggregates dashboard totals from canonical dimension results', () => {
    const dashboard = createDashboardPayload({
      repository: {
        owner: 'flowinternals',
        name: 'repo',
        url: 'https://github.com/flowinternals/repo',
      },
      dimensions: [
        createEmptyDimensionResult('auth_session_authorization', {
          status: 'healthy',
          progress: 'completed',
          observedControls: [{ id: 'oc-1', claim: 'Observed auth control' }],
          coverage: {
            reviewedFiles: 3,
            omittedFilesRelevant: 0,
            capLimited: false,
            confidence: 'high',
            coverageSummary: 'Reviewed auth surface.',
          },
          evidence: {
            topCitations: ['app/api/auth.ts:1-20'],
            reviewedPaths: ['app/api/auth.ts'],
          },
        }),
        createEmptyDimensionResult('validation_input_trust_boundaries', {
          status: 'review_needed',
          progress: 'completed',
          findings: [{ id: 'f-1', claim: 'Missing ownership binding' }],
          recommendations: [{ id: 'r-1', text: 'Add ownership checks', priority: 'high' }],
          coverage: {
            reviewedFiles: 2,
            omittedFilesRelevant: 1,
            capLimited: true,
            confidence: 'medium',
            coverageSummary: 'Coverage limited.',
          },
          evidence: {
            topCitations: ['app/api/update.ts:10-40'],
            reviewedPaths: ['app/api/update.ts'],
          },
        }),
      ],
    })

    expect(dashboard.summary.totals.findingsAdmitted).toBe(1)
    expect(dashboard.summary.totals.observedControls).toBe(1)
    expect(dashboard.summary.overallStatus).toBe('review_needed')
    expect(dashboard.recommendationQueue.length).toBeGreaterThanOrEqual(1)
    expect(dashboard.recommendationQueue.some((row) => /ownership checks/i.test(row.text))).toBe(true)
    expect(dashboard.recommendationQueue.some((row) => /Missing ownership binding/i.test(row.text))).toBe(true)
    expect(dashboard.consolidatedReportAvailable).toBe(true)
  })

  it('renders a consolidated report that validates under the new dimension structure', () => {
    const dashboard = createMockDashboardPayload()
    const report = renderConsolidatedReport({
      repository: dashboard.repository,
      dashboard,
    })

    const validation = validateReport(report)
    expect(validation.ok).toBe(true)
    expect(report).toContain('## Executive Posture Summary')
    expect(report).toContain('## Evidence Appendix')
    expect(report).toContain('Auth / Session / Authorization')
  })

  it('creates a useful skipped dimension result for low-signal runs', () => {
    const result = assembleSkippedDimensionResult('data_access_persistence')
    expect(result.status).toBe('unknown')
    expect(result.progress).toBe('partial')
    expect(result.coverage.confidence).toBe('low')
    expect(result.summary.whatToCheckNext).toMatch(/review/i)
  })

  it('uses profile-driven not-applicable state for skipped low-fit dimensions', () => {
    const result = assembleSkippedDimensionResult(
      'client_auth_bridge_frontend_guarding',
      'no_relevant_evidence',
      {
        profiles: ['CI-only repo'],
        confidence: 'high',
        rationale: 'CI workflow surfaces only.',
      }
    )

    expect(result.applicability.status).toBe('not_applicable')
    expect(result.applicability.required).toBe(false)
    expect(result.applicability.rationale).toMatch(/CI-only repo/i)
    expect(result.status).toBe('healthy')
    expect(result.progress).toBe('completed')
    expect(result.summary.whatRemainsUnclear).toMatch(/no additional launch-signoff action/i)
    expect(result.summary.whatToCheckNext).not.toMatch(/rerun|review/i)
  })

  it('marks unverified and recommendation-only dimensions as attention instead of healthy', () => {
    const result = assembleDimensionResult({
      dimensionId: 'client_auth_bridge_frontend_guarding',
      admitted: {
        unverifiedControls: [{ id: 'uv-1', claim: 'Session binding could not be confirmed across route transitions.' }],
        recommendations: [{ id: 'r-1', text: 'Verify route guards and token refresh behavior end to end.' }],
      },
      reviewedPaths: ['src/auth/routeGuard.ts'],
      runtime: { progress: 'completed' },
    })

    expect(result.status).toBe('attention')
    expect(result.summary.whatRemainsUnclear).toMatch(/could not be confirmed/i)
    expect(result.summary.whatToCheckNext).toMatch(/verify route guards/i)
  })

  it('derives profile-based not-applicable weighting for low-fit dimensions', () => {
    const result = assembleDimensionResult({
      dimensionId: 'client_auth_bridge_frontend_guarding',
      repoProfile: {
        profiles: ['CI-only repo'],
        confidence: 'high',
        rationale: 'CI-only workflow surfaces detected.',
      },
      admitted: {
        findings: [],
        observedControls: [],
        unverifiedControls: [],
        recommendations: [],
        quickWins: [],
      },
      reviewedPaths: [],
      runtime: { progress: 'completed' },
    })

    expect(result.applicability.status).toBe('not_applicable')
    expect(result.applicability.required).toBe(false)
    expect(result.applicability.weight).toBeLessThanOrEqual(0.15)
  })

  it('keeps ordinary slashes readable in exported text sanitization', () => {
    expect(sanitizeText('Config / Policy / Rules')).toBe('Config / Policy / Rules')
  })

  it('does not block export readiness when a dimension is skipped for no_relevant_evidence but still applicable', () => {
    const repoProfile = {
      profiles: ['backend API'],
      primaryProfile: 'backend API',
      confidence: 'high',
      rationale: 'fixture',
    }
    const dimensions = [
      createEmptyDimensionResult('auth_session_authorization', {
        status: 'healthy',
        progress: 'completed',
        findings: [],
        observedControls: [],
        unverifiedControls: [],
        recommendations: [],
        coverage: {
          reviewedFiles: 1,
          omittedFilesRelevant: 0,
          capLimited: false,
          confidence: 'high',
          coverageSummary: 'Reviewed auth.',
        },
        evidence: { topCitations: ['lib/a.ts:1'], reviewedPaths: ['lib/a.ts'] },
      }),
      assembleSkippedDimensionResult('data_access_persistence', 'no_relevant_evidence', repoProfile),
    ]
    const dashboard = createDashboardPayload({
      repository: { owner: 'a', name: 'b', url: 'https://github.com/a/b' },
      dimensions,
      repoProfile,
      runState: 'completed',
    })
    expect(dashboard.consolidatedReportAvailable).toBe(true)
    expect(dashboard.reportReadinessReasons).toHaveLength(0)
  })

  it('downgrades overall posture when applicable dimensions are incomplete and no findings were admitted (DEFECT-004)', () => {
    const repoProfile = {
      profiles: ['full stack'],
      primaryProfile: 'full stack',
      confidence: 'high',
      rationale: 'fixture',
    }
    const dimensions = [
      createEmptyDimensionResult('auth_session_authorization', {
        status: 'healthy',
        progress: 'completed',
        findings: [],
        observedControls: [{ id: 'oc', claim: 'Session middleware observed.', confidence: 'high' }],
        unverifiedControls: [],
        recommendations: [],
        applicability: { status: 'applicable', required: true, weight: 1, rationale: 'Applicable.' },
        coverage: {
          reviewedFiles: 2,
          omittedFilesRelevant: 0,
          capLimited: false,
          confidence: 'high',
          coverageSummary: 'Auth reviewed.',
        },
        evidence: { topCitations: ['lib/a.ts:1'], reviewedPaths: ['lib/a.ts'] },
      }),
      assembleSkippedDimensionResult('data_access_persistence', 'no_relevant_evidence', repoProfile),
    ]
    const summary = summarizeDashboard(dimensions)
    expect(summary.totals.findingsAdmitted).toBe(0)
    expect(summary.overallStatus).toBe('unknown')
    const dashboard = createDashboardPayload({
      repository: { owner: 'a', name: 'b', url: 'https://github.com/a/b' },
      dimensions,
      repoProfile,
      runState: 'completed',
    })
    const report = renderConsolidatedReport({
      repository: dashboard.repository,
      dashboard,
    })
    expect(report).toMatch(/\*\*Summary Risk:\*\*[^\n]*Needs additional review/i)
    expect(validateReport(report).ok).toBe(true)
  })

  it('does not block report readiness when skipped dimensions are profile-not-applicable', () => {
    const dashboard = createDashboardPayload({
      repository: {
        owner: 'flowinternals',
        name: 'ci-repo',
        url: 'https://github.com/flowinternals/ci-repo',
      },
      dimensions: [
        assembleSkippedDimensionResult('client_auth_bridge_frontend_guarding', 'no_relevant_evidence', {
          profiles: ['CI-only repo'],
          confidence: 'high',
          rationale: 'CI workflow surfaces only.',
        }),
      ],
      repoProfile: {
        profiles: ['CI-only repo'],
        confidence: 'high',
        rationale: 'CI workflow surfaces only.',
      },
    })

    expect(dashboard.consolidatedReportAvailable).toBe(true)
    expect(dashboard.reportReadinessReasons).toHaveLength(0)
  })
})
