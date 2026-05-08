import { describe, expect, it } from 'vitest'
import {
  pickDocumentationPaths,
  extractLeadParagraphFromMarkdown,
  extractOpeningProseFromMarkdown,
  extractTechnologyFromPackageJson,
  enrichRepoProfileWithDocumentation,
} from '../../lib/shared/repoProfileDocs.js'
import { inferRepoProfileFromPaths } from '../../lib/shared/repoProfile.js'

describe('pickDocumentationPaths', () => {
  it('orders readme, docs, and package.json', () => {
    const paths = ['src/x.ts', 'package.json', 'README.md', 'docs/architecture.md', 'docs/design/DESIGN-SYSTEM.md']
    const picked = pickDocumentationPaths(paths)
    expect(picked[0].toLowerCase()).toBe('readme.md')
    expect(picked).toContain('package.json')
  })
})

describe('extractLeadParagraphFromMarkdown', () => {
  it('returns prose after the title', () => {
    const t = extractLeadParagraphFromMarkdown('# My App\n\nWe provide security reviews for developers.\n\n## More\n')
    expect(t).toMatch(/security reviews/i)
  })
})

describe('extractOpeningProseFromMarkdown', () => {
  it('collects multiple paragraphs before the first ## section', () => {
    const md =
      '# Title\n\nFirst paragraph here.\n\nSecond paragraph continues.\n\n## Getting started\n\nIgnored.'
    const t = extractOpeningProseFromMarkdown(md, { maxParagraphs: 4, maxChars: 2000 })
    expect(t).toMatch(/First paragraph/i)
    expect(t).toMatch(/Second paragraph/i)
    expect(t).not.toMatch(/Getting started/i)
  })
})

describe('enrichRepoProfileWithDocumentation', () => {
  it('fills application purpose and stack from readme and package.json', () => {
    const base = inferRepoProfileFromPaths(['package.json', 'src/App.tsx', 'README.md'], 'JavaScript')
    const pathTextByPath = {
      'README.md': '# SecLens\n\nOn-demand security analysis for GitHub repositories.\n',
      'package.json': JSON.stringify({
        name: 'x',
        description: 'SecLens - On-demand security analysis for GitHub repositories',
        dependencies: { react: '^19', vite: '^5', express: '^4' },
      }),
    }
    const ordered = pickDocumentationPaths(['README.md', 'package.json', 'src/App.tsx'])
    const enriched = enrichRepoProfileWithDocumentation(base, pathTextByPath, ordered, '')
    expect(enriched.applicationPurpose.length).toBeGreaterThan(20)
    expect(enriched.technologyStack.some((s) => /React|Vite|Express/i.test(s))).toBe(true)
    expect(enriched.documentationPathsRead.length).toBeGreaterThan(0)
  })
})

describe('extractTechnologyFromPackageJson', () => {
  it('maps dependency keys to labels', () => {
    const labels = extractTechnologyFromPackageJson(
      JSON.stringify({ dependencies: { react: '1', prisma: '5' } })
    )
    expect(labels).toContain('React')
    expect(labels).toContain('Prisma')
  })
})
