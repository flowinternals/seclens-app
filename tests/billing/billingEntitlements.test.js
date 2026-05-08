import { describe, expect, it } from 'vitest'
import { hasProAccess, normalizeSubscription } from '../../lib/server/billing.js'
import { getPlanAwareIngestionCaps } from '../../lib/server/ingestionCaps.js'

describe('billing entitlements', () => {
  it('defaults to free/none when subscription is missing', () => {
    const normalized = normalizeSubscription(null)
    expect(normalized.plan).toBe('free')
    expect(normalized.status).toBe('none')
    expect(hasProAccess(normalized)).toBe(false)
  })

  it('grants Pro access only for active or trialing Pro subscriptions', () => {
    expect(hasProAccess({ plan: 'pro', status: 'active' })).toBe(true)
    expect(hasProAccess({ plan: 'pro', status: 'trialing' })).toBe(true)
    expect(hasProAccess({ plan: 'pro', status: 'past_due' })).toBe(false)
    expect(hasProAccess({ plan: 'free', status: 'active' })).toBe(false)
  })

  it('applies CR6 per-plan file caps relative to env ceilings', () => {
    const freeCaps = getPlanAwareIngestionCaps({ plan: 'free', status: 'none' })
    const proCaps = getPlanAwareIngestionCaps({ plan: 'pro', status: 'active' })
    expect(freeCaps.maxBytesPerFile).toBeLessThanOrEqual(3 * 1024 * 1024)
    expect(proCaps.maxBytesPerFile).toBeLessThanOrEqual(25 * 1024 * 1024)
    expect(proCaps.maxBytesPerFile).toBeGreaterThanOrEqual(freeCaps.maxBytesPerFile)
  })
})

