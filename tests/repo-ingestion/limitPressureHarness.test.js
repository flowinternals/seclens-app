import { describe, expect, it } from 'vitest'

import { getIngestionCaps } from '../../lib/server/ingestionCaps.js'
import { classifyRepoPath, selectPathsByTiers } from '../../lib/server/fileSelection.js'
import { buildEvidenceBundle } from '../../lib/server/evidenceBundle.js'
import { buildMultiPassPlan } from '../../lib/server/multiPassAnalysis.js'
import { preparePromptBoundedBundles } from '../../lib/server/openai.js'

function makeSource(name, repeat = 40) {
  return [
    `export const ${name.replace(/[^a-zA-Z0-9]/g, '_')} = true;`,
    'export function inspect(input) {',
    "  const value = String(input ?? '').trim();",
    '  if (!value) return null;',
    `  return value + '${name}';`,
    '}',
    '',
    '// repeated content for deterministic prompt pressure',
    ...Array.from({ length: repeat }, (_, i) => `const ${name.replace(/[^a-zA-Z0-9]/g, '_')}_${i} = '${name}-${i}';`),
  ].join('\n')
}

function buildSyntheticRepo() {
  const files = []
  const push = (path, content = makeSource(path.split('/').pop() || 'file')) => files.push({ path, content })

  push('package.json', JSON.stringify({ name: 'fixture', private: true }, null, 2))
  push('.github/workflows/ci.yml', 'name: ci\njobs:\n  build:\n    steps:\n      - run: npm test')
  push('firestore.rules', "service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }")
  push('firebase.json', JSON.stringify({ hosting: { public: 'dist' } }, null, 2))
  push('README.md', '# ignored')
  push('docs/security-review.docx', 'ignored binary placeholder')
  push('assets/screenshot.png', 'ignored binary placeholder')

  for (let i = 0; i < 18; i++) push(`functions/src/auth/session-${i}.ts`)
  for (let i = 0; i < 18; i++) push(`functions/src/invite/token-${i}.ts`)
  for (let i = 0; i < 18; i++) push(`functions/src/validation/schema-${i}.ts`)
  for (let i = 0; i < 18; i++) push(`functions/src/rateLimit/limit-${i}.ts`)
  for (let i = 0; i < 18; i++) push(`infra/deploy/workflow-${i}.ts`)
  for (let i = 0; i < 18; i++) push(`config/policy/rule-${i}.ts`)
  for (let i = 0; i < 18; i++) push(`data/repository/store-${i}.ts`)
  for (let i = 0; i < 18; i++) push(`src/components/auth/AuthGuard${i}.tsx`)

  return files
}

function repoData() {
  return {
    owner: 'flowinternals',
    repo: 'synthetic-medium-repo',
    url: 'https://github.com/flowinternals/synthetic-medium-repo',
    description: 'Synthetic medium-large repository fixture',
    language: 'TypeScript',
  }
}

