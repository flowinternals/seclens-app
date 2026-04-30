import { describe, it, expect } from 'vitest'
import { buildEvidenceBundle, renderControlEvidenceDigest } from '../../lib/server/evidenceBundle.js'

describe('evidenceBundle', () => {
  it('records tier file cap and total-bytes cap separately in coverage flags', () => {
    const caps = {
      maxFiles: 100,
      maxBytesPerFile: 50,
      maxTotalBytes: 50,
      maxTreeEntries: 5000,
    }

    const selection = {
      selected: [
        { path: 'a.txt', tier: 'tier3', reason: 'related_validation_helper' },
        { path: 'b.txt', tier: 'tier3', reason: 'backfill_tier3' },
      ],
      omitted: [{ path: 'c.txt', reason: 'cap' }],
      selectedReasonCounts: { related_validation_helper: 1, backfill_tier3: 1 },
      anchorCount: 0,
      relatedContextCount: 1,
      backfillCount: 1,
    }

    const orderedFiles = [
      { path: 'a.txt', content: 'x'.repeat(100) },
      { path: 'b.txt', content: 'hello\nworld' },
    ]

    const { bundle, apiIngestion } = buildEvidenceBundle(
      {
        owner: 'o',
        name: 'n',
        defaultBranch: 'develop',
        scannedRef: 'develop',
        scannedSha: 'abcd1234',
      },
      {
        totalFilesSeen: 10,
        filesEligibleByTier: { tier1: 2, tier2: 3, tier3: 30 },
      },
      selection,
      orderedFiles,
      caps,
      { tierFileCapReached: true }
    )

    expect(bundle.repository.defaultBranch).toBe('develop')
    expect(bundle.repository.scannedSha).toBe('abcd1234')
    expect(bundle.coverage.maxFilesCapHit).toBe(true)
    expect(bundle.coverage.maxTotalBytesCapHit || bundle.coverage.maxBytesPerFileCapHit).toBe(true)
    expect(bundle.evidence.length).toBeGreaterThanOrEqual(1)
    expect(bundle.selection.selectedReasonCounts.related_validation_helper).toBe(1)
    expect(bundle.selection.backfillCount).toBe(1)
    expect(apiIngestion.selectedFileCount).toBe(bundle.evidence.length)
    expect(apiIngestion.selectedReasonCounts.related_validation_helper).toBe(1)
    expect(apiIngestion.selectedReasonCounts.backfill_tier3 || 0).toBe(0)
    expect(apiIngestion.plannedSelectedReasonCounts.backfill_tier3).toBe(1)
  })

  it('builds anchor-context map and renders control digest', () => {
    const caps = {
      maxFiles: 100,
      maxBytesPerFile: 500,
      maxTotalBytes: 2000,
      maxTreeEntries: 5000,
    }

    const selection = {
      selected: [
        { path: 'app/api/users/route.ts', tier: 'tier2', reason: 'tier2_anchor_route' },
        {
          path: 'lib/middleware/validate.ts',
          tier: 'tier2',
          reason: 'related_imported_by_anchor',
          linkedAnchorPath: 'app/api/users/route.ts',
        },
        {
          path: 'app/api/users/route.test.ts',
          tier: 'tier3',
          reason: 'related_same_directory_test',
          linkedAnchorPath: 'app/api/users/route.ts',
        },
      ],
      omitted: [],
      selectedReasonCounts: { tier2_anchor_route: 1, related_imported_by_anchor: 1, related_same_directory_test: 1 },
      anchorCount: 1,
      relatedContextCount: 2,
      backfillCount: 0,
    }

    const orderedFiles = [
      { path: 'app/api/users/route.ts', content: 'export async function GET(){}' },
      { path: 'lib/middleware/validate.ts', content: 'export function validate(){}' },
      { path: 'app/api/users/route.test.ts', content: 'test("x", ()=>{})' },
    ]

    const { bundle } = buildEvidenceBundle(
      { owner: 'o', name: 'n', defaultBranch: 'main', scannedRef: 'main', scannedSha: 'abc1234' },
      { totalFilesSeen: 3, filesEligibleByTier: { tier1: 0, tier2: 1, tier3: 2 } },
      selection,
      orderedFiles,
      caps,
      {}
    )

    expect(Array.isArray(bundle.selection.anchorContextMap)).toBe(true)
    expect(bundle.selection.anchorContextMap[0].anchor).toBe('app/api/users/route.ts')
    expect(bundle.selection.anchorContextMap[0].related.validation).toContain('lib/middleware/validate.ts')
    const digest = renderControlEvidenceDigest(bundle)
    expect(digest).toContain('Anchor-linked control evidence digest')
    expect(digest).toContain('app/api/users/route.ts')
  })

  it('emits artifact-class breadth telemetry and rationale coverage', () => {
    const caps = {
      maxFiles: 100,
      maxBytesPerFile: 500,
      maxTotalBytes: 4000,
      maxTreeEntries: 5000,
    }

    const selection = {
      selected: [
        { path: 'README.md', tier: 'tier3', reason: 'backfill_tier3' },
        { path: 'package-lock.json', tier: 'tier1', reason: 'tier1_priority' },
        { path: 'src/routes/users.ts', tier: 'tier2', reason: 'tier2_anchor_route' },
      ],
      omitted: [{ path: 'docs/architecture.pdf', reason: 'cap' }],
    }

    const orderedFiles = [
      { path: 'README.md', content: '# docs' },
      { path: 'package-lock.json', content: '{ "name": "fixture" }' },
      { path: 'src/routes/users.ts', content: 'export const route = true' },
    ]

    const { apiIngestion } = buildEvidenceBundle(
      { owner: 'o', name: 'n', defaultBranch: 'main', scannedRef: 'main' },
      { totalFilesSeen: 4, filesEligibleByTier: { tier1: 1, tier2: 1, tier3: 2 } },
      selection,
      orderedFiles,
      caps,
      {}
    )

    expect(apiIngestion.artifactClassCounts.selected.documentation).toBe(1)
    expect(apiIngestion.artifactClassCounts.selected.manifest_or_lockfile).toBe(1)
    expect(apiIngestion.artifactClassCounts.omitted.optional_documents).toBe(1)
    expect(apiIngestion.retrievalBreadth.rationaleCoverage.percent).toBe(100)
  })
})
