import { describe, it, expect, vi } from 'vitest'
import { resolveScanRef } from '../../lib/server/githubRefResolution.js'

function refPayload(sha) {
  return { object: { type: 'commit', sha } }
}

describe('resolveScanRef (DEFECT-001)', () => {
  it('resolves trusted default branch staging via git/ref endpoint', async () => {
    const fetchWithAuth = vi.fn(async (url) => {
      if (url.includes('/git/ref/heads/staging')) {
        return { ok: true, status: 200, json: async () => refPayload('sha-staging') }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const r = await resolveScanRef(fetchWithAuth, 'o', 'r', 'staging', { metadataResolved: true })
    expect(r.scannedRef).toBe('staging')
    expect(r.sha).toBe('sha-staging')
    expect(r.degraded).toBe(false)
  })

  it('uses only default branch when metadata resolved - no main/master when develop ref succeeds', async () => {
    const urls = []
    const fetchWithAuth = vi.fn(async (url) => {
      urls.push(url)
      if (url.includes('/git/ref/heads/develop')) {
        return { ok: true, json: async () => refPayload('sha-develop') }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const r = await resolveScanRef(fetchWithAuth, 'o', 'r', 'develop', { metadataResolved: true })
    expect(r.scannedRef).toBe('develop')
    expect(r.sha).toBe('sha-develop')
    expect(r.degraded).toBe(false)
    expect(urls.some((u) => u.includes('/git/ref/heads/main'))).toBe(false)
    expect(urls.some((u) => u.includes('/git/ref/heads/master'))).toBe(false)
  })

  it('uses same branch via branches API when ref fails - still does not try main/master', async () => {
    const urls = []
    const fetchWithAuth = vi.fn(async (url) => {
      urls.push(url)
      if (url.includes('/git/ref/heads/develop')) {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      if (url.includes('/repos/o/r/branches/develop')) {
        return { ok: true, json: async () => ({ commit: { sha: 'sha-from-branch-api' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const r = await resolveScanRef(fetchWithAuth, 'o', 'r', 'develop', { metadataResolved: true })
    expect(r.scannedRef).toBe('develop')
    expect(r.sha).toBe('sha-from-branch-api')
    expect(r.degraded).toBe(true)
    expect(urls.some((u) => u.includes('/git/ref/heads/main'))).toBe(false)
    expect(urls.some((u) => u.includes('/git/ref/heads/master'))).toBe(false)
  })

  it('uses commits fallback for same trusted ref when ref and branches endpoints fail', async () => {
    const urls = []
    const fetchWithAuth = vi.fn(async (url) => {
      urls.push(url)
      if (url.includes('/git/ref/heads/staging')) {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      if (url.includes('/branches/staging')) {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      if (url.includes('/commits/staging')) {
        return { ok: true, status: 200, json: async () => ({ sha: 'sha-from-commits-api' }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const r = await resolveScanRef(fetchWithAuth, 'o', 'r', 'staging', { metadataResolved: true })
    expect(r.scannedRef).toBe('staging')
    expect(r.sha).toBe('sha-from-commits-api')
    expect(r.degraded).toBe(true)
    expect(urls.some((u) => u.includes('/git/ref/heads/main'))).toBe(false)
    expect(urls.some((u) => u.includes('/git/ref/heads/master'))).toBe(false)
  })

  it('resolves slash branch names using encoded or segmented variants', async () => {
    const fetchWithAuth = vi.fn(async (url) => {
      if (url.includes('/git/ref/heads/release/2026-04')) {
        return { ok: true, status: 200, json: async () => refPayload('sha-release') }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const r = await resolveScanRef(fetchWithAuth, 'o', 'r', 'release/2026-04', { metadataResolved: true })
    expect(r.scannedRef).toBe('release/2026-04')
    expect(r.sha).toBe('sha-release')
    expect(r.degraded).toBe(false)
  })

  it('throws when default branch cannot be resolved - does not fall back to main', async () => {
    const urls = []
    const fetchWithAuth = vi.fn(async (url) => {
      urls.push(url)
      return { ok: false, status: 404, json: async () => ({}) }
    })

    await expect(resolveScanRef(fetchWithAuth, 'o', 'r', 'develop', { metadataResolved: true })).rejects.toThrow(
      /selected branch\/ref/
    )
    expect(urls.some((u) => u.includes('main'))).toBe(false)
  })

  it('uses main/master heuristics only without metadata default branch', async () => {
    const fetchWithAuth = vi.fn(async (url) => {
      if (url.includes('/git/ref/heads/main')) {
        return { ok: true, json: async () => refPayload('sha-main') }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const r = await resolveScanRef(fetchWithAuth, 'o', 'r', null, { metadataResolved: false })
    expect(r.scannedRef).toBe('main')
    expect(r.sha).toBe('sha-main')
    expect(r.degraded).toBe(true)
  })
})
