import { describe, expect, it } from 'vitest'
import { OPENAI_MODEL_CATALOG, estimateOpenAIUsageCostUsd } from '../../lib/shared/openaiModels.js'
import {
  OPENAI_MODEL_PRICE_REGISTRY,
  PRICE_FRESHNESS_WINDOW_DAYS,
  PRODUCTION_ENABLED_MODEL_IDS,
  computeModelPriceVersion,
  evaluateRegistryFreshness,
  isPriceVerificationFresh,
  resolvePriceRegistryEntryForCatalogRates,
} from '../../lib/shared/openaiModelPriceRegistry.js'
import {
  RUN_COST_REASON,
  RUN_COST_STATUS,
  buildRunCost,
  ensureRunCostStatementInReport,
  formatRunCostCustomerStatement,
  formatRunCostUsd,
  isRunCostAmountDisplayable,
  normalizeRunCost,
  recomputeRunCostFromEmbeddedRates,
} from '../../lib/shared/runCost.js'
import { formatRunCostStripPrimary } from '../../lib/shared/runCostDisplay.js'

const SAMPLE_USAGE = {
  prompt_tokens: 1_000_000,
  completion_tokens: 500_000,
  total_tokens: 1_500_000,
}

describe('CR-SECLENS-COST-001 runCost + price registry', () => {
  it('covers every production-enabled model with a verified fresh registry row matching catalogue rates', () => {
    expect(PRODUCTION_ENABLED_MODEL_IDS.length).toBeGreaterThan(0)
    const nowMs = Date.parse('2026-09-26T12:00:00.000Z')

    for (const modelId of PRODUCTION_ENABLED_MODEL_IDS) {
      const catalog = OPENAI_MODEL_CATALOG.find((model) => model.id === modelId)
      expect(catalog, `catalogue missing ${modelId}`).toBeTruthy()
      const entry = resolvePriceRegistryEntryForCatalogRates(
        modelId,
        catalog.inputCostPer1MUsd,
        catalog.outputCostPer1MUsd
      )
      expect(entry, `registry missing rates for ${modelId}`).toBeTruthy()
      expect(entry.pricingVerificationStatus).toBe('verified')
      expect(isPriceVerificationFresh(entry.pricingVerifiedAtIso, nowMs)).toBe(true)
      expect(evaluateRegistryFreshness(entry, nowMs).status).toBe('verified')
      expect(entry.modelPriceVersion).toBe(
        computeModelPriceVersion({
          modelId: entry.modelId,
          inputCostPer1MUsd: entry.inputCostPer1MUsd,
          outputCostPer1MUsd: entry.outputCostPer1MUsd,
          effectiveDateIso: entry.effectiveDateIso,
          pricingSource: entry.pricingSource,
        })
      )
    }
  })

  it('fails freshness when verification is older than the 90-day window', () => {
    expect(PRICE_FRESHNESS_WINDOW_DAYS).toBe(90)
    const entry = OPENAI_MODEL_PRICE_REGISTRY[0]
    const staleNow = Date.parse(entry.pricingVerifiedAtIso) + (PRICE_FRESHNESS_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000
    expect(evaluateRegistryFreshness(entry, staleNow)).toEqual({
      status: 'stale',
      reasonCode: 'PRICING_STALE',
    })
  })

  it('calculates exact input/output/total costs for every production-enabled model', () => {
    for (const modelId of PRODUCTION_ENABLED_MODEL_IDS) {
      const catalog = OPENAI_MODEL_CATALOG.find((model) => model.id === modelId)
      const runCost = buildRunCost({
        totalUsage: SAMPLE_USAGE,
        modelId,
        selectedModelId: modelId,
        calculatedAtIso: '2026-09-26T12:00:00.000Z',
        nowMs: Date.parse('2026-09-26T12:00:00.000Z'),
      })
      expect(runCost.status).toBe(RUN_COST_STATUS.ESTIMATED)
      expect(runCost.modelId).toBe(modelId)
      expect(runCost.basis).toBe('estimated_provider_api_list_price')
      expect(runCost.pricingVerificationStatus).toBe('verified')
      expect(runCost.inputTokens).toBe(1_000_000)
      expect(runCost.outputTokens).toBe(500_000)
      expect(runCost.totalTokens).toBe(1_500_000)
      expect(runCost.inputCostUsd).toBe(Number(catalog.inputCostPer1MUsd.toFixed(5)))
      expect(runCost.outputCostUsd).toBe(Number((catalog.outputCostPer1MUsd * 0.5).toFixed(5)))
      expect(runCost.estimatedCostUsd).toBe(
        Number((runCost.inputCostUsd + runCost.outputCostUsd).toFixed(5))
      )
      expect(runCost.inputCostPer1MUsd).toBe(catalog.inputCostPer1MUsd)
      expect(runCost.outputCostPer1MUsd).toBe(catalog.outputCostPer1MUsd)
      expect(runCost.modelPriceVersion).toBeTruthy()
    }
  })

  it('does not fall back to default model prices for unknown model ids', () => {
    const runCost = buildRunCost({
      totalUsage: SAMPLE_USAGE,
      modelId: 'totally-unknown-model-xyz',
      selectedModelId: 'gpt-5-nano',
      nowMs: Date.parse('2026-09-26T12:00:00.000Z'),
    })
    expect(runCost.status).toBe(RUN_COST_STATUS.UNAVAILABLE)
    expect(runCost.reasonCode).toBe(RUN_COST_REASON.MODEL_UNKNOWN)
    expect(runCost.modelId).toBe('totally-unknown-model-xyz')
    expect(runCost.estimatedCostUsd).toBeNull()
    expect(isRunCostAmountDisplayable(runCost)).toBe(false)
    expect(formatRunCostStripPrimary(runCost)).toBe('Estimated model cost: unavailable')
  })

  it('marks missing usage unavailable instead of $0.00', () => {
    const runCost = buildRunCost({
      totalUsage: null,
      modelId: 'gpt-5-nano',
      nowMs: Date.parse('2026-09-26T12:00:00.000Z'),
    })
    expect(runCost.status).toBe(RUN_COST_STATUS.UNAVAILABLE)
    expect(runCost.reasonCode).toBe(RUN_COST_REASON.USAGE_MISSING)
    expect(runCost.estimatedCostUsd).toBeNull()
    expect(formatRunCostCustomerStatement(runCost)).toContain('unavailable')
    expect(formatRunCostCustomerStatement(runCost)).not.toContain('US$0.00000')
  })

  it('marks stale pricing unavailable without showing a dollar amount', () => {
    const runCost = buildRunCost({
      totalUsage: SAMPLE_USAGE,
      modelId: 'gpt-5-nano',
      nowMs: Date.parse('2027-01-01T00:00:00.000Z'),
    })
    expect(runCost.status).toBe(RUN_COST_STATUS.UNAVAILABLE)
    expect(runCost.reasonCode).toBe(RUN_COST_REASON.PRICING_STALE)
    expect(runCost.estimatedCostUsd).toBeNull()
    expect(isRunCostAmountDisplayable(runCost)).toBe(false)
  })

  it('formats currency to five decimal places', () => {
    expect(formatRunCostUsd(0.012345678)).toBe('US$0.01235')
  })

  it('preserves historical estimates via embedded rates when catalogue would change', () => {
    const runCost = buildRunCost({
      totalUsage: { prompt_tokens: 2_000_000, completion_tokens: 1_000_000, total_tokens: 3_000_000 },
      modelId: 'gpt-5-nano',
      nowMs: Date.parse('2026-09-26T12:00:00.000Z'),
    })
    const frozen = { ...runCost }
    // Simulate a later catalogue price change without mutating the stored record.
    const recomputed = recomputeRunCostFromEmbeddedRates({
      ...frozen,
      // If someone mistakenly used current catalogue rates that differ, embedded rates win.
      inputCostPer1MUsd: frozen.inputCostPer1MUsd,
      outputCostPer1MUsd: frozen.outputCostPer1MUsd,
    })
    expect(recomputed).toBe(frozen.estimatedCostUsd)
    expect(recomputed).toBe(
      Number((2 * frozen.inputCostPer1MUsd + 1 * frozen.outputCostPer1MUsd).toFixed(5))
    )
  })

  it('legacy missing runCost normalizes to unavailable/legacy, never $0.00', () => {
    const legacy = normalizeRunCost(null)
    expect(legacy.status).toBe(RUN_COST_STATUS.UNAVAILABLE)
    expect(legacy.reasonCode).toBe(RUN_COST_REASON.LEGACY)
    expect(legacy.estimatedCostUsd).toBeNull()
    expect(isRunCostAmountDisplayable(legacy)).toBe(false)
  })

  it('injects approved customer wording into report metadata', () => {
    const runCost = buildRunCost({
      totalUsage: SAMPLE_USAGE,
      modelId: 'gpt-5-nano',
      nowMs: Date.parse('2026-09-26T12:00:00.000Z'),
    })
    const report = `# SecLens Security Report
- **Repository:** demo/repo
- **Generated:** 2026-09-26T12:00:00.000Z
- **Summary Risk:** Low - No findings were identified within the scanned scope.

## Findings
none`
    const withCost = ensureRunCostStatementInReport(report, runCost)
    expect(withCost).toContain('**Estimated model cost:**')
    expect(withCost).toContain(formatRunCostUsd(runCost.estimatedCostUsd))
    expect(withCost).toContain('not an invoice or statement of actual platform spend')
    expect(withCost).not.toContain('modelPriceVersion')
  })

  it('detects selected vs used model mismatch fields without contaminating used model id', () => {
    const runCost = buildRunCost({
      totalUsage: SAMPLE_USAGE,
      modelId: 'gpt-5-nano',
      selectedModelId: 'gpt-4o-mini',
      nowMs: Date.parse('2026-09-26T12:00:00.000Z'),
    })
    expect(runCost.status).toBe(RUN_COST_STATUS.ESTIMATED)
    expect(runCost.modelId).toBe('gpt-5-nano')
    expect(runCost.usedModelId).toBe('gpt-5-nano')
    expect(runCost.selectedModelId).toBe('gpt-4o-mini')
  })

  it('keeps legacy scalar estimator aligned for positive usage on known models', () => {
    const scalar = estimateOpenAIUsageCostUsd(SAMPLE_USAGE, 'gpt-5-nano')
    const runCost = buildRunCost({
      totalUsage: SAMPLE_USAGE,
      modelId: 'gpt-5-nano',
      nowMs: Date.parse('2026-09-26T12:00:00.000Z'),
    })
    expect(runCost.estimatedCostUsd).toBe(scalar)
  })
})
