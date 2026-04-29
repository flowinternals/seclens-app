import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildLocalEvidenceSnapshot } from '../../lib/server/localIngestion.js'

describe('local self-scan artifact (DEFECT-001)', () => {
  it('returns a normalized bundle with selection, evidence snippets, and coverage', () => {
    const dir = join(tmpdir(), `seclens-self-scan-test-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}')
    writeFileSync(join(dir, 'README.md'), '# hi')

    try {
      const { bundle, apiIngestion } = buildLocalEvidenceSnapshot(dir, {})

      expect(bundle.repository.scannedRef).toBe('local-working-tree')
      expect(bundle.repository.defaultBranch).toBe('local-working-tree')
      expect(Array.isArray(bundle.selection.selected)).toBe(true)
      expect(Array.isArray(bundle.selection.omitted)).toBe(true)
      expect(Array.isArray(bundle.evidence)).toBe(true)
      expect(bundle.evidence.length).toBeGreaterThan(0)
      const first = bundle.evidence[0]
      expect(first.path).toBeTruthy()
      expect(Array.isArray(first.snippets)).toBe(true)
      expect(first.snippets[0]).toMatchObject({
        startLine: expect.any(Number),
        endLine: expect.any(Number),
        text: expect.any(String),
      })
      expect(bundle.coverage).toMatchObject({
        maxFilesCapHit: expect.any(Boolean),
        notes: expect.any(Array),
      })
      expect(apiIngestion.strategyVersion).toBe('v2.4')
      expect(typeof apiIngestion.selectedReasonCounts).toBe('object')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
