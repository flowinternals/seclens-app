/**
 * OpenAI client — contract v2 draft, validation, optional critic repair.
 */

import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { OUTPUT_CONTRACT_VERSION, buildContractInstructions } from '../prompts/seclens-output-contract-v2.js'
import { buildEvidenceRules } from '../prompts/seclens-evidence-rules-v1.js'
import { buildPhasedAnalysisInstructions } from '../prompts/seclens-phased-analysis-v1.js'
import { buildCriticSystemPrompt, buildCriticUserPrompt } from '../prompts/seclens-critic-rubric-v1.js'
import { validateReport, redactLeakagePatterns } from './reportValidation.js'
import { ReportQualityGateError } from './reportQualityGateError.js'

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

/** §13 A11 */
function isCriticEnabled() {
  const v = process.env.SECLENS_CRITIC_ENABLED
  if (v === 'true') return true
  if (v === 'false') return false
  return process.env.NODE_ENV !== 'development'
}

function analysisModel() {
  return process.env.SECLENS_ANALYSIS_MODEL || 'gpt-4o-mini'
}

function criticModel() {
  return process.env.SECLENS_CRITIC_MODEL || analysisModel()
}

function maxAnalysisTokens() {
  const raw = parseInt(process.env.SECLENS_MAX_ANALYSIS_TOKENS || '8192', 10)
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1024), 16384) : 8192
}

function maxCriticTokens() {
  const raw = parseInt(process.env.SECLENS_MAX_CRITIC_TOKENS || '8192', 10)
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1024), 16384) : 8192
}

function buildCoverageBlock(repoData) {
  const paths = repoData.files.map((f) => f.path).join(', ')
  return `Scan coverage for this analysis:
- Repository URL: ${repoData.url || 'unknown'}
- Owner/name: ${repoData.owner}/${repoData.repo}
- Generated timestamp: ${new Date().toISOString()}
- Files included (${repoData.files.length}): ${paths || '(none)'}
- Ref: unknown unless provided by ingestion (Stage 02 will improve this).
- Each file excerpt may be truncated (e.g. first 2000 characters). Do not claim full-file or full-repository review; state limitations in Confidence & Coverage.`
}

/**
 * Runs repository security analysis with output contract v2 validation.
 * @returns {Promise<{ report: string, reportContractVersion: string, reportValidation: { ok: boolean, repairedAfterCritic: boolean }, correlationId: string, tokenUsage: { draft: object|null, critic: object|null, total: { prompt_tokens: number, completion_tokens: number, total_tokens: number } } }>}
 */
export async function analyzeSecurity(repoData) {
  const correlationId = randomUUID()

  if (!repoData?.files || !Array.isArray(repoData.files)) {
    throw new Error('Invalid repository data: files array is missing or invalid')
  }

  const client = getOpenAIClient()

  const userContent = `${buildCoverageBlock(repoData)}

${buildContractInstructions()}

${buildEvidenceRules()}

${buildPhasedAnalysisInstructions()}

Repository description: ${repoData.description || 'No description'}
Primary language: ${repoData.language || 'Unknown'}

Files and excerpts:
${repoData.files.length === 0 ? 'No files.' : repoData.files.map((f) => `### ${f.path}\n\`\`\`\n${String(f.content).slice(0, 2000)}\n\`\`\`\n`).join('\n---\n')}`

  let completion
  try {
    completion = await client.chat.completions.create({
      model: analysisModel(),
      messages: [
        {
          role: 'system',
          content:
            'You are SecLens, an AI-assisted repository security reviewer. Follow the user instructions exactly. Output a single Markdown document only — no surrounding commentary.',
        },
        { role: 'user', content: userContent },
      ],
      max_tokens: maxAnalysisTokens(),
      temperature: 0.25,
    })
  } catch (error) {
    throw mapOpenAIError(error)
  }

  let report = completion.choices[0]?.message?.content
  if (!report) {
    throw new Error('No response from OpenAI API')
  }

  const draftUsage = completion.usage || null
  let criticUsage = null
  let repairedAfterCritic = false
  let validation = validateReport(report)

  if (!validation.ok && isCriticEnabled()) {
    let draftForCritic = report
    if (validation.categories.includes('LEAKAGE')) {
      draftForCritic = redactLeakagePatterns(report)
    }

    try {
      const criticCompletion = await client.chat.completions.create({
        model: criticModel(),
        messages: [
          { role: 'system', content: buildCriticSystemPrompt() },
          {
            role: 'user',
            content: `${buildCriticUserPrompt({ failureCategories: validation.categories })}\n\n--- DRAFT ---\n\n${draftForCritic}`,
          },
        ],
        max_tokens: maxCriticTokens(),
        temperature: 0.1,
      })

      const repaired = criticCompletion.choices[0]?.message?.content
      criticUsage = criticCompletion.usage || null
      if (repaired && repaired.trim()) {
        report = repaired
        repairedAfterCritic = true
        validation = validateReport(report)
      }
    } catch (error) {
      throw mapOpenAIError(error)
    }
  }

  if (!validation.ok) {
    const cats = validation.categories.length ? validation.categories : ['UNKNOWN']
    throw new ReportQualityGateError('Report failed SecLens quality validation.', {
      correlationId,
      categories: cats,
    })
  }

  return {
    report,
    reportContractVersion: OUTPUT_CONTRACT_VERSION,
    reportValidation: {
      ok: true,
      repairedAfterCritic,
    },
    correlationId,
    tokenUsage: {
      draft: draftUsage,
      critic: criticUsage,
      total: sumUsage(draftUsage, criticUsage),
    },
  }
}

function sumUsage(...usages) {
  return usages.reduce(
    (acc, usage) => {
      if (!usage) return acc
      acc.prompt_tokens += usage.prompt_tokens || 0
      acc.completion_tokens += usage.completion_tokens || 0
      acc.total_tokens += usage.total_tokens || 0
      return acc
    },
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  )
}

function mapOpenAIError(error) {
  const status = error?.status
  if (status === 401) {
    return new Error('Invalid OpenAI API key')
  }
  if (status === 429) {
    return new Error('OpenAI API rate limit exceeded')
  }
  if (status === 500) {
    return new Error('OpenAI API server error')
  }
  return error instanceof Error ? error : new Error(String(error))
}
