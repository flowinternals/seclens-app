import { describe, expect, it } from 'vitest'
import { decodeRepositoryArtifact } from '../../lib/server/artifactText.js'

describe('decodeRepositoryArtifact', () => {
  it('keeps plain UTF-8 text files as evidence content', async () => {
    const base64 = Buffer.from('hello\nworld', 'utf8').toString('base64')
    const decoded = await decodeRepositoryArtifact('README.md', base64)
    expect(decoded.ok).toBe(true)
    expect(decoded.content).toContain('hello')
  })

  it('does not reject pdf binary payloads when readable strings exist', async () => {
    const pseudoPdf = Buffer.from('%PDF-1.7\n1 0 obj\n/Title (Architecture Overview)\nstream\nSecurity Boundary\nendstream')
    const base64 = pseudoPdf.toString('base64')
    const decoded = await decodeRepositoryArtifact('docs/architecture.pdf', base64)
    expect(decoded.ok).toBe(true)
    expect(decoded.content.toLowerCase()).toMatch(/architecture|security/)
  })
})
