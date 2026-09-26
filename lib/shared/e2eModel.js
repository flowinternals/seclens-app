import { getOpenAIModelById, OPENAI_MODEL_CATALOG } from '../shared/openaiModels.js'

/**
 * Cheapest catalog model by input+output list price (development / e2e default).
 * @returns {{ id: string, inputCostPer1MUsd: number, outputCostPer1MUsd: number }}
 */
export function getCheapestOpenAIModel() {
  let best = null
  for (const model of OPENAI_MODEL_CATALOG) {
    const score =
      Number(model.inputCostPer1MUsd || 0) + Number(model.outputCostPer1MUsd || 0)
    if (!best || score < best.score) {
      best = { model, score }
    }
  }
  return best?.model || getOpenAIModelById('gpt-5-nano')
}

export function getCheapestOpenAIModelId() {
  return getCheapestOpenAIModel()?.id || 'gpt-5-nano'
}

/**
 * Resolve expected e2e analysis model: SECLENS_E2E_MODEL override or cheapest catalog id.
 * Fails closed on unknown override (caller must not start a paid scan).
 * @param {{ overrideModelId?: string|null, env?: Record<string, string|undefined> }} [opts]
 * @returns {{ ok: true, requestedModel: string, source: 'override'|'cheapest' } | { ok: false, requestedModel: string, error: string }}
 */
export function resolveExpectedE2EModel(opts = {}) {
  const env = opts.env || process.env
  const override =
    (typeof opts.overrideModelId === 'string' && opts.overrideModelId.trim()) ||
    (typeof env.SECLENS_E2E_MODEL === 'string' && env.SECLENS_E2E_MODEL.trim()) ||
    ''
  if (override) {
    const found = getOpenAIModelById(override)
    if (!found) {
      return {
        ok: false,
        requestedModel: override,
        error: `Unknown or unsupported SECLENS_E2E_MODEL "${override}" — not in OpenAI catalog.`,
      }
    }
    return { ok: true, requestedModel: found.id, source: 'override' }
  }
  const cheapest = getCheapestOpenAIModelId()
  const found = getOpenAIModelById(cheapest)
  if (!found) {
    return {
      ok: false,
      requestedModel: cheapest,
      error: `Cheapest model id "${cheapest}" is not resolvable in catalog.`,
    }
  }
  return { ok: true, requestedModel: found.id, source: 'cheapest' }
}
