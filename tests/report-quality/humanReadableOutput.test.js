import { describe, expect, it } from 'vitest'
import {
  applyHumanReadableCoverageFallbacks,
  HUMAN_COVERAGE_NOTE_FALLBACK,
  HUMAN_DOWNSCOPE_WEAKNESS,
  lintHumanReadableAdvisory,
  lintHumanReadableText,
  partitionHumanRegisterIssues,
} from '../../lib/server/humanReadableOutput.js'
import { buildContractInstructions } from '../../lib/prompts/seclens-output-contract-v2.js'
import { buildPhasedAnalysisInstructions } from '../../lib/prompts/seclens-phased-analysis-v1.js'
import {
  buildAdvisoryOutput,
  validateAdvisoryOutputContract,
} from '../../lib/server/advisoryContractValidation.js'

function mockDashboard(coverageSummary = 'Reviewed key auth route.') {
  return {
    runState: 'completed',
    repoProfile: {
      primaryProfile: 'web_app',
      profiles: ['web_app'],
      technologyStack: ['node', 'react'],
      architectureSignals: ['api_routes'],
      confidence: 'medium',
    },
    summary: { totals: { dimensionsReviewed: 1 } },
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
        evidence: { reviewedPaths: ['app/api/account/update/route.ts'] },
        coverage: {
          reviewedFiles: 1,
          omittedFilesRelevant: 0,
          capLimited: false,
          coverageSummary,
        },
      },
    ],
    telemetry: { correlationId: 'run-123' },
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

describe('human-readable advisory register', () => {
  it('flags internal pipeline language', () => {
    const hits = lintHumanReadableText('The evidence bundle was grounded in scanned evidence.')
    expect(hits.map((h) => h.code).sort()).toEqual(
      ['INTERNAL_EVIDENCE_BUNDLE', 'INTERNAL_MODEL_REGISTER', 'INTERNAL_SCANNED_EVIDENCE'].sort()
    )
  })

  it('allows ordinary security engineering language', () => {
    expect(lintHumanReadableText('Check the session cookie and authorisation middleware.')).toEqual([])
    expect(lintHumanReadableText('Rotate the access token and store deploy artifacts securely.')).toEqual([])
  })

  it('does not ban ordinary pass/token words outside pipeline phrases', () => {
    expect(lintHumanReadableText('CI passed after the password bypass fix.')).toEqual([])
  })

  it('scans recommendations, coverage, IDE prompts, and suggested tests', () => {
    const issues = lintHumanReadableAdvisory({
      dimensions: [
        {
          recommendations: [{ recommendation: 'The candidate admission failed.' }],
          coverage: { coverageNotes: ['The evidence bundle was trimmed.'] },
          suggestedTests: [{ testGoal: 'Prove rate limiting on the API route.' }],
          aiPrompts: [{ reviewFocus: 'Inspect auth.', prompt: 'Use the pass family for this review.' }],
          findings: [{ title: 'Missing check', claim: 'No authorisation on the admin route.' }],
        },
      ],
    })
    const codes = issues.map((issue) => issue.code)
    expect(codes).toContain('INTERNAL_CLAIM_PIPELINE')
    expect(codes).toContain('INTERNAL_EVIDENCE_BUNDLE')
    expect(codes).toContain('INTERNAL_PASS_FAMILY')
  })

  it('treats coverage notes as warn severity and other prose as error', () => {
    const issues = lintHumanReadableAdvisory({
      dimensions: [
        {
          recommendations: [{ recommendation: 'Avoid the evidence bundle wording.' }],
          coverage: { coverageNotes: ['evidence bundle trimmed'] },
          suggestedTests: [],
          aiPrompts: [],
        },
      ],
    })
    const { errors, warnings } = partitionHumanRegisterIssues(issues)
    expect(errors.some((e) => e.path.includes('recommendations'))).toBe(true)
    expect(warnings.some((w) => w.path.includes('coverageNotes'))).toBe(true)
  })

  it('rewrites dirty coverage notes to the approved fallback', () => {
    const contract = {
      dimensions: [
        {
          coverage: {
            coverageNotes: ['Omitted by prompt or bundle limits'],
            coverageSummary: 'evidence bundle truncated',
          },
        },
      ],
    }
    const { replacements } = applyHumanReadableCoverageFallbacks(contract)
    expect(replacements.length).toBeGreaterThan(0)
    expect(contract.dimensions[0].coverage.coverageNotes[0]).toBe(HUMAN_COVERAGE_NOTE_FALLBACK)
    expect(contract.dimensions[0].coverage.coverageSummary).toBe(HUMAN_COVERAGE_NOTE_FALLBACK)
  })

  it('hybrid validation rewrites dirty coverage and hard-fails dirty recommendations', () => {
    const withDirtyCoverage = buildAdvisoryOutput({
      repoData: mockRepoData(),
      dashboard: mockDashboard('Files omitted by prompt or bundle limits'),
    })
    const coverageResult = validateAdvisoryOutputContract(withDirtyCoverage)
    expect(coverageResult.ok).toBe(true)
    expect(coverageResult.humanRegisterWarnings?.length).toBeGreaterThan(0)
    expect(withDirtyCoverage.dimensions[0].coverage.coverageNotes[0]).toBe(HUMAN_COVERAGE_NOTE_FALLBACK)

    const withDirtyRec = buildAdvisoryOutput({
      repoData: mockRepoData(),
      dashboard: mockDashboard('Reviewed key auth route.'),
    })
    withDirtyRec.dimensions[0].recommendations[0].recommendation =
      'Fix after candidate admission fails on the evidence bundle.'
    const failed = validateAdvisoryOutputContract(withDirtyRec)
    expect(failed.ok).toBe(false)
    expect(failed.errors.some((e) => /AI-internal language/.test(e))).toBe(true)
  })

  it('locks approved downscope fallback constant', () => {
    expect(HUMAN_DOWNSCOPE_WEAKNESS).toMatch(/possible weakness/i)
    expect(HUMAN_DOWNSCOPE_WEAKNESS).not.toMatch(/downscoped|admission|candidate/i)
  })

  it('prompt contracts include human-reader editorial rules', () => {
    const contract = buildContractInstructions()
    const phased = buildPhasedAnalysisInstructions()
    expect(contract).toMatch(/Human reader and editorial rules/i)
    expect(contract).toMatch(/evidence bundle/i)
    expect(phased).toMatch(/Human reader rule/i)
    expect(phased).not.toMatch(/internal admission pass/i)
  })
})
