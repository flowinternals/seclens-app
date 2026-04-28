import { describe, it, expect } from 'vitest'
import {
  collectCitationManifest,
  renderCitationManifestForPrompt,
  renderScannedPathsHint,
} from '../../lib/server/evidenceBundle.js'

describe('DEFECT-002 citation manifest', () => {
  const mockBundle = {
    evidence: [
      {
        path: 'functions/src/handlers/checkout.ts',
        snippets: [{ startLine: 1, endLine: 107, text: 'export async function checkout' }],
      },
      {
        path: 'empty-range.ts',
        snippets: [{ startLine: 0, endLine: 0, text: '' }],
      },
    ],
    inventory: {},
    repository: {},
    coverage: {},
    selection: {},
  }

  it('collectCitationManifest separates canonical cites from unavailable paths', () => {
    const m = collectCitationManifest(mockBundle)
    expect(m.canonicalCitations).toContain('functions/src/handlers/checkout.ts:1-107')
    expect(m.unavailablePaths).toContain('empty-range.ts')
  })

  it('renderCitationManifestForPrompt lists canonical cites and unavailable section', () => {
    const md = renderCitationManifestForPrompt(mockBundle)
    expect(md).toContain('checkout.ts:1-107')
    expect(md).toContain('Mandatory line citations')
    expect(md).toContain('empty-range.ts')
    expect(md).toContain('Appendix A')
  })

  it('renderScannedPathsHint lists deduped evidence paths', () => {
    const hint = renderScannedPathsHint(mockBundle)
    expect(hint).toContain('checkout.ts')
    expect(hint).toContain('Scanned paths hint')
  })
})
