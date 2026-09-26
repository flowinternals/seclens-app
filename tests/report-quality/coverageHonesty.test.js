import { describe, it, expect } from 'vitest'
import {
  resolvePrimaryPartialReason,
  buildPassScopedCoverage,
  shouldDenylistFromSecuritySurface,
  computeDimensionQuotas,
  buildCoverageHonestyCallout,
  buildCapProvenanceRecords,
  buildCapProvenanceCustomerNote,
  buildAllocationLedgerExportSection,
  PARTIAL_REASON_CODES,
} from '../../lib/server/coverageHonesty.js'
import { buildAdvisoryOutput } from '../../lib/server/advisoryContractValidation.js'
import { classifySelectionDomain } from '../../lib/server/fileSelection.js'
import { buildSecuritySurfacePlan } from '../../lib/server/securitySurfaceTargets.js'

describe('coverageHonesty (CR-012)', () => {
  it('resolves partial reasons with Q1 precedence', () => {
    expect(
      resolvePrimaryPartialReason({
        parseError: true,
        promptTrimmedCount: 2,
        maxBytesPerFileCapHit: true,
      })
    ).toBe(PARTIAL_REASON_CODES.STRUCTURED_PARSE_PARTIAL)
    expect(
      resolvePrimaryPartialReason({
        promptTrimmedCount: 1,
        maxBytesPerFileCapHit: true,
      })
    ).toBe(PARTIAL_REASON_CODES.PROMPT_BUDGET_TRIM)
    expect(resolvePrimaryPartialReason({ maxBytesPerFileCapHit: true })).toBe(
      PARTIAL_REASON_CODES.FILE_OMITTED_BY_CAP
    )
    expect(resolvePrimaryPartialReason({ reviewedFileCount: 0 })).toBe(
      PARTIAL_REASON_CODES.NO_PASS_EVIDENCE
    )
  })

  it('wires real cap signals into pass-scoped coverage', () => {
    const cov = buildPassScopedCoverage(
      { maxBytesPerFileCapHit: true },
      { capHits: ['MAX_FILES_FETCHED'] },
      { promptTrimmedCount: 2 }
    )
    expect(cov.maxBytesPerFileCapHit).toBe(true)
    expect(cov.maxFilesCapHit).toBe(true)
    expect(cov.notes).toContain('PROMPT_BUDGET_TRIM')
  })

  it('denylists design-token and storybook paths', () => {
    expect(shouldDenylistFromSecuritySurface('src/design/tokens/invite-colors.ts')).toBe(true)
    expect(shouldDenylistFromSecuritySurface('Button.stories.tsx')).toBe(true)
    expect(shouldDenylistFromSecuritySurface('lib/auth/session.ts')).toBe(false)
  })

  it('computes plan-aware dimension quotas', () => {
    const q = computeDimensionQuotas({
      globalMaxFiles: 40,
      globalMaxTotalBytes: 1024 * 1024,
      applicableDimensionCount: 5,
    })
    expect(q.minPaths).toBe(4)
    expect(q.maxPaths).toBeGreaterThanOrEqual(4)
    expect(q.maxPaths).toBeLessThanOrEqual(48)
  })
  it('uses residual routing wording that does not claim model review (AQ6)', () => {
    const note = buildCoverageHonestyCallout({
      residualPaths: ['lib/utils/helpers.ts', 'src/ui/chrome.tsx'],
    })
    expect(note).toMatch(/routed as supporting context/i)
    expect(note).toMatch(/not model-examined/i)
    expect(note).not.toMatch(/reviewed as supporting context/i)
  })

  it('builds numeric cap provenance records (AQ8)', () => {
    const records = buildCapProvenanceRecords({
      caps: { maxBytesPerFile: 500000, maxFiles: 40 },
      coverage: { maxBytesPerFileCapHit: true },
      affectedPathsByCode: { MAX_BYTES_PER_FILE: ['lib/auth/session.ts'] },
      observedAtIso: '2026-09-26T00:00:00.000Z',
    })
    expect(records).toHaveLength(1)
    expect(records[0].code).toBe('MAX_BYTES_PER_FILE')
    expect(records[0].resolvedLimitBytes).toBe(500000)
    expect(records[0].affectedPaths).toContain('lib/auth/session.ts')
    expect(buildCapProvenanceCustomerNote(records)).toMatch(/500000 bytes/)
  })

  it('builds bounded allocation ledger export section (AQ9)', () => {
    const section = buildAllocationLedgerExportSection([
      {
        dimensionId: 'invite_token_claims',
        modelExaminedPaths: [],
        omittedByQuota: [],
        unmatchedSurfaced: ['functions/src/inviteManagement.ts'],
        zeroReviewReasonCode: 'NO_PASS_EVIDENCE',
      },
    ])
    expect(section).toMatch(/invite_token_claims/)
    expect(section).toMatch(/zero-review=NO_PASS_EVIDENCE/)
    expect(section).toMatch(/unmatched-surfaced=1/)
  })
})