describe('limit pressure harness', () => {
  it('keeps a medium-large synthetic security repo within baseline ingestion caps', () => {
    const caps = getIngestionCaps()
    const files = buildSyntheticRepo()
    const blobPaths = files.map((file) => file.path)
    const pathTextByPath = Object.fromEntries(files.map((file) => [file.path, file.content]))

    const selectionPlan = selectPathsByTiers(blobPaths, caps.maxFiles, { pathTextByPath, aliasAtRoots: [''] })
    const selectedPaths = new Set(selectionPlan.selected)
    const orderedFiles = files.filter((file) => selectedPaths.has(file.path))
    const eligibleByTier = blobPaths.reduce(
      (acc, path) => {
        const classified = classifyRepoPath(path)
        if (classified.omit || classified.tier == null) return acc
        if (classified.tier === 1) acc.tier1++
        else if (classified.tier === 2) acc.tier2++
        else acc.tier3++
        return acc
      },
      { tier1: 0, tier2: 0, tier3: 0 }
    )

    const { bundle, apiIngestion } = buildEvidenceBundle(
      {
        owner: 'flowinternals',
        name: 'synthetic-medium-repo',
        defaultBranch: 'main',
        scannedRef: 'main',
        scannedSha: 'fixture-sha',
      },
      {
        totalFilesSeen: blobPaths.length,
        filesEligibleByTier: eligibleByTier,
      },
      {
        selected: selectionPlan.selectionMeta.map((row) => ({
          path: row.path,
          tier: row.tier,
          reason: row.reason,
          linkedAnchorPath: row.linkedAnchorPath,
          reservedDomain: row.reservedDomain,
        })),
        omitted: selectionPlan.omitted,
        selectedReasonCounts: selectionPlan.selectedReasonCounts,
        anchorCount: selectionPlan.anchorCount,
        relatedContextCount: selectionPlan.relatedContextCount,
        backfillCount: selectionPlan.backfillCount,
        domainReservationCount: selectionPlan.domainReservationCount,
        domainReservationByDomain: selectionPlan.domainReservationByDomain,
      },
      orderedFiles,
      caps,
      { tierFileCapReached: false, treeTruncated: false, refResolutionDegraded: false }
    )

    expect(bundle.coverage.maxFilesCapHit).toBe(false)
    expect(bundle.coverage.maxBytesPerFileCapHit).toBe(false)
    expect(bundle.coverage.maxTotalBytesCapHit).toBe(false)
    expect(bundle.coverage.maxTreeSizeCapHit).toBe(false)
    expect(apiIngestion.nonGermaneExcludedCount).toBeGreaterThanOrEqual(3)
    expect(apiIngestion.selectedFileCount).toBeGreaterThan(80)

    const plan = buildMultiPassPlan(bundle)
    expect(plan.analysisPassCount).toBeGreaterThanOrEqual(8)
    expect(plan.clusterSkipReasons.auth_session_authorization).toBeUndefined()
    expect(plan.clusterSkipReasons.validation_input_trust_boundaries).toBeUndefined()
  })

  it('covers every planned evidence file when prompt pressure forces chunking', () => {
    const syntheticEvidence = Array.from({ length: 26 }, (_, i) => ({
      path: i === 0 ? 'functions/src/auth/route.ts' : `functions/src/auth/helper-${i}.ts`,
      snippets: [
        {
          startLine: 1,
          endLine: 220,
          text: `// chunk ${i}\n${'x'.repeat(18000)}`,
        },
      ],
    }))

    const bundle = {
      repository: {
        owner: 'flowinternals',
        name: 'synthetic-medium-repo',
        defaultBranch: 'main',
        scannedRef: 'main',
        scannedSha: 'fixture-sha',
      },
      inventory: {
        totalFilesSeen: syntheticEvidence.length,
        filesEligibleByTier: { tier1: 1, tier2: syntheticEvidence.length - 1, tier3: 0 },
        filesSelected: syntheticEvidence.length,
        filesOmitted: 0,
      },
      selection: {
        strategyVersion: 'v2.4',
        selected: syntheticEvidence.map((ev, i) => ({
          path: ev.path,
          tier: i === 0 ? 'tier1' : 'tier2',
          reason: i === 0 ? 'tier1_priority' : 'related_imported_by_anchor',
        })),
        omitted: [],
        selectedReasonCounts: { tier1_priority: 1, related_imported_by_anchor: syntheticEvidence.length - 1 },
        anchorCount: 1,
        relatedContextCount: syntheticEvidence.length - 1,
        backfillCount: 0,
        domainReservationCount: 0,
        domainReservationByDomain: {},
        anchorContextMap: [],
      },
      evidence: syntheticEvidence,
      coverage: {
        maxFilesCapHit: false,
        maxBytesPerFileCapHit: false,
        maxTotalBytesCapHit: false,
        maxTreeSizeCapHit: false,
        notes: [],
      },
    }

    const prep = preparePromptBoundedBundles(bundle, repoData(), {
      contextLimitTokens: 22000,
      responseReserveTokens: 4000,
      safetyMarginTokens: 1000,
    })

    expect(prep.chunked).toBe(true)
    expect(prep.chunks.length).toBeGreaterThan(1)
    expect(prep.chunks.every((chunk) => chunk.estimatedPromptTokens <= chunk.availableInputTokens)).toBe(true)
    expect(new Set(prep.chunks.flatMap((chunk) => chunk.bundle.evidence.map((ev) => ev.path))).size).toBe(syntheticEvidence.length)
  })
})
