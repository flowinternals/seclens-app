import { describe, it, expect } from 'vitest'
import { buildMultiPassPlan, passFamilyForPath, shouldFailForPassFailures } from '../../lib/server/multiPassAnalysis.js'

function mockBundle(paths) {
  return {
    evidence: paths.map((path) => ({
      path,
      snippets: [{ startLine: 1, endLine: 5, text: 'x' }],
    })),
  }
}

describe('multi-pass analysis planning', () => {
  it('builds deterministic pass inventory by family', () => {
    const bundle = mockBundle([
      'functions/src/auth/session.ts',
      'functions/src/invite/validateInvite.ts',
      '.github/workflows/ci.yml',
      'src/components/Auth/SessionProtectedRoute.tsx',
    ])
    const plan = buildMultiPassPlan(bundle)
    expect(plan.analysisPassCount).toBeGreaterThanOrEqual(3)
    expect(plan.passes[0].id).toMatch(/^pass_01_/)
  })

  it('fails when more than 40% of passes fail', () => {
    const plan = {
      passes: [
        { passId: 'p1', family: 'auth_session_authorization', requiredHighRisk: true },
        { passId: 'p2', family: 'invite_token_claims', requiredHighRisk: true },
        { passId: 'p3', family: 'validation_input_trust_boundaries', requiredHighRisk: true },
        { passId: 'p4', family: 'cicd_deployment_secret_handling', requiredHighRisk: false },
        { passId: 'p5', family: 'config_policy_rules', requiredHighRisk: false },
      ],
    }
    const failed = [plan.passes[0], plan.passes[1], plan.passes[3]]
    const decision = shouldFailForPassFailures(plan, failed)
    expect(decision.fail).toBe(true)
    expect(decision.reason).toBe('pass_failure_threshold_exceeded')
  })

  it('fails when single planned high-risk domain pass fails', () => {
    const plan = {
      passes: [{ passId: 'p1', family: 'auth_session_authorization', requiredHighRisk: true }],
    }
    const decision = shouldFailForPassFailures(plan, [plan.passes[0]])
    expect(decision.fail).toBe(true)
    expect(['required_high_risk_domain_uncovered', 'pass_failure_threshold_exceeded']).toContain(
      decision.reason
    )
  })

  it('does not create a separate misc supporting pass for unmatched evidence', () => {
    const bundle = mockBundle(['docs/architecture/overview.md'])
    const plan = buildMultiPassPlan(bundle)
    const misc = plan.passes.find((p) => p.family === 'misc_supporting_context')
    expect(misc).toBeUndefined()
    expect(plan.analysisPassCount).toBe(0)
  })

  it('routes camelCase rate limiter files to the rate-limiting pass (DEFECT-004)', () => {
    expect(passFamilyForPath('lib/server/rateLimit.js')).toBe('rate_limiting_abuse_controls')
    expect(passFamilyForPath('src/utils/ratelimitHelper.ts')).toBe('rate_limiting_abuse_controls')
  })

  it('routes server job and API scan surfaces into a modeled pass instead of misc (DEFECT-004)', () => {
    expect(passFamilyForPath('lib/server/scanJobs.js')).toBe('validation_input_trust_boundaries')
    expect(passFamilyForPath('api/scan-jobs.js')).toBe('validation_input_trust_boundaries')
    expect(passFamilyForPath('api/analyze.js')).toBe('validation_input_trust_boundaries')
    const bundle = mockBundle(['lib/server/scanJobs.js', 'api/scan-jobs.js', 'lib/server/rateLimit.js'])
    const plan = buildMultiPassPlan(bundle)
    expect(plan.analysisPassCount).toBeGreaterThanOrEqual(2)
    expect(plan.passes.some((p) => p.family === 'validation_input_trust_boundaries')).toBe(true)
    expect(plan.passes.some((p) => p.family === 'rate_limiting_abuse_controls')).toBe(true)
  })

  it('supports proving-slice planning for a single selected family', () => {
    const bundle = mockBundle([
      'functions/src/auth/session.ts',
      'functions/src/invite/validateInvite.ts',
      'functions/src/rateLimit/limit.ts',
    ])
    const plan = buildMultiPassPlan(bundle, {
      includePassFamilies: ['auth_session_authorization'],
    })
    expect(plan.analysisPassCount).toBe(1)
    expect(plan.passes[0].family).toBe('auth_session_authorization')
    expect(plan.clusterSkipReasons.invite_token_claims).toBe('not_selected_in_run_plan')
    expect(plan.clusterSkipReasons.rate_limiting_abuse_controls).toBe('not_selected_in_run_plan')
  })
})
