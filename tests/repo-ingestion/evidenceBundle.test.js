import { describe, it, expect } from 'vitest'
import { buildEvidenceBundle } from '../../lib/server/evidenceBundle.js'

describe('evidenceBundle', () => {
  it('records tier file cap and total-bytes cap separately in coverage flags', () => {
    const caps = {
      maxFiles: 100,
      maxBytesPerFile: 50,
      maxTotalBytes: 80,
      maxTreeEntries: 5000,
    }

    const selection = {
      selected: [
        { path: 'a.txt', tier: 'tier3', reason: 'x' },
        { path: 'b.txt', tier: 'tier3', reason: 'x' },
      ],
      omitted: [{ path: 'c.txt', reason: 'cap' }],
    }

    const orderedFiles = [
      { path: 'a.txt', content: 'x'.repeat(100) },
      { path: 'b.txt', content: 'hello\nworld' },
    ]

    const { bundle } = buildEvidenceBundle(
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
  })
})
