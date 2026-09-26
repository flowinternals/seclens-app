/**
 * Immutable OpenAI model price registry (CR-SECLENS-COST-001).
 * Catalogue rates stay on OPENAI_MODEL_CATALOG; governance lives here.
 */

import { createHash } from 'node:crypto'
import { OPENAI_MODEL_CATALOG } from './openaiModels.js'

/** Days after which a verified price row is treated as stale (quarterly review). */
export const PRICE_FRESHNESS_WINDOW_DAYS = 90

export const PRICING_SOURCE_OPENAI_API_LIST = 'openai_api_docs_pricing_standard_short_context'

/**
 * Explicit production-enabled allowlist (A3). Initially all selectable catalogue models.
 * New catalogue entries must be added here intentionally before the CI freshness gate passes.
 */
export const PRODUCTION_ENABLED_MODEL_IDS = Object.freeze(OPENAI_MODEL_CATALOG.map((model) => model.id))

/**
 * Canonical serialization for modelPriceVersion (A2 content hash).
 * @param {{ modelId: string, inputCostPer1MUsd: number, outputCostPer1MUsd: number, effectiveDateIso: string, pricingSource: string }} row
 */
export function serializePriceRowForVersion(row) {
  return [
    String(row.modelId || '').trim(),
    Number(row.inputCostPer1MUsd).toFixed(6),
    Number(row.outputCostPer1MUsd).toFixed(6),
    String(row.effectiveDateIso || '').trim(),
    String(row.pricingSource || '').trim(),
  ].join('|')
}

/**
 * Deterministic content-hash price version id.
 * @param {{ modelId: string, inputCostPer1MUsd: number, outputCostPer1MUsd: number, effectiveDateIso: string, pricingSource: string }} row
 */
export function computeModelPriceVersion(row) {
  return createHash('sha256').update(serializePriceRowForVersion(row), 'utf8').digest('hex').slice(0, 16)
}

/**
 * Seed registry rows from the current catalogue with verification metadata.
 * Immutable snapshots: when catalogue rates change, add a new row (do not rewrite history).
 */
function buildInitialRegistryEntries() {
  const effectiveDateIso = '2026-09-26'
  const pricingVerifiedAtIso = '2026-09-26T00:00:00.000Z'
  const pricingSource = PRICING_SOURCE_OPENAI_API_LIST

  return OPENAI_MODEL_CATALOG.map((model) => {
    const base = {
      modelId: model.id,
      inputCostPer1MUsd: model.inputCostPer1MUsd,
      outputCostPer1MUsd: model.outputCostPer1MUsd,
      effectiveDateIso,
      pricingSource,
    }
    return Object.freeze({
      ...base,
      modelPriceVersion: computeModelPriceVersion(base),
      pricingVerifiedAtIso,
      pricingVerificationStatus: 'verified',
      reviewer: 'catalog-seed-2026-09-26',
    })
  })
}

/** @type {ReadonlyArray<Readonly<{
 *   modelId: string,
 *   inputCostPer1MUsd: number,
 *   outputCostPer1MUsd: number,
 *   effectiveDateIso: string,
 *   pricingSource: string,
 *   modelPriceVersion: string,
 *   pricingVerifiedAtIso: string,
 *   pricingVerificationStatus: 'verified'|'stale'|'unknown',
 *   reviewer: string,
 * }>>} */
export const OPENAI_MODEL_PRICE_REGISTRY = Object.freeze(buildInitialRegistryEntries())

export function getPriceRegistryEntriesForModel(modelId) {
  const id = String(modelId || '').trim()
  if (!id) return []
  return OPENAI_MODEL_PRICE_REGISTRY.filter((entry) => entry.modelId === id)
}

/**
 * Resolve the registry row that matches catalogue rates for a model id.
 * @returns {typeof OPENAI_MODEL_PRICE_REGISTRY[number] | null}
 */
export function resolvePriceRegistryEntryForCatalogRates(modelId, inputCostPer1MUsd, outputCostPer1MUsd) {
  const id = String(modelId || '').trim()
  if (!id) return null
  const matches = getPriceRegistryEntriesForModel(id).filter(
    (entry) =>
      Number(entry.inputCostPer1MUsd) === Number(inputCostPer1MUsd) &&
      Number(entry.outputCostPer1MUsd) === Number(outputCostPer1MUsd)
  )
  if (matches.length === 0) return null
  // Prefer the most recently verified matching row.
  return matches.slice().sort((a, b) => String(b.pricingVerifiedAtIso).localeCompare(String(a.pricingVerifiedAtIso)))[0]
}

export function isPriceVerificationFresh(pricingVerifiedAtIso, nowMs = Date.now()) {
  if (!pricingVerifiedAtIso) return false
  const verifiedMs = Date.parse(pricingVerifiedAtIso)
  if (!Number.isFinite(verifiedMs)) return false
  const maxAgeMs = PRICE_FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return nowMs - verifiedMs <= maxAgeMs
}

export function evaluateRegistryFreshness(entry, nowMs = Date.now()) {
  if (!entry) {
    return { status: 'unknown', reasonCode: 'PRICING_UNKNOWN' }
  }
  if (entry.pricingVerificationStatus === 'unknown') {
    return { status: 'unknown', reasonCode: 'PRICING_UNKNOWN' }
  }
  if (entry.pricingVerificationStatus === 'stale' || !isPriceVerificationFresh(entry.pricingVerifiedAtIso, nowMs)) {
    return { status: 'stale', reasonCode: 'PRICING_STALE' }
  }
  return { status: 'verified', reasonCode: null }
}
