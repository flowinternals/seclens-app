/**
 * Client-safe runCost display helpers (no Node crypto / price registry imports).
 * CR-SECLENS-COST-001.
 */

export const RUN_COST_BASIS = 'estimated_provider_api_list_price'
export const RUN_COST_CURRENCY = 'USD'

export const RUN_COST_STATUS = Object.freeze({
  ESTIMATED: 'estimated',
  UNAVAILABLE: 'unavailable',
})

export const RUN_COST_REASON = Object.freeze({
  USAGE_MISSING: 'USAGE_MISSING',
  MODEL_UNKNOWN: 'MODEL_UNKNOWN',
  PRICING_UNKNOWN: 'PRICING_UNKNOWN',
  PRICING_STALE: 'PRICING_STALE',
  LEGACY: 'LEGACY',
  MODEL_SELECTED_USED_MISMATCH: 'MODEL_SELECTED_USED_MISMATCH',
})

/**
 * Format customer-facing USD estimate (5 decimal places).
 * @param {number} amount
 */
export function formatRunCostUsd(amount) {
  return `US$${Number(amount).toFixed(5)}`
}

/**
 * Legacy / missing adapter — never invent $0.00.
 * @param {object|null|undefined} runCost
 */
export function normalizeRunCost(runCost) {
  if (runCost && typeof runCost === 'object' && typeof runCost.status === 'string') {
    return runCost
  }
  return {
    currency: RUN_COST_CURRENCY,
    basis: RUN_COST_BASIS,
    status: RUN_COST_STATUS.UNAVAILABLE,
    reasonCode: RUN_COST_REASON.LEGACY,
    modelId: null,
    modelPriceVersion: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    inputCostUsd: null,
    outputCostUsd: null,
    estimatedCostUsd: null,
    inputCostPer1MUsd: null,
    outputCostPer1MUsd: null,
    calculatedAtIso: null,
    pricingSource: null,
    pricingVerifiedAtIso: null,
    pricingVerificationStatus: 'unknown',
  }
}

/**
 * Whether the UI/API may show a dollar amount (A6).
 * @param {object|null|undefined} runCost
 */
export function isRunCostAmountDisplayable(runCost) {
  const normalized = normalizeRunCost(runCost)
  return (
    normalized.status === RUN_COST_STATUS.ESTIMATED &&
    typeof normalized.estimatedCostUsd === 'number' &&
    Number.isFinite(normalized.estimatedCostUsd)
  )
}

/**
 * Approved customer-facing report/export wording (A7).
 * @param {object|null} runCost
 */
export function formatRunCostCustomerStatement(runCost) {
  const normalized = normalizeRunCost(runCost)
  if (!normalized || normalized.status !== RUN_COST_STATUS.ESTIMATED) {
    const modelId = normalized?.modelId || 'unknown'
    return `Estimated model cost: unavailable (estimated provider API list price for ${modelId}; not an invoice or statement of actual platform spend).`
  }
  return `Estimated model cost: ${formatRunCostUsd(normalized.estimatedCostUsd)} (estimated provider API list price for ${normalized.modelId}; not an invoice or statement of actual platform spend).`
}

/**
 * Short label for the completed-run cost strip.
 * @param {object|null|undefined} runCost
 */
export function formatRunCostStripPrimary(runCost) {
  const normalized = normalizeRunCost(runCost)
  if (isRunCostAmountDisplayable(normalized)) {
    return `Estimated model cost: ${formatRunCostUsd(normalized.estimatedCostUsd)}`
  }
  return 'Estimated model cost: unavailable'
}
