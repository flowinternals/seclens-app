import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildLocalEvidenceSnapshot } from '../../lib/server/localIngestion.js'

describe('localIngestion - critical shortlist fail-closed (DEFECT-003)', () => {
  function makeTruncationFixtureDir() {
    const dir = join(tmpdir(), `seclens-critical-gap-${Date.now()}`)
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    mkdirSync(join(dir, 'functions', 'src'), { recursive: true })
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"name":"gap-fixture"}')
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\non: push\n')
    writeFileSync(join(dir, 'functions', 'src', 'userManagement.ts'), 'export const x = 1\n')
    writeFileSync(join(dir, 'lib', 'rateLimit.ts'), 'export const rl = 1\n')
    return dir
  }

  it('throws when critical shortlist is truncated unless SECLENS_ALLOW_PROTECTED_COVERAGE_GAP is set', () => {
    const prev = process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP
    delete process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP
    const dir = makeTruncationFixtureDir()
    try {
      expect(() => buildLocalEvidenceSnapshot(dir, { criticalShortlistMax: 1 })).toThrow(/critical shortlist coverage gap/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      if (prev === undefined) delete process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP
      else process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP = prev
    }
  })

  it('continues when SECLENS_ALLOW_PROTECTED_COVERAGE_GAP=true', () => {
    const prev = process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP
    process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP = 'true'
    const dir = makeTruncationFixtureDir()
    try {
      const { bundle } = buildLocalEvidenceSnapshot(dir, { criticalShortlistMax: 1 })
      expect(bundle.evidence.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      if (prev === undefined) delete process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP
      else process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP = prev
    }
  })
})
