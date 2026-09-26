import { describe, expect, it } from 'vitest'
import { buildRunTelemetryPatch } from '../../lib/server/runTelemetryStore.js'
import { buildTelemetry } from '../../lib/server/scanTelemetryPayload.js'

describe('runCost telemetry propagation', () => {
  it('includes runCost on run telemetry patches', () => {
    const runCost = {
      status: 'estimated',
      modelId: 'gpt-5-nano',
      estimatedCostUsd: 0.00123,
      modelPriceVersion: 'deadbeef',
      basis: 'estimated_provider_api_list_price',
      pricingVerificationStatus: 'verified',
    }
    const patch = buildRunTelemetryPatch({
      status: 'SUCCESS',
      analysisModel: 'gpt-5-nano',
      runCost,
      modelUsageSummary: {
        analysisModel: 'gpt-5-nano',
        totalTokens: 100,
        estimatedCostUsd: 0.00123,
        runCost,
      },
    })
    expect(patch.runCost).toEqual(runCost)
    expect(patch.modelUsageSummary.runCost).toEqual(runCost)
  })

  it('buildTelemetry embeds canonical runCost alongside estimatedCostUsd', () => {
    const telemetry = buildTelemetry(
      {
        analysisModel: 'gpt-5-nano',
        requestedAnalysisModel: 'gpt-5-nano',
        correlationId: 'c-1',
        tokenUsage: {
          draft: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
          critic: null,
          total: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
        },
        reportValidation: {},
      },
      { ingestion: { selectedFileCount: 1 }, evidenceBundle: { evidence: [] } },
      Date.now() - 1000
    )
    expect(telemetry.runCost).toBeTruthy()
    expect(telemetry.runCost.modelId).toBe('gpt-5-nano')
    expect(telemetry.runCost.status).toBe('estimated')
    expect(telemetry.estimatedCostUsd).toBe(telemetry.runCost.estimatedCostUsd)
    expect(telemetry.runCost.modelPriceVersion).toBeTruthy()
  })
})
