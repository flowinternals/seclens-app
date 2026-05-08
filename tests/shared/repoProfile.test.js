import { describe, expect, it } from 'vitest'
import {
  buildArchitectureRationale,
  inferRepoProfileFromPaths,
  inferTechnologyStackFromPaths,
  buildProfileSummary,
} from '../../lib/shared/repoProfile.js'

describe('inferTechnologyStackFromPaths', () => {
  it('detects Node/Vite/TS from typical SPA manifests', () => {
    const paths = ['package.json', 'vite.config.ts', 'tsconfig.json', 'pnpm-lock.yaml'].map((p) =>
      p.toLowerCase()
    )
    const stack = inferTechnologyStackFromPaths(paths, 'JavaScript')
    expect(stack).toContain('Node.js / npm manifest')
    expect(stack).toContain('Vite')
    expect(stack).toContain('TypeScript')
    expect(stack).toContain('pnpm')
  })
})

describe('buildArchitectureRationale', () => {
  it('explains path-only inference and lists layout markers in plain language', () => {
    const text = buildArchitectureRationale(133, {
      hasFrontend: true,
      hasApi: true,
      hasCli: true,
      hasLibrary: true,
      hasCi: true,
      hasMobile: false,
      hasIac: false,
      hasData: false,
    })
    expect(text).toMatch(/folder and file paths/i)
    expect(text).toMatch(/133/)
    expect(text).toMatch(/front-end or SPA-style layout/)
    expect(text).toMatch(/CI or workflow automation/)
    expect(text).not.toMatch(/matched/i)
  })
})

describe('inferRepoProfileFromPaths', () => {
  it('sets technologyStack and exposes split confidence plus composite minimum', () => {
    const paths = [
      'src/App.tsx',
      'src/components/x.tsx',
      'package.json',
      'vite.config.ts',
      'server.js',
      'package-lock.json',
      'api/routes.ts',
      'lib/shared.ts',
      '.github/workflows/ci.yml',
    ].map((p) => p.toLowerCase())
    const profile = inferRepoProfileFromPaths(paths, 'TypeScript')
    expect(profile.technologyStack).toContain('Vite')
    expect(profile.technologyStack).toContain('Node.js / npm manifest')
    expect(profile.architectureConfidence).toBe('high')
    expect(profile.stackConfidence).toBe('high')
    expect(profile.confidence).toBe('high')
    expect(profile.applicationPurpose).toBe('')
    expect(profile.profileSummary).toBe('')
  })
})

describe('buildProfileSummary', () => {
  it('combines classification with stack sentence', () => {
    const text = buildProfileSummary({
      primaryProfile: 'frontend SPA',
      profiles: ['frontend SPA'],
      technologyStack: ['Vite', 'TypeScript'],
    })
    expect(text).toMatch(/single-page/i)
    expect(text).toMatch(/Vite/)
  })
})
