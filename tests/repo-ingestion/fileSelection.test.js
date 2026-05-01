import { describe, it, expect } from 'vitest'
import {
  classifyRepoPath,
  classifySelectionDomain,
  selectPathsByTiers,
  STRATEGY_VERSION,
} from '../../lib/server/fileSelection.js'
import { buildSecuritySurfacePlan } from '../../lib/server/securitySurfaceTargets.js'

describe('fileSelection', () => {
  it('uses strategy version v2.5', () => {
    expect(STRATEGY_VERSION).toBe('v2.5')
  })

  it('treats domain-reserved security surfaces as expansion anchors for imports', () => {
    const paths = ['package.json', 'lib/middleware/auth.ts', 'lib/shared/crypto.ts']
    const plan = selectPathsByTiers(paths, 15, {
      pathTextByPath: {
        'lib/middleware/auth.ts': "import { hash } from '../shared/crypto'",
      },
    })
    expect(plan.selectionMeta.some((m) => m.path === 'lib/middleware/auth.ts')).toBe(true)
    const reasonByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(reasonByPath['lib/shared/crypto.ts']).toBe('related_imported_by_anchor')
  })

  it('classifies paths into CR-008 selection domains', () => {
    expect(classifySelectionDomain('.github/workflows/ci.yml')).toBe('cicd')
    expect(classifySelectionDomain('lib/auth/session.ts')).toBe('auth_session')
    expect(classifySelectionDomain('lib/rateLimit.ts')).toBe('rate_limit')
    expect(classifySelectionDomain('firestore.rules')).toBe('config_policy')
  })

  it('reserves breadth across domains before anchor expansion', () => {
    const paths = [
      'package.json',
      'lib/auth/core.ts',
      'lib/invite/token.ts',
      'lib/validation/schema.ts',
      'lib/rateLimit.ts',
      'src/middleware.ts',
      '.github/workflows/ci.yml',
      'firestore.rules',
      'prisma/schema.prisma',
      'src/contexts/AuthContext.tsx',
      'src/extra.ts',
    ]
    const plan = selectPathsByTiers(paths, 25)
    expect(plan.domainReservationCount).toBeGreaterThan(0)
    const domainReasons = plan.selectionMeta
      .filter((m) => m.reason.startsWith('domain_reserve_'))
      .map((m) => m.reason)
    expect(new Set(domainReasons).size).toBeGreaterThan(1)
  })

  it('classifies manifests and workflows as tier 1', () => {
    expect(classifyRepoPath('package.json').tier).toBe(1)
    expect(classifyRepoPath('services/api/package.json').tier).toBe(1)
    expect(classifyRepoPath('.github/workflows/ci.yml').tier).toBe(1)
    expect(classifyRepoPath('Dockerfile').tier).toBe(1)
  })

  it('classifies routes and middleware as tier 2', () => {
    expect(classifyRepoPath('src/routes/users.ts').tier).toBe(2)
    expect(classifyRepoPath('src/middleware/auth.ts').tier).toBe(2)
  })

  it('DEFECT-002: promotes callable auth/admin modules under functions/src to tier 2', () => {
    expect(classifyRepoPath('functions/src/userManagement.ts').tier).toBe(2)
    expect(classifyRepoPath('functions/src/inviteManagement.ts').tier).toBe(2)
    expect(classifyRepoPath('functions/src/__tests__/userManagement.rbac.test.ts').tier).toBe(3)
  })

  it('DEFECT-002: maps userManagement to auth_session domain for reservation', () => {
    expect(classifySelectionDomain('functions/src/userManagement.ts')).toBe('auth_session')
    expect(classifySelectionDomain('functions/src/inviteManagement.ts')).toBe('invite_token_claims')
  })

  it('DEFECT-003: tags protected security targets when surface plan drives selection', () => {
    const paths = ['package.json', 'functions/src/userManagement.ts']
    const repoProfile = {
      profiles: ['backend API'],
      primaryProfile: 'backend API',
      confidence: 'high',
      rationale: 'fixture',
    }
    const plan = buildSecuritySurfacePlan(paths, repoProfile, { maxFiles: 20 })
    const sel = selectPathsByTiers(paths, 10, { repoProfile, securitySurfacePlan: plan })
    const row = sel.selectionMeta.find((m) => m.path === 'functions/src/userManagement.ts')
    expect(row?.reason).toBe('protected_security_target')
    expect(sel.protectedSecurityTargets?.eligible).toBeGreaterThan(0)
  })

  it('DEFECT-002: includes userManagement.ts before tier-3 backfill under tight file caps', () => {
    const paths = ['package.json', 'firebase.json']
    for (let i = 0; i < 60; i++) {
      paths.push(`functions/src/zz_pad_${String(i).padStart(3, '0')}.ts`)
    }
    paths.push('functions/src/userManagement.ts')
    const plan = selectPathsByTiers(paths, 25, {
      repoProfile: {
        profiles: ['backend API'],
        primaryProfile: 'backend API',
        confidence: 'high',
        rationale: 'fixture',
      },
    })
    expect(plan.selected).toContain('functions/src/userManagement.ts')
  })

  it('classifies ordinary modules and documentation/config artifacts as tier 3', () => {
    expect(classifyRepoPath('src/components/Button.tsx').tier).toBe(3)
    expect(classifyRepoPath('README.md').tier).toBe(3)
    expect(classifyRepoPath('docs/security-review.docx').tier).toBe(3)
  })

  it('ignores vendor and dependency trees', () => {
    expect(classifyRepoPath('node_modules/foo/index.js').omit).toBe(true)
    expect(classifyRepoPath('vendor/x.go').omit).toBe(true)
  })

  it('selects deterministically across repeated runs', () => {
    const paths = ['z.js', 'package.json', 'src/a.js', '.github/workflows/x.yml', 'src/routes/b.ts']
    const p1 = selectPathsByTiers(paths, 100)
    const p2 = selectPathsByTiers(paths, 100)
    expect(p1.selected).toEqual(p2.selected)
    expect(p1.selectionMeta).toEqual(p2.selectionMeta)
  })

  it('expands route anchor related context and emits reason codes', () => {
    const paths = [
      'app/api/users/route.ts',
      'app/api/users/route.test.ts',
      'app/api/users/validation.ts',
      'app/api/users/errorHandler.ts',
      'app/middleware.ts',
      'lib/auth.ts',
      'lib/rateLimit.ts',
      'package.json',
    ]
    const plan = selectPathsByTiers(paths, 20)
    const reasons = new Set(plan.selectionMeta.map((m) => m.reason))
    expect(reasons.has('tier2_anchor_route')).toBe(true)
    expect(reasons.has('related_same_directory_test')).toBe(true)
    expect(
      reasons.has('related_validation_helper') || reasons.has('domain_reserve_validation')
    ).toBe(true)
    expect(reasons.has('related_error_helper') || reasons.has('domain_reserve_validation')).toBe(true)
    expect(
      reasons.has('related_middleware') ||
        reasons.has('tier2_security_surface') ||
        reasons.has('domain_reserve_middleware_headers')
    ).toBe(true)
    expect(plan.selectedReasonCounts.related_same_directory_test).toBeGreaterThanOrEqual(1)
    expect(plan.relatedContextCount).toBeGreaterThan(0)
    expect(plan.anchorCount).toBeGreaterThan(0)
  })

  it('selects workflow-related scripts/config where present', () => {
    const paths = [
      '.github/workflows/ci.yml',
      'scripts/release.js',
      '.gitleaks.toml',
      'SECURITY.md',
      'src/x.ts',
      'package.json',
    ]
    const plan = selectPathsByTiers(paths, 10, {
      pathTextByPath: {
        '.github/workflows/ci.yml': 'steps:\n  - run: node scripts/release.js',
      },
    })
    const reasonsByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(reasonsByPath['scripts/release.js']).toBe('related_workflow_script')
    expect(['related_config_policy', 'tier1_priority']).toContain(reasonsByPath['.gitleaks.toml'])
  })

  it('does not promote all scripts when workflow does not reference them', () => {
    const paths = ['.github/workflows/ci.yml', 'scripts/release.js', 'scripts/seed.js', 'package.json']
    const plan = selectPathsByTiers(paths, 10, {
      pathTextByPath: {
        '.github/workflows/ci.yml': 'steps:\n  - run: echo ok',
      },
    })
    const reasonsByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(reasonsByPath['scripts/release.js']).not.toBe('related_workflow_script')
    expect(reasonsByPath['scripts/seed.js']).not.toBe('related_workflow_script')
  })

  it('preserves max file cap and tracks cap omissions', () => {
    const many = ['package.json', 'src/routes/a.ts', 'src/routes/a.test.ts']
    for (let i = 0; i < 50; i++) many.push(`src/context/file-${i}.ts`)
    const plan = selectPathsByTiers(many, 5)
    expect(plan.selected).toHaveLength(5)
    expect(plan.omitted.some((o) => o.reason === 'cap')).toBe(true)
  })

  it('falls back to backfill when related context is absent', () => {
    const paths = ['package.json', 'src/routes/basic.ts', 'src/plain/a.ts', 'src/plain/b.ts']
    const plan = selectPathsByTiers(paths, 10)
    expect(plan.selectionMeta.some((m) => m.reason === 'backfill_tier3' || m.reason === 'backfill_tier2')).toBe(true)
  })

  it('does not mark unrelated global helpers as related context', () => {
    const paths = [
      'package.json',
      'app/api/users/route.ts',
      'app/api/users/validation.ts',
      'other/errors.ts',
      'other/rateLimit.ts',
    ]
    const plan = selectPathsByTiers(paths, 20)
    const reasonByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(['backfill_tier2', 'backfill_tier3', 'tier2_security_surface']).toContain(reasonByPath['other/errors.ts'])
    expect([
      'backfill_tier2',
      'backfill_tier3',
      'tier2_security_surface',
      'domain_reserve_rate_limit',
    ]).toContain(reasonByPath['other/rateLimit.ts'])
  })

  it('preserves domain reservation provenance when reason upgrades to related_*', () => {
    const paths = [
      'package.json',
      'app/api/users/route.ts',
      'lib/middleware/validate.ts',
      'src/lib/errors.ts',
      'src/other.ts',
    ]
    const plan = selectPathsByTiers(paths, 20, {
      pathTextByPath: {
        'app/api/users/route.ts':
          "import { validate } from '@/lib/middleware/validate'\nimport err from '../../../src/lib/errors'",
      },
      aliasAtRoots: [''],
    })
    const validateRow = plan.selectionMeta.find((m) => m.path === 'lib/middleware/validate.ts')
    expect(validateRow?.reservedDomain).toBe('middleware_headers')
    expect(plan.domainReservationByDomain.middleware_headers).toBeGreaterThanOrEqual(1)
    expect(plan.domainReservationCount).toBeGreaterThanOrEqual(plan.domainReservationByDomain.middleware_headers)
  })

  it('marks anchor-imported helpers as related_imported_by_anchor', () => {
    const paths = [
      'package.json',
      'app/api/users/route.ts',
      'lib/middleware/validate.ts',
      'src/lib/errors.ts',
      'src/other.ts',
    ]
    const plan = selectPathsByTiers(paths, 20, {
      pathTextByPath: {
        'app/api/users/route.ts':
          "import { validate } from '@/lib/middleware/validate'\nimport err from '../../../src/lib/errors'",
      },
      aliasAtRoots: [''],
    })
    const reasonByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    const linkedByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.linkedAnchorPath]))
    expect(['related_imported_by_anchor', 'domain_reserve_middleware_headers', 'related_middleware']).toContain(
      reasonByPath['lib/middleware/validate.ts']
    )
    expect(reasonByPath['src/lib/errors.ts']).toBe('related_imported_by_anchor')
    if (reasonByPath['lib/middleware/validate.ts'] === 'related_imported_by_anchor') {
      expect(linkedByPath['lib/middleware/validate.ts']).toBe('app/api/users/route.ts')
    }
  })

  it('does not resolve @/ imports without alias mapping config', () => {
    const paths = ['package.json', 'app/api/users/route.ts', 'src/utils/crypto.ts']
    const plan = selectPathsByTiers(paths, 20, {
      pathTextByPath: {
        'app/api/users/route.ts': "import { hash } from '@/utils/crypto'",
      },
      aliasAtRoots: [],
    })
    const reasonByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(reasonByPath['src/utils/crypto.ts']).not.toBe('related_imported_by_anchor')
  })

  it('promotes shared security dirs as related when anchors exist', () => {
    const paths = [
      'package.json',
      'app/api/users/route.ts',
      'lib/middleware/auth.ts',
      'lib/middleware/errorHandler.ts',
      'lib/validation/schema.ts',
    ]
    const plan = selectPathsByTiers(paths, 35)
    const relatedShared = plan.selectionMeta.filter((m) => m.reason === 'related_shared_security_dir')
    const domainLib = plan.selectionMeta.filter(
      (m) =>
        (m.path.startsWith('lib/middleware/') || m.path.startsWith('lib/validation/')) &&
        String(m.reason).startsWith('domain_reserve_')
    )
    expect(relatedShared.length + domainLib.length).toBeGreaterThan(0)
  })

  it('prioritizes cloud functions entrypoints and rules as security surfaces', () => {
    const paths = [
      'functions/src/index.ts',
      'functions/src/createUserAndInvite.ts',
      'functions/src/utils/rateLimit.ts',
      'firestore.rules',
      'storage.rules',
      'scripts/seed.js',
    ]
    const plan = selectPathsByTiers(paths, 20)
    const reasonByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(reasonByPath['firestore.rules']).toBe('tier1_priority')
    expect(['tier2_security_surface', 'tier2_anchor_route']).toContain(reasonByPath['functions/src/index.ts'])
    expect([
      'tier2_security_surface',
      'tier2_anchor_route',
      'domain_reserve_invite_token_claims',
    ]).toContain(reasonByPath['functions/src/createUserAndInvite.ts'])
  })

  it('does not treat test/spec files as security anchors', () => {
    const paths = [
      'functions/src/tests/authorization.test.ts',
      'functions/src/index.ts',
      'functions/src/createUserAndInvite.ts',
      'package.json',
    ]
    const plan = selectPathsByTiers(paths, 20)
    const reasonByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(reasonByPath['functions/src/tests/authorization.test.ts']).not.toBe('tier2_anchor_route')
    expect(reasonByPath['functions/src/tests/authorization.test.ts']).not.toBe('tier2_security_surface')
    expect(['tier2_security_surface', 'tier2_anchor_route']).toContain(reasonByPath['functions/src/index.ts'])
  })

  it('promotes client auth bridge when invite/auth anchors are present', () => {
    const paths = [
      'functions/src/index.ts',
      'functions/src/createUserAndInvite.ts',
      'src/contexts/AuthContext.tsx',
      'src/components/Auth/AuthCallback.tsx',
      'src/components/ui/StandardButton.tsx',
      'package.json',
    ]
    const plan = selectPathsByTiers(paths, 20)
    const reasonByPath = Object.fromEntries(plan.selectionMeta.map((m) => [m.path, m.reason]))
    expect(['domain_reserve_client_auth_bridge', 'related_client_auth_bridge']).toContain(
      reasonByPath['src/contexts/AuthContext.tsx']
    )
  })
})