describe('classifier false-route corpus (CR-012 Stage 2)', () => {
  it('does not classify design tokens as invite', () => {
    expect(classifySelectionDomain('src/design/tokens/invite-colors.ts')).toBeNull()
  })

  it('does not classify CardBody as data_store via substring db', () => {
    expect(classifySelectionDomain('src/components/CardBody.tsx')).toBeNull()
  })

  it('keeps invite management and auth sessions classified', () => {
    expect(classifySelectionDomain('functions/src/inviteManagement.ts')).toBe('invite_token_claims')
    expect(classifySelectionDomain('lib/auth/session.ts')).toBe('auth_session')
  })

  it('excludes denylisted token paths from surface plan buckets', () => {
    const plan = buildSecuritySurfacePlan(
      [
        'package.json',
        'src/design/tokens/invite-colors.ts',
        'functions/src/inviteManagement.ts',
        'lib/auth/session.ts',
      ],
      { profiles: ['web_app'], primaryProfile: 'web_app', confidence: 'high', rationale: 'fixture' },
      { maxFiles: 40 }
    )
    expect(plan.surfacePathsByDimension.invite_token_claims || []).not.toContain(
      'src/design/tokens/invite-colors.ts'
    )
    expect(plan.surfacePathsByDimension.invite_token_claims || []).toContain(
      'functions/src/inviteManagement.ts'
    )
  })
})

describe('advisory partial reason honesty (CR-012 Stage 1)', () => {
  it('maps partial progress to provided reasonCode instead of blanket FILE_OMITTED_BY_CAP', () => {
    const advisory = buildAdvisoryOutput({
      repoData: { url: 'https://github.com/o/r', owner: 'o', repo: 'r', scannedRef: 'main', scannedSha: 'abc' },
      dashboard: {
        runState: 'completed',
        repoProfile: { primaryProfile: 'web_app', profiles: ['web_app'], technologyStack: [], architectureSignals: [], confidence: 'medium' },
        summary: { totals: { dimensionsReviewed: 1 } },
        dimensions: [
          {
            dimensionId: 'auth_session_authorization',
            label: 'Auth',
            progress: 'partial',
            reasonCode: 'STRUCTURED_PARSE_PARTIAL',
            applicability: { status: 'applicable' },
            recommendations: [],
            evidence: { reviewedPaths: ['lib/auth/session.ts'] },
            coverage: {
              reviewedFiles: 1,
              omittedFilesRelevant: 0,
              capLimited: false,
              coverageSummary: 'Partial parse.',
            },
          },
        ],
        telemetry: { correlationId: 'run-1' },
      },
    })
    expect(advisory.dimensions[0].status).toBe('WARNING')
    expect(advisory.dimensions[0].reasonCode).toBe('STRUCTURED_PARSE_PARTIAL')
    expect(advisory.dimensions[0].reasonCode).not.toBe('FILE_OMITTED_BY_CAP')
  })
})
