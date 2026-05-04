import { describe, it, expect } from 'vitest'
import { sanitizeGitHubUrl as sanitizeClientUrl } from '../../src/utils/sanitize.js'
import {
  isGitHubComHostUrlString,
  sanitizeGitHubUrl as sanitizeServerUrl,
} from '../../lib/server/sanitize.js'

describe('GitHub URL sanitizer preserves explicit refs (CR-006)', () => {
  it('preserves base repository URL', () => {
    expect(sanitizeClientUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo')
    expect(sanitizeServerUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo')
  })

  it('accepts scheme in non-lowercase (HTTP / HTTPS)', () => {
    expect(sanitizeClientUrl('HTTP://github.com/org/repo')).toBe('https://github.com/org/repo')
    expect(sanitizeServerUrl('HTTPS://github.com/org/repo/tree/main')).toBe(
      'https://github.com/org/repo/tree/main'
    )
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

describe('isGitHubComHostUrlString (hostname trust, not substring)', () => {
  it('accepts github.com host only', () => {
    expect(isGitHubComHostUrlString('https://github.com/org/repo')).toBe(true)
    expect(isGitHubComHostUrlString('github.com/org/repo')).toBe(true)
  })

  it('rejects subdomain and suffix hostname tricks', () => {
    expect(isGitHubComHostUrlString('https://www.github.com/org/repo')).toBe(false)
    expect(isGitHubComHostUrlString('https://github.com.evil.example/org/repo')).toBe(false)
    expect(isGitHubComHostUrlString('https://not-github.com/org/repo')).toBe(false)
  })
})
