import { describe, expect, it } from 'vitest'
import { buildRunPostMortem } from '../../lib/server/runPostMortem.js'

describe('buildRunPostMortem', () => {
  it('flags missing run', () => {
    const r = buildRunPostMortem(null)
    expect(r.assertionSummary.fail).toBeGreaterThan(0)
    expect(r.recommendedNextAction).toBe('REJECT')
  })

  it('passes a minimal clean SUCCESS snapshot', () => {
    const r = buildRunPostMortem({
      runId: 'r1',
      status: 'SUCCESS',
      reasonCode: null,
      completedAt: new Date().toISOString(),
      repository: { owner: 'a', name: 'b', displayName: 'a/b' },
      telemetry: {
        schemaVersion: 1,
        profile: 'custom',
        outcome: 'completed',
        correlationId: 'c1',
        ingestion: { selectedFileCount: 2, omittedFileCount: 0, capHits: [] },
        tokenUsage: { total: { total_tokens: 100 } },
        structured: { dimensionCount: 3 },
      },
      fileSelectionSummary: { selectedFileCount: 2, omittedFileCount: 0, capHits: [] },
      modelUsageSummary: { totalTokens: 100 },
      dimensionSummary: { dimensionsReviewed: 3, totalDimensions: 3 },
      telemetryLogEntry: { timestampUtc: 'x', repo: 'a/b', profile: 'custom' },
    })
    expect(r.assertionSummary.fail).toBe(0)
    expect(r.recommendedNextAction).toBe('INSUFFICIENT_QUALITY_EVIDENCE')
    expect(r.sections?.executiveRunVerdict?.length).toBeGreaterThan(0)
    expect(r.sections?.whatWorkedWell?.[0] || '').toMatch(/Execution outcome/)
  })

  it('passes telemetry completeness when run.telemetry missing but Firestore summaries exist (legacy persist)', () => {
    const r = buildRunPostMortem({
      runId: 'legacy',
      status: 'SUCCESS',
      completedAt: new Date().toISOString(),
      repository: { owner: 'a', name: 'b', displayName: 'a/b' },
      fileSelectionSummary: { selectedFileCount: 127, omittedFileCount: 6, capHits: [] },
      modelUsageSummary: { totalTokens: 187936 },
      telemetryLogEntry: {
        timestampUtc: '2026-05-02 04:56',
        repo: 'a/b',
        profile: 'custom',
      },
      dimensionSummary: { dimensionsReviewed: 8, totalDimensions: 8 },
    })
    const blob = r.assertions.find((a) => a.id === 'pm.telemetry_blob')
    expect(blob?.severity).toBe('pass')
  })

  it('fails when SUCCESS but dimensions incomplete', () => {
    const r = buildRunPostMortem({
      runId: 'r2',
      status: 'SUCCESS',
      completedAt: new Date().toISOString(),
      repository: { owner: 'a', name: 'b' },
      telemetry: {
        schemaVersion: 1,
        outcome: 'completed',
        ingestion: { capHits: [] },
        tokenUsage: { total: { total_tokens: 10 } },
      },
      modelUsageSummary: { totalTokens: 10 },
      dimensionSummary: { dimensionsReviewed: 1, totalDimensions: 5 },
    })
    const bad = r.assertions.find((a) => a.id === 'pm.dimensions_incomplete_success')
    expect(bad?.severity).toBe('fail')
  })

  it('returns TRUST when dashboard + contract replay succeed and per-dimension depth checks pass', () => {
    const r = buildRunPostMortem({
      runId: 'r1',
      status: 'SUCCESS',
      completedAt: new Date().toISOString(),
      repository: { owner: 'o', name: 'r', displayName: 'o/r', url: 'https://github.com/o/r' },
      reportValidation: { ok: true },
      telemetry: {
        schemaVersion: 1,
        profile: 'custom',
        outcome: 'completed',
        correlationId: 'c1',
        ingestion: { selectedFileCount: 1, omittedFileCount: 0, capHits: [] },
        tokenUsage: { total: { total_tokens: 200 } },
      },
      modelUsageSummary: { totalTokens: 200 },
      dimensionSummary: { dimensionsReviewed: 1, totalDimensions: 1 },
      telemetryLogEntry: { timestampUtc: 'x', repo: 'o/r', profile: 'custom' },
      dashboard: {
        runState: 'completed',
        repoProfile: {
          primaryProfile: 'web_app',
          profiles: ['web_app'],
          technologyStack: ['node'],
          architectureSignals: ['api'],
          confidence: 'medium',
        },
        summary: { totals: { dimensionsReviewed: 1 } },
        dimensions: [
          {
            dimensionId: 'auth_session_authorization',
            label: 'Auth',
            progress: 'completed',
            applicability: { status: 'applicable' },
            recommendations: [
              {
                title: 'Add ownership guard',
                text: 'Add ownership binding checks to state-changing routes for user data.',
                evidenceTarget: 'app/api/account/update/route.ts:10-60',
                priority: 'high',
              },
            ],
            evidence: { reviewedPaths: ['app/api/account/update/route.ts'] },
            coverage: {
              reviewedFiles: 1,
              omittedFilesRelevant: 0,
              capLimited: false,
              coverageSummary: 'ok',
            },
          },
        ],
        telemetry: { correlationId: 'run-x' },
      },
    })
    expect(r.assertionSummary.fail).toBe(0)
    expect(r.assertionSummary.warn).toBe(0)
    expect(r.recommendedNextAction).toBe('TRUST')
    expect(r.sections?.whatWorkedWell?.[0] || '').toMatch(/Execution outcome/)
  })

  it('lists failed dimensions in inventory with diagnostics and fails assertions', () => {
    const r = buildRunPostMortem({
      runId: 'r1',
      status: 'SUCCESS',
      completedAt: new Date().toISOString(),
      repository: { owner: 'o', name: 'r', displayName: 'o/r', url: 'https://github.com/o/r' },
      reportValidation: { ok: true },
      telemetry: {
        schemaVersion: 1,
        profile: 'custom',
        outcome: 'completed',
        correlationId: 'c1',
        ingestion: { selectedFileCount: 1, omittedFileCount: 0, capHits: [] },
        tokenUsage: { total: { total_tokens: 200 } },
      },
      modelUsageSummary: { totalTokens: 200 },
      dimensionSummary: { dimensionsReviewed: 2, totalDimensions: 2 },
      telemetryLogEntry: { timestampUtc: 'x', repo: 'o/r', profile: 'custom' },
      dashboard: {
        runState: 'completed',
        dimensionRuntime: {
          validation_input_trust_boundaries: {
            lastError: 'Model timeout during synthesis',
          },
        },
        repoProfile: {
          primaryProfile: 'web_app',
          profiles: ['web_app'],
          technologyStack: ['node'],
          confidence: 'medium',
        },
        summary: { totals: { dimensionsReviewed: 2 } },
        dimensions: [
          {
            dimensionId: 'auth_session_authorization',
            label: 'Auth',
            progress: 'completed',
            applicability: { status: 'applicable' },
            status: 'healthy',
            recommendations: [
              {
                title: 'Guard',
                text: 'Add ownership binding checks to state-changing routes for user data.',
                evidenceTarget: 'app/a.ts:1-10',
              },
            ],
            evidence: { reviewedPaths: ['app/a.ts'] },
            coverage: { reviewedFiles: 1, omittedFilesRelevant: 0, capLimited: false },
          },
          {
            dimensionId: 'validation_input_trust_boundaries',
            label: 'Validation',
            progress: 'failed',
            applicability: { status: 'applicable' },
            status: 'review_needed',
            recommendations: [],
            evidence: { reviewedPaths: [] },
            coverage: { reviewedFiles: 0, omittedFilesRelevant: 0, capLimited: false },
          },
        ],
        telemetry: { correlationId: 'run-x' },
      },
    })
    expect(r.assertionSummary.fail).toBeGreaterThan(0)
    expect(r.recommendedNextAction).not.toBe('TRUST')
    const inv = r.sections.dimensionReview.join('\n')
    expect(inv).toContain('Dimension: validation_input_trust_boundaries')
    expect(inv).toContain('Status: FAILED')
    expect(inv).toContain('Why it failed:')
    expect(inv).toContain('Runtime detail:')
    expect(r.assertions.some((a) => a.id === 'pm.dimension.validation_input_trust_boundaries.failed')).toBe(true)
    expect(r.assertions.some((a) => a.id === 'pm.dimension_summary_vs_dashboard')).toBe(true)
  })
})
