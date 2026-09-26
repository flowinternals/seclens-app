/**
 * Canonical runCost builder (CR-SECLENS-COST-001).
 * Server / Node only — imports price registry (node:crypto).
 */

import { getOpenAIModelById } from './openaiModels.js'
import {
  PRICING_SOURCE_OPENAI_API_LIST,
  evaluateRegistryFreshness,
  resolvePriceRegistryEntryForCatalogRates,
} from './openaiModelPriceRegistry.js'
import {
  RUN_COST_BASIS,
  RUN_COST_CURRENCY,
  RUN_COST_REASON,
  RUN_COST_STATUS,
  formatRunCostCustomerStatement,
  normalizeRunCost,
} from './runCostDisplay.js'

export {
  RUN_COST_BASIS,
  RUN_COST_CURRENCY,
  RUN_COST_REASON,
  RUN_COST_STATUS,
  formatRunCostCustomerStatement,
  formatRunCostStripPrimary,
  formatRunCostUsd,
  isRunCostAmountDisplayable,
  normalizeRunCost,
} from './runCostDisplay.js'

function asFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function roundUsd(value) {
  return Number(Number(value).toFixed(5))
}

function unavailableRunCost({
  modelId = null,
  reasonCode,
  pricingVerificationStatus = 'unknown',
  inputTokens = null,
  outputTokens = null,
  totalTokens = null,
  calculatedAtIso,
  pricingSource = null,
  pricingVerifiedAtIso = null,
  modelPriceVersion = null,
  inputCostPer1MUsd = null,
  outputCostPer1MUsd = null,
  selectedModelId = null,
  usedModelId = null,
} = {}) {
  return {
    currency: RUN_COST_CURRENCY,
    basis: RUN_COST_BASIS,
    status: RUN_COST_STATUS.UNAVAILABLE,
    reasonCode,
    modelId,
    modelPriceVersion,
    inputTokens,
    outputTokens,
    totalTokens,
    inputCostUsd: null,
    outputCostUsd: null,
    estimatedCostUsd: null,
    inputCostPer1MUsd,
    outputCostPer1MUsd,
    calculatedAtIso,
    pricingSource,
    pricingVerifiedAtIso,
    pricingVerificationStatus,
    selectedModelId: selectedModelId ?? null,
    usedModelId: usedModelId ?? modelId,
  }
}

/**
 * Build the canonical runCost from authoritative usage + catalogue rates + registry governance.
 * Does NOT fall back to DEFAULT_OPENAI_MODEL_ID for unknown models (A6).
 *
 * @param {{
 *   totalUsage?: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | null,
 *   modelId?: string | null,
 *   selectedModelId?: string | null,
 *   calculatedAtIso?: string,
 *   nowMs?: number,
 * }} params
 */
