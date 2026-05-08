import { describe, expect, it } from 'vitest'
import {
  buildAdvisoryOutput,
  validateAdvisoryOutputContract,
} from '../../lib/server/advisoryContractValidation.js'
import { ADVISORY_CONTRACT_VERSION } from '../../lib/shared/advisoryContract.js'

function mockDashboard() {
  return {
    runState: 'completed',
    repoProfile: {
      primaryProfile: 'web_app',
      profiles: ['web_app'],
      technologyStack: ['node', 'react'],
      architectureSignals: ['api_routes'],
      confidence: 'medium',
    },
    summary: {
      totals: {
        dimensionsReviewed: 1,
      },
    },
    dimensions: [
      {
        dimensionId: 'auth_session_authorization',
        label: 'Auth / Session / Authorization',
        progress: 'completed',
        applicability: { status: 'applicable' },
        recommendations: [
          {
            title: 'Add ownership guard',
            text: 'Add ownership binding checks to state-changing routes.',
            evidenceTarget: 'app/api/account/update/route.ts:10-60',
            priority: 'high',
          },
        ],
        evidence: {
          reviewedPaths: ['app/api/account/update/route.ts'],
        },
        coverage: {
          reviewedFiles: 1,
          omittedFilesRelevant: 0,
          capLimited: false,
          coverageSummary: 'Reviewed key auth route.',
        },
      },
    ],
    telemetry: {
      correlationId: 'run-123',
    },
  }
}

function mockRepoData() {
  return {
    url: 'https://github.com/owner/repo',
    owner: 'owner',
    repo: 'repo',
    scannedRef: 'main',
    scannedSha: 'abc123',
  }
}

describe('advisoryContractValidation', () => {
  it('accepts advisory output with allowed status/applicability values', () => {
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard: mockDashboard() })
    const result = validateAdvisoryOutputContract(advisory)
    expect(advisory.contractVersion).toBe(ADVISORY_CONTRACT_VERSION)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(advisory.criticalFiles).toEqual([{ path: 'app/api/account/update/route.ts' }])
    expect(advisory.dimensions[0].aiPrompts[0].targetFiles).toEqual(['app/api/account/update/route.ts'])
  })

  it('rejects non-allowed status value', () => {
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard: mockDashboard() })
    advisory.status = 'partial'
    const result = validateAdvisoryOutputContract(advisory)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' | ')).toContain('status must be one of')
  })

  it('rejects non-allowed applicability value', () => {
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard: mockDashboard() })
    advisory.dimensions[0].applicability = 'uncertain'
    const result = validateAdvisoryOutputContract(advisory)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' | ')).toContain('applicability must be one of')
  })

  it('requires reasonCode for WARNING/FAILED/SKIPPED', () => {
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard: mockDashboard() })
    advisory.dimensions[0].status = 'WARNING'
    advisory.dimensions[0].reasonCode = null
    const result = validateAdvisoryOutputContract(advisory)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' | ')).toContain('reasonCode is required')
  })

  it('rejects scanner-confirmation language in advisory output', () => {
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard: mockDashboard() })
    advisory.dimensions[0].recommendations[0].recommendation = 'Scanner confirmed this vulnerability.'
    const result = validateAdvisoryOutputContract(advisory)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' | ')).toContain('prohibited scanner-confirmation language')
  })

  it('allows applicable WARNING dimensions without recommendations (cap partial / incomplete synthesis)', () => {
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard: mockDashboard() })
    advisory.dimensions[0].status = 'WARNING'
    advisory.dimensions[0].reasonCode = 'FILE_OMITTED_BY_CAP'
    advisory.dimensions[0].recommendations = []
    advisory.dimensions[0].aiPrompts = []
    advisory.dimensions[0].suggestedTests = []
    const result = validateAdvisoryOutputContract(advisory)
    expect(result.ok).toBe(true)
  })

  it('downgrades applicable SUCCESS to WARNING when model produced no contract artifacts', () => {
    const dashboard = mockDashboard()
    dashboard.dimensions[0].recommendations = []
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard })
    const result = validateAdvisoryOutputContract(advisory)
    expect(result.ok).toBe(true)
    expect(advisory.dimensions[0].status).toBe('WARNING')
    expect(advisory.dimensions[0].reasonCode).toBe('ADVISORY_ARTIFACTS_INCOMPLETE')
    expect(advisory.dimensions[0].recommendations).toEqual([])
    expect(advisory.dimensions[0].aiPrompts).toEqual([])
    expect(advisory.dimensions[0].suggestedTests).toEqual([])
  })

  it('maps applicability retry_needed to applicable in built output', () => {
    const dashboard = mockDashboard()
    dashboard.dimensions[0].applicability = { status: 'retry_needed', weight: 1, rationale: 'retry', required: true }
    dashboard.dimensions[0].progress = 'failed'
    const advisory = buildAdvisoryOutput({ repoData: mockRepoData(), dashboard })
    expect(advisory.dimensions[0].applicability).toBe('applicable')
    const result = validateAdvisoryOutputContract(advisory)
    expect(result.ok).toBe(true)
  })
})

