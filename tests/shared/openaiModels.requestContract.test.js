import { describe, expect, it } from 'vitest'
import {
  OPENAI_MODEL_CATALOG,
  OPENAI_CHAT_COMPLETION_REQUEST_FAMILY,
  assertOpenAIChatCompletionCreateParams,
  buildOpenAIChatCompletionCreateParams,
  classifyOpenAIChatCompletionRequestFamily,
  getOpenAIChatCompletionRequestContract,
  summarizeOpenAIChatCompletionRequestContract,
} from '../../lib/shared/openaiModels.js'

const SAMPLE_MESSAGES = [
  { role: 'system', content: 'Return JSON only.' },
  { role: 'user', content: 'Analyze the repository.' },
]

function catalogIdsByFamily(family) {
  return OPENAI_MODEL_CATALOG.filter(
    (model) => classifyOpenAIChatCompletionRequestFamily(model.id) === family
  ).map((model) => model.id)
}

describe('OpenAI Chat Completions request contracts', () => {
  it('classifies every catalog model into a known family', () => {
    for (const model of OPENAI_MODEL_CATALOG) {
      const family = classifyOpenAIChatCompletionRequestFamily(model.id)
      expect(Object.values(OPENAI_CHAT_COMPLETION_REQUEST_FAMILY)).toContain(family)
    }
  })

  it('builds GPT-5 / GPT-6 reasoning payloads with max_completion_tokens and no temperature', () => {
    const gpt5Ids = catalogIdsByFamily(OPENAI_CHAT_COMPLETION_REQUEST_FAMILY.GPT5_REASONING)
    expect(gpt5Ids.length).toBeGreaterThan(0)
    expect(gpt5Ids).toContain('gpt-5')
    expect(gpt5Ids).toContain('gpt-5.5')
    expect(gpt5Ids).toContain('gpt-6-astra')
    expect(gpt5Ids).toContain('gpt-6-sol')
    expect(gpt5Ids).toContain('gpt-6-luna')
    expect(gpt5Ids).toContain('gpt-5.6-sol')

    for (const modelId of gpt5Ids) {
      const params = buildOpenAIChatCompletionCreateParams({
        model: modelId,
        messages: SAMPLE_MESSAGES,
        maxOutputTokens: 6144,
        temperature: 0.1,
      })
      expect(params.model).toBe(modelId)
      expect(params).toHaveProperty('max_completion_tokens', 6144)
      expect(params).not.toHaveProperty('max_tokens')
      expect(params).not.toHaveProperty('temperature')
      expect(params.messages).toEqual(SAMPLE_MESSAGES)
    }
  })

  it('builds o-series payloads with max_completion_tokens and no temperature', () => {
    const oSeriesIds = catalogIdsByFamily(OPENAI_CHAT_COMPLETION_REQUEST_FAMILY.O_SERIES_REASONING)
    expect(oSeriesIds.length).toBeGreaterThan(0)
    expect(oSeriesIds).toContain('o1')
    expect(oSeriesIds).toContain('o4-mini')

    for (const modelId of oSeriesIds) {
      const params = buildOpenAIChatCompletionCreateParams({
        model: modelId,
        messages: SAMPLE_MESSAGES,
        maxOutputTokens: 4096,
        temperature: 0.1,
      })
      expect(params).toHaveProperty('max_completion_tokens', 4096)
      expect(params).not.toHaveProperty('max_tokens')
      expect(params).not.toHaveProperty('temperature')
    }
  })

  it('builds legacy chat payloads with max_tokens and temperature', () => {
    const legacyIds = catalogIdsByFamily(OPENAI_CHAT_COMPLETION_REQUEST_FAMILY.LEGACY_CHAT)
    expect(legacyIds.length).toBeGreaterThan(0)
    expect(legacyIds).toContain('gpt-4o-mini')
    expect(legacyIds).toContain('gpt-4.1')
    expect(legacyIds).toContain('gpt-4o')

    for (const modelId of legacyIds) {
      const params = buildOpenAIChatCompletionCreateParams({
        model: modelId,
        messages: SAMPLE_MESSAGES,
        maxOutputTokens: 6144,
        temperature: 0.1,
      })
      expect(params).toHaveProperty('max_tokens', 6144)
      expect(params).not.toHaveProperty('max_completion_tokens')
      expect(params).toHaveProperty('temperature', 0.1)
    }
  })

  it('summarizes request contracts for telemetry without secrets', () => {
    expect(summarizeOpenAIChatCompletionRequestContract('gpt-5')).toEqual({
      family: OPENAI_CHAT_COMPLETION_REQUEST_FAMILY.GPT5_REASONING,
      outputTokenParam: 'max_completion_tokens',
      temperatureMode: 'model_default_only',
    })
    expect(summarizeOpenAIChatCompletionRequestContract('gpt-4o-mini')).toEqual({
      family: OPENAI_CHAT_COMPLETION_REQUEST_FAMILY.LEGACY_CHAT,
      outputTokenParam: 'max_tokens',
      temperatureMode: 'custom',
    })
  })

  it('rejects the prior GPT-5 4xx payload shape locally before a network call', () => {
    // Historical OpenAI 4xx:
    // Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.
    expect(() =>
      assertOpenAIChatCompletionCreateParams({
        model: 'gpt-5',
        messages: SAMPLE_MESSAGES,
        max_tokens: 6144,
        temperature: 0.1,
      })
    ).toThrow(/max_tokens is not supported.*max_completion_tokens.*gpt5_reasoning/i)
  })

  it('rejects GPT-5 payloads that only fix max_tokens but still send custom temperature', () => {
    // Historical OpenAI 4xx:
    // Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported.
    expect(() =>
      assertOpenAIChatCompletionCreateParams({
        model: 'gpt-5-mini',
        messages: SAMPLE_MESSAGES,
        max_completion_tokens: 2048,
        temperature: 0.1,
      })
    ).toThrow(/custom temperature is not supported.*gpt5_reasoning/i)
  })

  it('exposes contract metadata matching built payloads', () => {
    const gpt5 = getOpenAIChatCompletionRequestContract('gpt-5')
    expect(gpt5.outputTokenParam).toBe('max_completion_tokens')
    expect(gpt5.supportsCustomTemperature).toBe(false)

    const legacy = getOpenAIChatCompletionRequestContract('gpt-4o')
    expect(legacy.outputTokenParam).toBe('max_tokens')
    expect(legacy.supportsCustomTemperature).toBe(true)
  })
})
