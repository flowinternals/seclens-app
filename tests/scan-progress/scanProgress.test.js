import { describe, expect, it } from 'vitest'
import { formatElapsedTime, getEstimatedProgress } from '../../src/components/ScanProgress.jsx'

describe('scan progress helpers', () => {
  it('formats elapsed time in mm:ss', () => {
    expect(formatElapsedTime(0)).toBe('0:00')
    expect(formatElapsedTime(9)).toBe('0:09')
    expect(formatElapsedTime(65)).toBe('1:05')
  })

  it('keeps estimated progress bounded below completion', () => {
    expect(getEstimatedProgress(0, false)).toBeGreaterThanOrEqual(0)
    expect(getEstimatedProgress(45, false)).toBeGreaterThan(50)
    expect(getEstimatedProgress(999, false)).toBeLessThanOrEqual(95)
  })

  it('provides deterministic phase-based progress for reduced motion', () => {
    const early = getEstimatedProgress(0, true)
    const later = getEstimatedProgress(40, true)
    expect(early).toBeGreaterThan(0)
    expect(later).toBeGreaterThan(early)
    expect(getEstimatedProgress(999, true)).toBeLessThanOrEqual(95)
  })
})
