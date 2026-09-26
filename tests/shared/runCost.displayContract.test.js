import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  formatRunCostCustomerStatement,
  formatRunCostStripPrimary,
  isRunCostAmountDisplayable,
  normalizeRunCost,
} from '../../lib/shared/runCostDisplay.js'

describe('completed-run cost display contract', () => {
  it('DashboardShell mounts a prominent cost strip + expandable details for completed runs', () => {
    const source = readFileSync(resolve('src/components/DashboardShell.jsx'), 'utf8')
    expect(source).toContain('data-testid="run-cost-strip"')
    expect(source).toContain('data-testid="run-cost-details"')
    expect(source).toContain('Cost and usage details')
    expect(source).toContain('Based on configured provider list pricing')
    expect(source).toContain('RunCostStrip')
    expect(source).toContain("runStateLower === 'completed'")
  })

  it('never presents unavailable cost as $0.00 in strip or customer statement', () => {
    const unavailable = normalizeRunCost(null)
    expect(formatRunCostStripPrimary(unavailable)).toBe('Estimated model cost: unavailable')
    expect(formatRunCostCustomerStatement(unavailable)).toContain('unavailable')
    expect(formatRunCostCustomerStatement(unavailable)).not.toMatch(/US\$0\.0+/)
    expect(isRunCostAmountDisplayable(unavailable)).toBe(false)

    const zeroishUnavailable = {
      ...unavailable,
      status: 'unavailable',
      reasonCode: 'PRICING_STALE',
      estimatedCostUsd: null,
      modelId: 'gpt-5-nano',
    }
    expect(formatRunCostStripPrimary(zeroishUnavailable)).toBe('Estimated model cost: unavailable')
  })
})
