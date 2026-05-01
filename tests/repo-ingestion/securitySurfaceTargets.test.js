import { describe, it, expect } from 'vitest'
import { buildSecuritySurfacePlan, evaluateDimensionCoreEvidence } from '../../lib/server/securitySurfaceTargets.js'
import { selectPathsByTiers } from '../../lib/server/fileSelection.js'

const backendProfile = {
  profiles: ['backend API'],
  primaryProfile: 'backend API',
  confidence: 'high',
  rationale: 'fixture',
}

describe('securitySurfaceTargets (DEFECT-003)', () => {
  it('builds a surface map and protected targets from tree paths', () => {
    const paths = [
      'package.json',
      'functions/src/userManagement.ts',
      'functions/src/inviteToken.ts',
      '.github/workflows/ci.yml',
      'lib/rateLimit.ts',
    ]
    const plan = buildSecuritySurfacePlan(paths, backendProfile, { maxFiles: 50 })
    expect(plan.protectedTargetPaths).toContain('functions/src/userManagement.ts')
    expect(plan.protectedTargetPaths).toContain('.github/workflows/ci.yml')
    expect((plan.surfacePathsByDimension.auth_session_authorization || []).length).toBeGreaterThan(0)
    expect(plan.surfaceDiscoveredCounts.cicd_secrets_deployment).toBeGreaterThan(0)
  })

  it('evaluates core evidence inclusion against the selected set', () => {
    const paths = ['package.json', 'functions/src/userManagement.ts', '.github/workflows/ci.yml']
    const plan = buildSecuritySurfacePlan(paths, backendProfile, { maxFiles: 20 })
    const ev = evaluateDimensionCoreEvidence(plan, new Set(['package.json', 'functions/src/userManagement.ts']), backendProfile)
    expect(ev?.auth_session_authorization?.included).toBeGreaterThan(0)
    expect(ev?.cicd_secrets_deployment?.coreSampleSatisfied).toBe(false)
  })

  it('reserves capacity so lower-tier protected targets are not displaced by excess tier-1 alone', () => {
    const paths = ['package.json', 'firebase.json']
    for (let i = 0; i < 40; i++) {
      paths.push(`.github/workflows/pad_${String(i).padStart(2, '0')}.yml`)
    }
    paths.push('functions/src/userManagement.ts')
    const plan = buildSecuritySurfacePlan(paths, backendProfile, { maxFiles: 25 })
    const selection = selectPathsByTiers(paths, 12, { repoProfile: backendProfile, securitySurfacePlan: plan })
    expect(selection.selected).toContain('functions/src/userManagement.ts')
    expect(selection.selectionMeta.find((m) => m.path === 'functions/src/userManagement.ts')?.reason).toBe(
      'protected_security_target'
    )
    expect(selection.protectedSecurityTargets?.oracleIncluded).toBeGreaterThanOrEqual(1)
    expect(selection.protectedCoverageGap).toBe(false)
  })
})
