import { describe, it, expect } from 'vitest'
import { sanitizeGitHubUrl as sanitizeClientUrl } from '../../src/utils/sanitize.js'
import { sanitizeGitHubUrl as sanitizeServerUrl } from '../../lib/server/sanitize.js'

describe('GitHub URL sanitizer preserves explicit refs (CR-006)', () => {
  it('preserves base repository URL', () => {
    expect(sanitizeClientUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo')
    expect(sanitizeServerUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo')
  })

  it('preserves explicit /tree/staging ref', () => {
    const input = 'https://github.com/org/repo/tree/staging'
    expect(sanitizeClientUrl(input)).toBe(input)
    expect(sanitizeServerUrl(input)).toBe(input)
  })

  it('preserves slash-containing explicit refs', () => {
    const input = 'https://github.com/org/repo/tree/release/2026-04'
    expect(sanitizeClientUrl(input)).toBe(input)
    expect(sanitizeServerUrl(input)).toBe(input)
  })

  it('rejects unsafe ref payloads', () => {
    expect(sanitizeClientUrl('https://github.com/org/repo/tree/../main')).toBeNull()
    expect(sanitizeServerUrl('https://github.com/org/repo/tree/../main')).toBeNull()
  })
})
