import { describe, it, expect } from 'vitest'
import { buildMultiPassPlan, shouldFailForPassFailures } from '../../lib/server/multiPassAnalysis.js'

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
})
