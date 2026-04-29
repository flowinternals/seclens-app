import { describe, expect, it } from 'vitest'

import { preparePromptBoundedBundle } from '../../lib/server/openai.js'

function makeBundle(evidenceCount = 6, snippetChars = 12000) {
  const evidence = Array.from({ length: evidenceCount }, (_, i) => ({
    path: i === 0 ? 'functions/src/validateInvite.ts' : `src/helpers/helper-${i}.ts`,
    snippets: [
      {
        startLine: 1,
        endLine: 200,
        text: `// file ${i}\n${'x'.repeat(snippetChars)}`,
      },
    ],
  }))

  return {
    repository: {
      owner: 'owner',
      name: 'repo',
      defaultBranch: 'main',
      scannedRef: 'main',
      scannedSha: 'abcdef1234567890',
    },
    inventory: {
      totalFilesSeen: evidenceCount,
      filesEligibleByTier: { tier1: 1, tier2: evidenceCount - 1, tier3: 0 },
      filesSelected: evidenceCount,
      filesOmitted: 0,
    },
    selection: {
      strategyVersion: 'v2.4',
      selected: evidence.map((ev, i) => ({
        path: ev.path,
        tier: i === 0 ? 'tier1' : 'tier2',
        reason: i === 0 ? 'tier1_priority' : 'related_imported_by_anchor',
      })),
      omitted: [],
      selectedReasonCounts: { tier1_priority: 1, related_imported_by_anchor: evidenceCount - 1 },
      anchorCount: 1,
      relatedContextCount: evidenceCount - 1,
      backfillCount: 0,
      domainReservationCount: 0,
      domainReservationByDomain: {},
      anchorContextMap: [],
    },
    evidence,
    coverage: {
      maxFilesCapHit: false,
      maxBytesPerFileCapHit: false,
      maxTotalBytesCapHit: false,
      maxTreeSizeCapHit: false,
      notes: [],
    },
  }
}

function makeRepoData() {
  return {
    owner: 'owner',
    repo: 'repo',
    url: 'https://github.com/owner/repo',
    description: 'Test repository',
    language: 'TypeScript',
  }
}

describe('preparePromptBoundedBundle', () => {
  it('trims lower-priority evidence before exceeding the model context budget', () => {
    const prep = preparePromptBoundedBundle(makeBundle(8, 20000), makeRepoData(), {
      contextLimitTokens: 20000,
      responseReserveTokens: 4000,
      safetyMarginTokens: 1000,
    })

    expect(prep.trimmedEvidenceCount).toBeGreaterThan(0)
    expect(prep.bundle.evidence.length).toBeLessThan(8)
    expect(prep.estimatedPromptTokens).toBeLessThanOrEqual(prep.availableInputTokens)
    expect(prep.bundle.evidence[0].path).toBe('functions/src/validateInvite.ts')
  })

  it('keeps full evidence set when it already fits the prompt budget', () => {
    const prep = preparePromptBoundedBundle(makeBundle(3, 1200), makeRepoData(), {
      contextLimitTokens: 64000,
      responseReserveTokens: 4000,
      safetyMarginTokens: 1000,
    })

    expect(prep.trimmedEvidenceCount).toBe(0)
    expect(prep.bundle.evidence.length).toBe(3)
  })
})
