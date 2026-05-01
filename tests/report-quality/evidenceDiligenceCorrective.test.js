import { describe, it, expect } from 'vitest'
import {
  dimensionHasNoClaimsForDiligence,
  highSignalEvidencePaths,
  planDiligenceCorrectivePasses,
} from '../../lib/server/evidenceDiligenceCorrective.js'

describe('evidenceDiligenceCorrective (DEFECT-004)', () => {
  it('detects high-signal paths for diligence triggers', () => {
    expect(highSignalEvidencePaths(['src/components/InputPanel.jsx', 'lib/x.ts'])).toEqual([
      'src/components/InputPanel.jsx',
    ])
    expect(highSignalEvidencePaths(['lib/server/scanJobs.js'])).toEqual(['lib/server/scanJobs.js'])
    expect(highSignalEvidencePaths(['api/scan-jobs.js'])).toEqual(['api/scan-jobs.js'])
    expect(highSignalEvidencePaths(['docs/SECLENS-USER-GUIDE.md'])).toEqual(['docs/SECLENS-USER-GUIDE.md'])
    expect(highSignalEvidencePaths(['README.md'])).toEqual(['README.md'])
  })

  it('plans corrective only when pass was OK and dimension has no actionable claims', () => {
    const plan = {
      passes: [
        {
          id: 'pass_01_validation_input_trust_boundaries',
          family: 'validation_input_trust_boundaries',
          evidencePaths: ['api/scan-jobs.js'],
          evidence: [],
        },
      ],
    }
    const passRuns = [
      {
        ok: true,
        passId: 'pass_01_validation_input_trust_boundaries',
        family: 'validation_input_trust_boundaries',
        parsed: { claims: [] },
      },
    ]
    const dimensionResults = new Map([
      [
        'validation_input_trust_boundaries',
        {
          findings: [],
          unverifiedControls: [],
          recommendations: [],
          quickWins: [],
        },
      ],
    ])
    const targets = planDiligenceCorrectivePasses(plan, passRuns, dimensionResults)
    expect(targets).toHaveLength(1)
    expect(targets[0].highSignalPaths).toContain('api/scan-jobs.js')
  })

  it('skips corrective when the dimension already has a recommendation', () => {
    const plan = {
      passes: [
        {
          id: 'p1',
          family: 'validation_input_trust_boundaries',
          evidencePaths: ['api/scan-jobs.js'],
          evidence: [],
        },
      ],
    }
    const passRuns = [{ ok: true, passId: 'p1', family: 'validation_input_trust_boundaries', parsed: { claims: [] } }]
    const dimensionResults = new Map([
      [
        'validation_input_trust_boundaries',
        {
          findings: [],
          unverifiedControls: [],
          recommendations: [{ id: 'r1', text: 'x' }],
          quickWins: [],
        },
      ],
    ])
    expect(planDiligenceCorrectivePasses(plan, passRuns, dimensionResults)).toHaveLength(0)
  })

  it('dimensionHasNoClaimsForDiligence treats observed-only stacks as stalemate', () => {
    expect(
      dimensionHasNoClaimsForDiligence({
        findings: [],
        unverifiedControls: [],
        recommendations: [],
        quickWins: [],
        observedControls: [{ id: 'oc' }],
      })
    ).toBe(true)
  })
})
