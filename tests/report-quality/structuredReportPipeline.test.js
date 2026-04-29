import { describe, it, expect } from 'vitest'
import {
  admitCandidates,
  APPENDIX_POLICY_MAX_TOTAL,
  computeLowInformationReport,
  countInspectedSurfaceRows,
  planAppendixEvidence,
  renderDeterministicReport,
  summarizeAdmissionTelemetry,
} from '../../lib/server/structuredReportPipeline.js'
import { validateReport } from '../../lib/server/reportValidation.js'

function mockBundle() {
  return {
    evidence: [
      {
        path: 'app/api/account/update/route.ts',
        snippets: [{ startLine: 10, endLine: 60, text: 'export async function POST() {}' }],
      },
    ],
    inventory: {
      filesSelected: 12,
      filesOmitted: 8,
    },
    coverage: {
      maxFilesCapHit: false,
      maxBytesPerFileCapHit: false,
      maxTotalBytesCapHit: false,
      maxTreeSizeCapHit: false,
      notes: [],
    },
  }
}

function mockRepoData() {
  return {
    owner: 'owner',
    repo: 'repo',
    url: 'https://github.com/owner/repo',
    language: 'JavaScript',
    scannedRef: 'main',
    defaultBranch: 'main',
  }
}

describe('structured report pipeline', () => {
  it('renders contract-valid no-findings report', () => {
    const admission = admitCandidates([], mockBundle())
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
    })
    const validated = validateReport(report)
    expect(validated.ok).toBe(true)
  })

  it('admits concrete finding and renders bounded key finding', () => {
    const candidate = {
      candidate_id: 'cand_1',
      kind: 'finding',
      topic: 'auth',
      title: 'Missing ownership check',
      severity: 'Medium',
      claim: 'Ownership is not validated for account updates.',
      specific_code_behavior: 'The handler accepts a target account id from request payload.',
      missing_control_or_unsafe_condition: 'No ownership verification is enforced before update.',
      impact: 'cross-tenant account tampering',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint', 'control_helper'],
      confidence: 'high',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([candidate], mockBundle())
    expect(admission.admitted.findings).toHaveLength(1)
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
    })
    const validated = validateReport(report)
    expect(validated.ok).toBe(true)
    expect(report).toContain('### [Medium] Missing ownership check')
  })

  it('rejects finding when citation does not resolve to admitted evidence', () => {
    const candidate = {
      candidate_id: 'cand_bad_citation',
      kind: 'finding',
      topic: 'auth',
      title: 'Bad citation',
      severity: 'Medium',
      claim: 'Claim text',
      specific_code_behavior: 'Behavior',
      missing_control_or_unsafe_condition: 'Missing check',
      impact: 'impact',
      evidence_citations: ['app/api/missing.ts:1-5'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint'],
      confidence: 'high',
      scoped_to_scan: true,
      enumValidity: { kind: true, topic: true, severity: true, confidence: true },
    }
    const admission = admitCandidates([candidate], mockBundle())
    expect(admission.admitted.findings).toHaveLength(0)
    expect(admission.rejections.some((r) => r.reason === 'citation_integrity_failure')).toBe(true)
  })

  it('rejects candidate with unknown enum values', () => {
    const candidate = {
      candidate_id: 'cand_bad_enum',
      kind: 'findingish',
      topic: 'weird_topic',
      title: 'Bad enum',
      severity: 'Extreme',
      claim: 'Claim text',
      specific_code_behavior: 'Behavior',
      missing_control_or_unsafe_condition: 'Missing check',
      impact: 'impact',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint'],
      confidence: 'certain',
      scoped_to_scan: true,
      enumValidity: { kind: false, topic: false, severity: false, confidence: false },
    }
    const admission = admitCandidates([candidate], mockBundle())
    expect(admission.admitted.findings).toHaveLength(0)
    expect(admission.rejections.some((r) => r.reason === 'unknown_enum_value')).toBe(true)
  })

  it('reports rejectedCitationIntegrityCount using citation_integrity_failure key', () => {
    const parsed = { claims: [{ kind: 'finding', topic: 'auth' }] }
    const admission = {
      admitted: { findings: [], observations: [], quickWins: [], coverageNotes: [] },
      rejections: [{ candidate_id: 'c1', reason: 'citation_integrity_failure' }],
    }
    const telemetry = summarizeAdmissionTelemetry(parsed, admission, 'No findings were identified within the scanned scope.')
    expect(telemetry.templateVersion).toBe(5)
    expect(telemetry.rejectedCitationIntegrityCount).toBe(1)
  })

  it('renders admitted observations in mapped report sections', () => {
    const candidates = [
      {
        candidate_id: 'obs_1',
        kind: 'observation',
        topic: 'cicd',
        title: 'Workflow observation',
        severity: 'Info',
        claim: 'Workflow hardening is not fully evidenced in scanned CI paths.',
        specific_code_behavior: '',
        missing_control_or_unsafe_condition: '',
        impact: '',
        evidence_citations: ['app/api/account/update/route.ts:10-60'],
        evidence_ref_ids: ['ev_001'],
        evidence_categories: ['policy'],
        confidence: 'medium',
        scoped_to_scan: true,
      },
    ]
    const admission = admitCandidates(candidates, mockBundle())
    expect(admission.admitted.observations).toHaveLength(1)
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
    })
    expect(report).toContain('## CI/CD & Operational Hardening')
    expect(report).toContain('Workflow hardening is not fully evidenced in scanned CI paths.')
  })

  it('rejects quick wins without derivation or coverage basis', () => {
    const quickWin = {
      candidate_id: 'qw_1',
      kind: 'quick_win',
      topic: 'session',
      title: 'Quick win',
      severity: 'Low',
      claim: 'Add stronger session checks.',
      specific_code_behavior: '',
      missing_control_or_unsafe_condition: '',
      impact: '',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['control_helper'],
      confidence: 'medium',
      scoped_to_scan: true,
      derived_from_candidate_ids: [],
      coverage_basis: '',
    }
    const admission = admitCandidates([quickWin], mockBundle())
    expect(admission.admitted.quickWins).toHaveLength(0)
    expect(admission.rejections.some((r) => r.reason === 'insufficient_evidence')).toBe(true)
  })

  it('renders inventory counts from evidence-backed selected set', () => {
    const admission = admitCandidates([], mockBundle())
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
    })
    expect(report).toContain('Selected files: 1. Omitted files: 8.')
  })

  it('rejects hedge-heavy High invite finding without concrete unsafe control signal', () => {
    const candidate = {
      candidate_id: 'cand_invite_high_soft',
      kind: 'finding',
      topic: 'invite',
      title: 'Invite token exposure',
      severity: 'High',
      claim: 'Token exposure could potentially allow abuse.',
      specific_code_behavior: 'Token may be present in links.',
      missing_control_or_unsafe_condition: 'Validation could be improved.',
      impact: 'Potentially unauthorized access.',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint', 'control_helper', 'policy'],
      confidence: 'high',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([candidate], mockBundle())
    expect(admission.admitted.findings).toHaveLength(0)
    expect(admission.admitted.observations.length).toBeGreaterThanOrEqual(1)
    expect(admission.rejections.some((r) => String(r.reason).startsWith('downscoped_to_observation'))).toBe(
      true
    )
  })

  it('renders exploit path with deterministic punctuation-safe template', () => {
    const candidate = {
      candidate_id: 'cand_high_path',
      kind: 'finding',
      topic: 'auth',
      title: 'Missing auth check',
      severity: 'High',
      claim: 'Auth boundary missing.',
      specific_code_behavior: 'Handler accepts target id without owner verification',
      missing_control_or_unsafe_condition: 'missing ownership binding and replay guard',
      impact: 'cross-tenant tampering',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint', 'control_helper', 'policy'],
      confidence: 'high',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([candidate], mockBundle())
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
    })
    expect(report).toContain('**Exploit path:** Observed behavior:')
    expect(report).toContain('Missing control:')
    expect(report).toContain('Potential impact:')
  })

  it('renders quick wins with scoped validation phrasing for descriptive claims', () => {
    const quickWin = {
      candidate_id: 'qw_phrase',
      kind: 'quick_win',
      topic: 'rate_limit',
      title: 'Rate limit quick win',
      severity: 'Low',
      claim: 'Rate limiting is implemented but could be enhanced to prevent abuse.',
      specific_code_behavior: '',
      missing_control_or_unsafe_condition: '',
      impact: '',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['control_helper'],
      confidence: 'medium',
      scoped_to_scan: true,
      derived_from_candidate_ids: ['cand_1'],
      coverage_basis: '',
    }
    const admission = admitCandidates([quickWin], mockBundle())
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
    })
    expect(report).toContain('rate limiting')
    expect(report).toContain('Prioritized Recommendations')
  })

  it('renders admitted recommendation claims without crashing recommendation synthesis', () => {
    const recommendation = {
      candidate_id: 'rec_1',
      kind: 'recommendation',
      topic: 'auth',
      title: 'Add ownership check',
      severity: 'Low',
      claim: 'Add explicit ownership verification before update handlers write account data.',
      specific_code_behavior: '',
      missing_control_or_unsafe_condition: '',
      impact: '',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['control_helper'],
      confidence: 'medium',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([recommendation], mockBundle())
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
    })
    expect(report).toContain('Prioritized Recommendations')
    expect(report).toContain('ownership verification')
  })

  it('rejects meta test-harness finding candidates that cite report-quality tests', () => {
    const bundle = {
      evidence: [
        {
          path: 'tests/report-quality/reportValidation.test.js',
          snippets: [{ startLine: 1, endLine: 20, text: "it('x',()=>{})" }],
        },
      ],
      inventory: { filesSelected: 1, filesOmitted: 0 },
      coverage: { maxFilesCapHit: false, maxBytesPerFileCapHit: false, maxTotalBytesCapHit: false, maxTreeSizeCapHit: false, notes: [] },
    }
    const candidate = {
      candidate_id: 'meta_1',
      kind: 'finding',
      topic: 'validation',
      title: 'Exploit path required for quality gate',
      severity: 'Medium',
      claim: 'Validator requires exploit path for DEFECT-00.',
      specific_code_behavior: 'Test asserts report structure.',
      missing_control_or_unsafe_condition: 'False positive in reportvalidation.',
      impact: 'CI noise',
      evidence_citations: ['tests/report-quality/reportValidation.test.js:1-20'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint', 'control_helper', 'policy'],
      confidence: 'high',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([candidate], bundle)
    expect(admission.admitted.findings).toHaveLength(0)
    expect(admission.rejections.some((r) => r.reason === 'meta_non_security_source')).toBe(true)
  })

  it('appends full ingested citations to Appendix A when bundle is provided', () => {
    const bundle = {
      evidence: [
        {
          path: 'app/a.ts',
          snippets: [{ startLine: 1, endLine: 5, text: 'a' }],
        },
        {
          path: 'app/b.ts',
          snippets: [{ startLine: 2, endLine: 8, text: 'b' }],
        },
      ],
      inventory: { filesSelected: 2, filesOmitted: 0 },
      coverage: { maxFilesCapHit: false, maxBytesPerFileCapHit: false, maxTotalBytesCapHit: false, maxTreeSizeCapHit: false, notes: [] },
    }
    const admission = admitCandidates([], bundle)
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
      bundle,
    })
    expect(report).toContain('`app/a.ts:1-5`')
    expect(report).toContain('`app/b.ts:2-8`')
  })

  it('injects inspected-surface observations when there are no findings and multiple evidence files', () => {
    const bundle = {
      evidence: [
        {
          path: '.github/workflows/ci.yml',
          snippets: [{ startLine: 1, endLine: 5, text: 'on: push' }],
        },
        {
          path: 'package.json',
          snippets: [{ startLine: 1, endLine: 10, text: '{}' }],
        },
      ],
      inventory: { filesSelected: 2, filesOmitted: 0 },
      coverage: { maxFilesCapHit: false, maxBytesPerFileCapHit: false, maxTotalBytesCapHit: false, maxTreeSizeCapHit: false, notes: [] },
    }
    const admission = admitCandidates([], bundle)
    expect(admission.admitted.findings).toHaveLength(0)
    expect(admission.admitted.observations.length).toBeGreaterThanOrEqual(2)
    const topics = new Set(admission.admitted.observations.map((o) => o.topic))
    expect(topics.has('cicd') || topics.has('dependency')).toBe(true)
  })

  it('truncates Appendix A at policy cap when manifest exceeds 40 citations', () => {
    const bundle = {
      evidence: Array.from({ length: 41 }, (_, i) => ({
        path: `src/f${String(i).padStart(3, '0')}.ts`,
        snippets: [{ startLine: 1, endLine: 2, text: 'x' }],
      })),
      inventory: { filesSelected: 41, filesOmitted: 0 },
      coverage: {
        maxFilesCapHit: false,
        maxBytesPerFileCapHit: false,
        maxTotalBytesCapHit: false,
        maxTreeSizeCapHit: false,
        notes: [],
      },
    }
    const admission = admitCandidates([], bundle)
    const plan = planAppendixEvidence(bundle, admission.admitted)
    expect(plan.truncated).toBe(true)
    expect(plan.renderedCount).toBe(APPENDIX_POLICY_MAX_TOTAL)
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
      bundle,
    })
    expect(report).toContain('*Appendix A truncated:*')
  })

  it('sets lowInformationReport when no-findings run lacks minimum inspected-surface rows', () => {
    const admission = admitCandidates([], mockBundle())
    const telemetry = summarizeAdmissionTelemetry({ claims: [] }, admission, '', mockBundle())
    expect(admission.admitted.findings).toHaveLength(0)
    expect(telemetry.lowInformationReport).toBe(true)
  })

  it('does not treat downscoped observations as inspected-surface rows for usefulness gate', () => {
    const bundle = mockBundle()
    const candidate = {
      candidate_id: 'cand_invite_high_soft',
      kind: 'finding',
      topic: 'invite',
      title: 'Invite token exposure',
      severity: 'High',
      claim: 'Token exposure could potentially allow abuse.',
      specific_code_behavior: 'Token may be present in links.',
      missing_control_or_unsafe_condition: 'Validation could be improved.',
      impact: 'Potentially unauthorized access.',
      evidence_citations: ['app/api/account/update/route.ts:10-60'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint', 'control_helper', 'policy'],
      confidence: 'high',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([candidate], bundle)
    expect(admission.admitted.observations.length).toBeGreaterThanOrEqual(1)
    expect(countInspectedSurfaceRows(admission.admitted.observations)).toBe(0)
    const plan = planAppendixEvidence(bundle, admission.admitted)
    expect(computeLowInformationReport(admission.admitted, bundle, plan)).toBe(true)
  })

  it('admits observation candidates using claims topic enum', () => {
    const bundle = {
      evidence: [
        {
          path: 'lib/customClaims.ts',
          snippets: [{ startLine: 1, endLine: 10, text: 'verifyClaims' }],
        },
      ],
      inventory: { filesSelected: 1, filesOmitted: 0 },
      coverage: {
        maxFilesCapHit: false,
        maxBytesPerFileCapHit: false,
        maxTotalBytesCapHit: false,
        maxTreeSizeCapHit: false,
        notes: [],
      },
    }
    const candidate = {
      candidate_id: 'cl_1',
      kind: 'observation',
      topic: 'claims',
      title: 'Claims wiring',
      severity: 'Info',
      claim: 'Custom claims propagation is visible in scanned excerpt.',
      specific_code_behavior: '',
      missing_control_or_unsafe_condition: '',
      impact: '',
      evidence_citations: ['lib/customClaims.ts:1-10'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['policy'],
      confidence: 'medium',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([candidate], bundle)
    expect(admission.admitted.observations).toHaveLength(1)
    expect(admission.admitted.observations[0].topic).toBe('claims')
  })

  it('computeLowInformationReport is false when non-trivial evidence has model observation and quick win', () => {
    const bundle = {
      evidence: [
        { path: '.github/workflows/ci.yml', snippets: [{ startLine: 1, endLine: 5, text: 'on: push' }] },
        { path: 'package.json', snippets: [{ startLine: 1, endLine: 10, text: '{}' }] },
        { path: 'app/auth/session.ts', snippets: [{ startLine: 1, endLine: 5, text: 'x' }] },
      ],
      inventory: { filesSelected: 3, filesOmitted: 0 },
      coverage: {
        maxFilesCapHit: false,
        maxBytesPerFileCapHit: false,
        maxTotalBytesCapHit: false,
        maxTreeSizeCapHit: false,
        notes: [],
      },
    }
    const obs = {
      candidate_id: 'o1',
      kind: 'observation',
      topic: 'cicd',
      title: 'Note',
      severity: 'Info',
      claim: 'Scoped note.',
      specific_code_behavior: '',
      missing_control_or_unsafe_condition: '',
      impact: '',
      evidence_citations: ['.github/workflows/ci.yml:1-5'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: [],
      confidence: 'medium',
      scoped_to_scan: true,
      coverage_basis: '',
    }
    const qw = {
      candidate_id: 'q1',
      kind: 'quick_win',
      topic: 'dependency',
      title: 'Follow',
      severity: 'Low',
      claim: 'Verify handler.',
      specific_code_behavior: '',
      missing_control_or_unsafe_condition: '',
      impact: '',
      evidence_citations: ['package.json:1-10'],
      evidence_ref_ids: ['ev_002'],
      evidence_categories: [],
      confidence: 'medium',
      scoped_to_scan: true,
      derived_from_candidate_ids: ['o1'],
      coverage_basis: '',
    }
    const admission = admitCandidates([obs, qw], bundle)
    const plan = planAppendixEvidence(bundle, admission.admitted)
    expect(computeLowInformationReport(admission.admitted, bundle, plan)).toBe(false)
  })

  it('enriches priority sections and recommendations for findings runs with broad evidence', () => {
    const bundle = {
      evidence: [
        { path: 'functions/src/validateInvite.ts', snippets: [{ startLine: 1, endLine: 40, text: 'x' }] },
        { path: 'functions/src/auth/permissionPolicy.ts', snippets: [{ startLine: 1, endLine: 40, text: 'x' }] },
        { path: 'functions/src/utils/rateLimit.ts', snippets: [{ startLine: 1, endLine: 40, text: 'x' }] },
        { path: '.github/workflows/ci.yml', snippets: [{ startLine: 1, endLine: 20, text: 'on: push' }] },
        { path: 'functions/package-lock.json', snippets: [{ startLine: 1, endLine: 20, text: '{}' }] },
      ],
      inventory: { filesSelected: 5, filesOmitted: 0 },
      coverage: {
        maxFilesCapHit: false,
        maxBytesPerFileCapHit: false,
        maxTotalBytesCapHit: false,
        maxTreeSizeCapHit: false,
        notes: [],
      },
    }
    const finding = {
      candidate_id: 'f1',
      kind: 'finding',
      topic: 'invite',
      title: 'Invite token handling weakness',
      severity: 'Medium',
      claim: 'Invite acceptance path does not enforce token status checks.',
      specific_code_behavior: 'The invite validator accepts stale state without explicit used/expired guards.',
      missing_control_or_unsafe_condition: 'Missing token expiry and single-use enforcement before reset link generation.',
      impact: 'invite token replay risk',
      evidence_citations: ['functions/src/validateInvite.ts:1-40'],
      evidence_ref_ids: ['ev_001'],
      evidence_categories: ['server_entrypoint', 'control_helper', 'policy'],
      confidence: 'high',
      scoped_to_scan: true,
    }
    const admission = admitCandidates([finding], bundle)
    const report = renderDeterministicReport({
      repoData: mockRepoData(),
      admitted: admission.admitted,
      coverage: admission.coverage,
      bundle,
    })
    const telemetry = summarizeAdmissionTelemetry({ claims: [finding] }, admission, report, bundle)
    expect(telemetry.placeholderSectionCount).toBeLessThanOrEqual(1)
    expect(telemetry.repoSpecificSectionCount).toBeGreaterThanOrEqual(4)
    expect(telemetry.genericRecommendationCount).toBe(0)
  })
})