export function buildRunCost({
  totalUsage = null,
  modelId = null,
  selectedModelId = null,
  calculatedAtIso = new Date().toISOString(),
  nowMs = Date.now(),
} = {}) {
  const usedModelId = typeof modelId === 'string' && modelId.trim() ? modelId.trim() : null
  const selected = typeof selectedModelId === 'string' && selectedModelId.trim() ? selectedModelId.trim() : null

  const promptTokens = asFiniteNumber(totalUsage?.prompt_tokens)
  const completionTokens = asFiniteNumber(totalUsage?.completion_tokens)
  const totalTokens = asFiniteNumber(totalUsage?.total_tokens)

  const hasUsage =
    promptTokens != null &&
    completionTokens != null &&
    totalTokens != null &&
    (promptTokens > 0 || completionTokens > 0 || totalTokens > 0)

  if (!hasUsage) {
    return unavailableRunCost({
      modelId: usedModelId,
      reasonCode: RUN_COST_REASON.USAGE_MISSING,
      calculatedAtIso,
      selectedModelId: selected,
      usedModelId,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
    })
  }

  if (!usedModelId) {
    return unavailableRunCost({
      modelId: null,
      reasonCode: RUN_COST_REASON.MODEL_UNKNOWN,
      calculatedAtIso,
      selectedModelId: selected,
      usedModelId: null,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
    })
  }

  const catalogModel = getOpenAIModelById(usedModelId)
  if (!catalogModel) {
    return unavailableRunCost({
      modelId: usedModelId,
      reasonCode: RUN_COST_REASON.MODEL_UNKNOWN,
      calculatedAtIso,
      selectedModelId: selected,
      usedModelId,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
    })
  }

  const registryEntry = resolvePriceRegistryEntryForCatalogRates(
    catalogModel.id,
    catalogModel.inputCostPer1MUsd,
    catalogModel.outputCostPer1MUsd
  )

  if (!registryEntry) {
    return unavailableRunCost({
      modelId: catalogModel.id,
      reasonCode: RUN_COST_REASON.PRICING_UNKNOWN,
      calculatedAtIso,
      selectedModelId: selected,
      usedModelId: catalogModel.id,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
      inputCostPer1MUsd: catalogModel.inputCostPer1MUsd,
      outputCostPer1MUsd: catalogModel.outputCostPer1MUsd,
      pricingSource: PRICING_SOURCE_OPENAI_API_LIST,
    })
  }

  const freshness = evaluateRegistryFreshness(registryEntry, nowMs)
  if (freshness.status !== 'verified') {
    return unavailableRunCost({
      modelId: catalogModel.id,
      reasonCode: freshness.reasonCode,
      pricingVerificationStatus: freshness.status,
      calculatedAtIso,
      selectedModelId: selected,
      usedModelId: catalogModel.id,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
      inputCostPer1MUsd: registryEntry.inputCostPer1MUsd,
      outputCostPer1MUsd: registryEntry.outputCostPer1MUsd,
      pricingSource: registryEntry.pricingSource,
      pricingVerifiedAtIso: registryEntry.pricingVerifiedAtIso,
      modelPriceVersion: registryEntry.modelPriceVersion,
    })
  }

  const inputCostUsd = roundUsd((promptTokens / 1_000_000) * registryEntry.inputCostPer1MUsd)
  const outputCostUsd = roundUsd((completionTokens / 1_000_000) * registryEntry.outputCostPer1MUsd)
  const estimatedCostUsd = roundUsd(inputCostUsd + outputCostUsd)

  return {
    currency: RUN_COST_CURRENCY,
    basis: RUN_COST_BASIS,
    status: RUN_COST_STATUS.ESTIMATED,
    reasonCode: null,
    modelId: catalogModel.id,
    modelPriceVersion: registryEntry.modelPriceVersion,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens,
    inputCostUsd,
    outputCostUsd,
    estimatedCostUsd,
    // Embedded rates for historical immutability (A2).
    inputCostPer1MUsd: registryEntry.inputCostPer1MUsd,
    outputCostPer1MUsd: registryEntry.outputCostPer1MUsd,
    effectiveDateIso: registryEntry.effectiveDateIso,
    calculatedAtIso,
    pricingSource: registryEntry.pricingSource,
    pricingVerifiedAtIso: registryEntry.pricingVerifiedAtIso,
    pricingVerificationStatus: 'verified',
    selectedModelId: selected,
    usedModelId: catalogModel.id,
  }
}

/**
 * Insert or replace the customer cost statement in report markdown metadata bullets.
 * @param {string} reportMarkdown
 * @param {object|null} runCost
 */
export function ensureRunCostStatementInReport(reportMarkdown, runCost) {
  const report = typeof reportMarkdown === 'string' ? reportMarkdown : ''
  const statement = formatRunCostCustomerStatement(runCost)
  const bullet = `- **Estimated model cost:** ${statement.replace(/^Estimated model cost:\s*/, '')}`
  const costLinePattern = /^- \*\*Estimated model cost:\*\*.*$/m

  if (costLinePattern.test(report)) {
    return report.replace(costLinePattern, bullet)
  }

  if (/^- \*\*Summary Risk:\*\*.*$/m.test(report)) {
    return report.replace(/^(- \*\*Summary Risk:\*\*.*)$/m, `$1\n${bullet}`)
  }
  if (/^- \*\*Generated:\*\*.*$/m.test(report)) {
    return report.replace(/^(- \*\*Generated:\*\*.*)$/m, `$1\n${bullet}`)
  }
  if (report.startsWith('#')) {
    const firstBreak = report.indexOf('\n')
    if (firstBreak !== -1) {
      return `${report.slice(0, firstBreak + 1)}${bullet}\n${report.slice(firstBreak + 1)}`
    }
  }
  return `${bullet}\n${report}`
}

/**
 * Recompute estimate from embedded rates (immutability / audit). Does not use current catalogue.
 * @param {object} runCost
 */
export function recomputeRunCostFromEmbeddedRates(runCost) {
  const normalized = normalizeRunCost(runCost)
  if (
    normalized.status !== RUN_COST_STATUS.ESTIMATED ||
    typeof normalized.inputTokens !== 'number' ||
    typeof normalized.outputTokens !== 'number' ||
    typeof normalized.inputCostPer1MUsd !== 'number' ||
    typeof normalized.outputCostPer1MUsd !== 'number'
  ) {
    return null
  }
  const inputCostUsd = roundUsd((normalized.inputTokens / 1_000_000) * normalized.inputCostPer1MUsd)
  const outputCostUsd = roundUsd((normalized.outputTokens / 1_000_000) * normalized.outputCostPer1MUsd)
  return roundUsd(inputCostUsd + outputCostUsd)
}
