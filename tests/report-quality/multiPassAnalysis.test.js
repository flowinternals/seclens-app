import { describe, it, expect } from 'vitest'
import { buildMultiPassPlan, passFamilyForPath, shouldFailForPassFailures } from '../../lib/server/multiPassAnalysis.js'
import { RESIDUAL_PASS_FAMILY } from '../../lib/server/coverageHonesty.js'

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

  it('routes unmatched evidence to residual supporting-context pass (CR-012 Q4)', () => {
    const bundle = mockBundle(['docs/architecture/overview.md'])
    const plan = buildMultiPassPlan(bundle)
    const residual = plan.passes.find((p) => p.family === RESIDUAL_PASS_FAMILY || p.residual)
    expect(residual).toBeTruthy()
    expect(plan.analysisPassCount).toBe(0)
    expect(plan.assignment.residualReasonCode).toBe('UNMAPPED_SUPPORTING_CONTEXT')
  })

  it('does not route design-system tokens into invite via diagnostic classifier (CR-012 Stage 2)', () => {
    expect(passFamilyForPath('src/design/tokens/invite-colors.ts')).toBe(RESIDUAL_PASS_FAMILY)
    expect(passFamilyForPath('src/components/CardBody.tsx')).not.toBe(
      'data_store_access_persistence_controls'
    )
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

  it('uses the deterministic security surface assignment before residual (Stage 0 precedence)', () => {
    const bundle = mockBundle([
      'src/design/tokens/invite-colors.ts',
      'src/components/CardBody.tsx',
      'server/auth/session.ts',
    ])
    const plan = buildMultiPassPlan(bundle, {
      securitySurfacePlan: {
        surfacePathsByDimension: {
          invite_token_claims: ['src/design/tokens/invite-colors.ts'],
          data_access_persistence: ['src/components/CardBody.tsx'],
          auth_session_authorization: ['server/auth/session.ts'],
        },
      },
      applyQuotas: false,
    })
    expect(plan.passes.find((p) => p.family === 'invite_token_claims').evidencePaths).toEqual([
      'src/design/tokens/invite-colors.ts',
    ])
    expect(plan.passes.find((p) => p.family === 'data_store_access_persistence_controls').evidencePaths).toEqual([
      'src/components/CardBody.tsx',
    ])
    expect(plan.assignment.source).toContain('security_surface_plan')
    expect(plan.assignment.surfacedPathsAssigned).toBe(3)
  })

  it('places unmapped selected evidence in residual with UNMAPPED_SUPPORTING_CONTEXT', () => {
    const bundle = mockBundle(['lib/utils/helpers.ts', 'server/auth/session.ts'])
    const plan = buildMultiPassPlan(bundle, {
      securitySurfacePlan: {
        surfacePathsByDimension: {
          auth_session_authorization: ['server/auth/session.ts'],
        },
      },
      applyQuotas: false,
    })
    const residual = plan.passes.find((p) => p.residual)
    expect(residual.evidencePaths).toContain('lib/utils/helpers.ts')
    expect(residual.reasonCode).toBe('UNMAPPED_SUPPORTING_CONTEXT')
    expect(plan.assignment.residualPaths).toContain('lib/utils/helpers.ts')
  })

  it('applies deterministic per-dimension quotas (CR-012 Q8/Q9)', () => {
    const paths = Array.from({ length: 20 }, (_, i) => `server/auth/mod_${String(i).padStart(2, '0')}.ts`)
    const bundle = mockBundle(paths)
    const plan = buildMultiPassPlan(bundle, {
      securitySurfacePlan: {
        surfacePathsByDimension: {
          auth_session_authorization: paths,
        },
      },
      ingestionCaps: { maxFiles: 8, maxTotalBytes: 512 * 1024 },
      applyQuotas: true,
    })
    const auth = plan.passes.find((p) => p.family === 'auth_session_authorization')
    expect(auth.evidencePaths.length).toBeLessThanOrEqual(plan.assignment.quota.maxPaths)
    expect(plan.assignment.omittedByQuota.length).toBeGreaterThan(0)
    expect(plan.assignment.omittedByQuota[0].reasonCode).toBe('OMITTED_BY_DIMENSION_QUOTA')
  })

  it('produces identical assigned path lists for identical inputs (Stage 4 fixture identity)', () => {
    const paths = ['server/auth/a.ts', 'server/auth/b.ts', 'lib/utils/x.ts']
    const opts = {
      securitySurfacePlan: {
        surfacePathsByDimension: {
          auth_session_authorization: ['server/auth/a.ts', 'server/auth/b.ts'],
        },
      },
      ingestionCaps: { maxFiles: 48, maxTotalBytes: 2 * 1024 * 1024 },
      applyQuotas: true,
    }
    const a = buildMultiPassPlan(mockBundle(paths), opts)
    const b = buildMultiPassPlan(mockBundle(paths), opts)
    expect(a.passes.map((p) => [p.family, p.evidencePaths])).toEqual(
      b.passes.map((p) => [p.family, p.evidencePaths])
    )
    expect(a.assignment.omittedByQuota).toEqual(b.assignment.omittedByQuota)
  })
})
