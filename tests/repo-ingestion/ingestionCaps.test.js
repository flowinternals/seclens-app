import { describe, it, expect, afterEach } from 'vitest'
import { allowPartialCriticalShortlistCoverage } from '../../lib/server/ingestionCaps.js'

describe('ingestionCaps - critical shortlist coverage policy (DEFECT-003)', () => {
  afterEach(() => {
    delete process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP
  })

  it('does not allow partial coverage by default', () => {
    delete process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP
    expect(allowPartialCriticalShortlistCoverage()).toBe(false)
  })

  it('allows partial coverage when SECLENS_ALLOW_PROTECTED_COVERAGE_GAP is true or 1', () => {
    process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP = 'true'
    expect(allowPartialCriticalShortlistCoverage()).toBe(true)
    process.env.SECLENS_ALLOW_PROTECTED_COVERAGE_GAP = '1'
    expect(allowPartialCriticalShortlistCoverage()).toBe(true)
  })
})
