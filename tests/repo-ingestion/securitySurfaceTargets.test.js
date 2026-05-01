import { describe, it, expect } from 'vitest'
import {
  buildSecuritySurfacePlan,
  enrichSecuritySurfacePlanWithImportGraph,
  enrichSecuritySurfacePlanWithKeywordSignalsFromTexts,
  evaluateDimensionCoreEvidence,
  pickBoundedKeywordScanCandidates,
} from '../../lib/server/securitySurfaceTargets.js'
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

  it('DEFECT-003: commits full critical shortlist before maxFiles backfill (no cap displacement)', () => {
    const paths = ['package.json', 'firebase.json']
    for (let i = 0; i < 40; i++) {
      paths.push(`.github/workflows/pad_${String(i).padStart(2, '0')}.yml`)
    }
    paths.push('functions/src/userManagement.ts')
    const plan = buildSecuritySurfacePlan(paths, backendProfile, { maxFiles: 25 })
    expect(plan.criticalShortlist.length).toBeGreaterThanOrEqual(41)
    const selection = selectPathsByTiers(paths, 12, { repoProfile: backendProfile, securitySurfacePlan: plan })
    expect(selection.selected).toContain('functions/src/userManagement.ts')
    expect(selection.selectionMeta.find((m) => m.path === 'functions/src/userManagement.ts')?.reason).toBe(
      'critical_shortlist'
    )
    for (let i = 0; i < 40; i++) {
      expect(selection.selected).toContain(`.github/workflows/pad_${String(i).padStart(2, '0')}.yml`)
    }
    expect(selection.protectedSecurityTargets?.capDropped).toBe(0)
    expect(selection.protectedSecurityTargets?.oracleIncluded).toBeGreaterThanOrEqual(1)
    expect(selection.protectedCoverageGap).toBe(false)
    expect(selection.selected.length).toBeGreaterThan(12)
  })

  it('DEFECT-003 seclens-style repo: api/, lib/server/, docs on critical shortlist; maxFiles only caps backfill', () => {
    const paths = [
      'api/analyze.js',
      'api/scan-jobs.js',
      'lib/server/scanJobs.js',
      'lib/server/rateLimit.js',
      'README.md',
      'docs/SECLENS-USER-GUIDE.md',
      'src/App.jsx',
    ]
    const mixed = {
      profiles: ['mixed/multi-surface repo', 'backend API', 'frontend SPA'],
      primaryProfile: 'mixed/multi-surface repo',
      confidence: 'high',
      rationale: 'fixture',
    }
    const plan = buildSecuritySurfacePlan(paths, mixed, {})
    expect(plan.criticalShortlistTruncated).toBe(false)
    expect(plan.criticalShortlistMax).toBeNull()
    for (const p of [
      'api/analyze.js',
      'api/scan-jobs.js',
      'lib/server/scanJobs.js',
      'lib/server/rateLimit.js',
      'README.md',
      'docs/SECLENS-USER-GUIDE.md',
    ]) {
      expect(plan.criticalShortlist).toContain(p)
    }
    const selection = selectPathsByTiers(paths, 2, { repoProfile: mixed, securitySurfacePlan: plan })
    expect(selection.protectedCoverageGap).toBe(false)
    expect(selection.selected).toContain('api/analyze.js')
    expect(selection.selected).toContain('lib/server/scanJobs.js')
    expect(selection.selected.length).toBeGreaterThan(2)
  })

  it('DEFECT-003 Stage 2: import-graph enrichment adds imported lib helper to critical shortlist', () => {
    const paths = ['package.json', 'api/trigger.js', 'lib/helpers/deepStore.js']
    const mixed = {
      profiles: ['mixed/multi-surface repo', 'backend API', 'frontend SPA'],
      primaryProfile: 'mixed/multi-surface repo',
      confidence: 'high',
      rationale: 'fixture',
    }
    const pathTextByPath = {
      'api/trigger.js': "import { run } from '../lib/helpers/deepStore.js'\nexport default function handler() { run() }\n",
      'lib/helpers/deepStore.js': 'export function run() { return 1 }\n',
    }
    const plan0 = buildSecuritySurfacePlan(paths, mixed, {})
    expect(plan0.criticalShortlist).toContain('api/trigger.js')
    expect(plan0.criticalShortlist).not.toContain('lib/helpers/deepStore.js')
    const plan1 = enrichSecuritySurfacePlanWithImportGraph(paths, mixed, plan0, pathTextByPath, [])
    expect(plan1.criticalShortlist).toContain('lib/helpers/deepStore.js')
    expect(plan1.shortlistPipeline.forwardImportExpansions).toBeGreaterThan(0)
    const selection = selectPathsByTiers(paths, 1, { repoProfile: mixed, securitySurfacePlan: plan1 })
    expect(selection.protectedCoverageGap).toBe(false)
    expect(selection.selected).toContain('lib/helpers/deepStore.js')
  })

  it('DEFECT-005: App Router route surface + import expansion reaches persistence helper', () => {
    const paths = ['package.json', 'app/api/widgets/route.ts', 'lib/db/save.ts']
    const mixed = {
      profiles: ['mixed/multi-surface repo', 'backend API', 'frontend SPA'],
      primaryProfile: 'mixed/multi-surface repo',
      confidence: 'high',
      rationale: 'fixture',
    }
    const pathTextByPath = {
      'app/api/widgets/route.ts':
        "import { persist } from '../../../lib/db/save'\nexport async function POST() { persist() }\n",
      'lib/db/save.ts': 'export async function persist() { return }\n',
    }
    const plan0 = buildSecuritySurfacePlan(paths, mixed, {})
    expect(plan0.criticalShortlist).toContain('app/api/widgets/route.ts')
    expect(plan0.criticalShortlist).not.toContain('lib/db/save.ts')
    const plan1 = enrichSecuritySurfacePlanWithImportGraph(paths, mixed, plan0, pathTextByPath, [])
    expect(plan1.criticalShortlist).toContain('lib/db/save.ts')
    expect(plan1.shortlistPipeline.forwardImportExpansions).toBeGreaterThan(0)
  })

  it('DEFECT-005: adjacent config paths join surface when data/validation dimensions are active', () => {
    const paths = ['package.json', 'api/ping.ts', 'vercel.json']
    const mixed = {
      profiles: ['mixed/multi-surface repo', 'backend API', 'frontend SPA'],
      primaryProfile: 'mixed/multi-surface repo',
      confidence: 'high',
      rationale: 'fixture',
    }
    const plan = buildSecuritySurfacePlan(paths, mixed, {})
    expect(plan.surfacePathsByDimension.config_policy_rules || []).toContain('vercel.json')
    expect((plan.shortlistPipeline?.configPolicyAdds ?? 0) > 0 || plan.criticalShortlist.includes('vercel.json')).toBe(
      true
    )
  })

  it('DEFECT-005: keyword signals pull bland filenames into buckets when body matches', () => {
    const paths = ['package.json', 'api/ping.ts', 'lib/plainUtil.ts']
    const mixed = {
      profiles: ['mixed/multi-surface repo', 'backend API', 'frontend SPA'],
      primaryProfile: 'mixed/multi-surface repo',
      confidence: 'high',
      rationale: 'fixture',
    }
    const pathTextByPath = {
      'lib/plainUtil.ts': 'const x = process.env.FOO\n',
    }
    const plan0 = buildSecuritySurfacePlan(paths, mixed, {})
    expect(plan0.criticalShortlist).not.toContain('lib/plainUtil.ts')
    const cands = pickBoundedKeywordScanCandidates(paths, mixed, plan0, { max: 50 })
    expect(cands).toContain('lib/plainUtil.ts')
    const plan1 = enrichSecuritySurfacePlanWithKeywordSignalsFromTexts(paths, mixed, plan0, pathTextByPath)
    expect(plan1.criticalShortlist).toContain('lib/plainUtil.ts')
    expect((plan1.shortlistPipeline?.keywordSignalAdds ?? 0) > 0).toBe(true)
  })

  it('treats critical shortlist truncation as protectedCoverageGap (fail-closed signal)', () => {
    const paths = [
      'functions/src/userManagement.ts',
      '.github/workflows/ci.yml',
      'lib/rateLimit.ts',
    ]
    const plan = buildSecuritySurfacePlan(paths, backendProfile, { criticalShortlistMax: 1 })
    expect(plan.criticalShortlistTruncated).toBe(true)
    const selection = selectPathsByTiers(paths, 50, { repoProfile: backendProfile, securitySurfacePlan: plan })
    expect(selection.protectedCoverageGap).toBe(true)
    expect(selection.protectedSecurityTargets?.criticalShortlistTruncated).toBe(true)
  })
})
