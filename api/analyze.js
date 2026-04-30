/**
 * Main analysis endpoint
 * POST /api/analyze
 */

import { rateLimit } from '../lib/server/rateLimit.js'
import { corsHeaders } from '../lib/server/cors.js'
import { fetchRepositoryContent } from '../lib/server/github.js'
import { analyzeSecurity } from '../lib/server/openai.js'
import { sanitizeLogData, sanitizeHeaders } from '../lib/server/sanitizeLog.js'
import { sanitizeGitHubUrl } from '../lib/server/sanitize.js'
import { ReportQualityGateError } from '../lib/server/reportQualityGateError.js'
import { getIngestionCaps } from '../lib/server/ingestionCaps.js'

/** OpenAI usage → safe telemetry fragment (no extra provider fields). */
function normalizeUsageFragment(usage) {
  if (!usage) return null
  return {
    prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completion_tokens:
      typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
  }
}

function estimateUsageCostUsd(totalUsage) {
  const promptTokens = typeof totalUsage?.prompt_tokens === 'number' ? totalUsage.prompt_tokens : 0
  const completionTokens =
    typeof totalUsage?.completion_tokens === 'number' ? totalUsage.completion_tokens : 0

  // Planning assumption used by launch-readiness telemetry logs.
  const inputCost = (promptTokens / 1_000_000) * 0.15
  const outputCost = (completionTokens / 1_000_000) * 0.60
  return Number((inputCost + outputCost).toFixed(5))
}

function deriveScanProfileName(caps) {
  const k = `${caps.maxFiles}/${caps.maxBytesPerFile}/${caps.maxTotalBytes}/${caps.maxTreeEntries}`
  const knownProfiles = {
    '40/4000/60000/5000': 'stage02-baseline-40/4k/60k',
    '120/8000/300000/50000': 'stage02-default-120/8k/300k',
    '200/12000/420000/100000': 'stage02-experimental-200/12k/420k',
    '250/12000/500000/150000': 'stage02-burn-250/12k/500k',
    '320/20000/900000/150000': 'stage02-expanded-320/20k/900k',
  }
  return knownProfiles[k] || 'custom'
}

function buildTelemetry(analysisResult, repoData, startedAtMs) {
  const draft =
    normalizeUsageFragment(analysisResult.tokenUsage?.draft) ||
    ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
  const critic = normalizeUsageFragment(analysisResult.tokenUsage?.critic)
  const rawTotal = analysisResult.tokenUsage?.total || {}
  const total = {
    prompt_tokens: typeof rawTotal.prompt_tokens === 'number' ? rawTotal.prompt_tokens : 0,
    completion_tokens:
      typeof rawTotal.completion_tokens === 'number' ? rawTotal.completion_tokens : 0,
    total_tokens: typeof rawTotal.total_tokens === 'number' ? rawTotal.total_tokens : 0,
  }
  const caps = getIngestionCaps()
  const elapsedMs = Math.max(0, Date.now() - startedAtMs)
  const coverage = repoData?.evidenceBundle?.coverage || null
  const inventory = repoData?.evidenceBundle?.inventory || null
  const selectedEvidenceCount =
    typeof repoData?.ingestion?.selectedFileCount === 'number'
      ? repoData.ingestion.selectedFileCount
      : Array.isArray(repoData?.evidenceBundle?.evidence)
        ? repoData.evidenceBundle.evidence.length
        : null
  const totalEvidenceBytes = Array.isArray(repoData?.evidenceBundle?.evidence)
    ? repoData.evidenceBundle.evidence.reduce((acc, ev) => {
        const text = ev?.snippets?.[0]?.text || ''
        return acc + Buffer.byteLength(text, 'utf8')
      }, 0)
    : null

  return {
    correlationId: analysisResult.correlationId,
    profile: deriveScanProfileName(caps),
    caps: {
      maxFiles: caps.maxFiles,
      maxBytesPerFile: caps.maxBytesPerFile,
      maxTotalEvidenceBytes: caps.maxTotalBytes,
      maxTreeEntries: caps.maxTreeEntries,
    },
    duration: {
      elapsedMs,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
    },
    estimatedCostUsd: estimateUsageCostUsd(total),
    criticRepairRan: !!analysisResult.reportValidation?.repairedAfterCritic,
    ingestion: {
      strategyVersion: repoData?.ingestion?.strategyVersion ?? null,
      selectedFileCount: repoData?.ingestion?.selectedFileCount ?? null,
      omittedFileCount: repoData?.ingestion?.omittedFileCount ?? null,
      capHits: Array.isArray(repoData?.ingestion?.capHits) ? repoData.ingestion.capHits : [],
      coverageSummary: repoData?.ingestion?.coverageSummary ?? null,
      selectedReasonCounts: repoData?.ingestion?.selectedReasonCounts ?? null,
      anchorCount: repoData?.ingestion?.anchorCount ?? null,
      relatedContextCount: repoData?.ingestion?.relatedContextCount ?? null,
      backfillCount: repoData?.ingestion?.backfillCount ?? null,
      plannedSelectedReasonCounts: repoData?.ingestion?.plannedSelectedReasonCounts ?? null,
      plannedAnchorCount: repoData?.ingestion?.plannedAnchorCount ?? null,
      plannedRelatedContextCount: repoData?.ingestion?.plannedRelatedContextCount ?? null,
      plannedBackfillCount: repoData?.ingestion?.plannedBackfillCount ?? null,
      domainReservationCount: repoData?.ingestion?.domainReservationCount ?? null,
      domainReservationByDomain: repoData?.ingestion?.domainReservationByDomain ?? null,
      plannedDomainReservationCount: repoData?.ingestion?.plannedDomainReservationCount ?? null,
      plannedDomainReservationByDomain: repoData?.ingestion?.plannedDomainReservationByDomain ?? null,
      totalEvidenceBytes,
      coverage: coverage
        ? {
            maxFilesCapHit: !!coverage.maxFilesCapHit,
            maxBytesPerFileCapHit: !!coverage.maxBytesPerFileCapHit,
            maxTotalBytesCapHit: !!coverage.maxTotalBytesCapHit,
            maxTreeSizeCapHit: !!coverage.maxTreeSizeCapHit,
          }
        : null,
      inventory: inventory
        ? {
            totalFilesSeen: inventory.totalFilesSeen,
            filesSelected:
              typeof selectedEvidenceCount === 'number' ? selectedEvidenceCount : inventory.filesSelected,
            filesOmitted: inventory.filesOmitted,
          }
        : null,
    },
    tokenUsage: {
      draft,
      critic,
      total,
    },
    initialValidationCategories: analysisResult.reportValidation?.initialValidationCategories || [],
    finalValidationCategories: analysisResult.reportValidation?.finalValidationCategories || [],
    normalizersApplied: analysisResult.reportValidation?.normalizersApplied || [],
    candidateCounts: analysisResult.reportValidation?.structuredTelemetry?.candidateCounts || null,
    admittedCounts: analysisResult.reportValidation?.structuredTelemetry?.admittedCounts || null,
    rejectionReasonCounts: analysisResult.reportValidation?.structuredTelemetry?.rejectionReasonCounts || null,
    candidateCountByTopic: analysisResult.reportValidation?.structuredTelemetry?.candidateCountByTopic || null,
    rejectedCitationIntegrityCount:
      analysisResult.reportValidation?.structuredTelemetry?.rejectedCitationIntegrityCount || 0,
    templateVersion: analysisResult.reportValidation?.structuredTelemetry?.templateVersion || null,
    renderMode: analysisResult.reportValidation?.structuredTelemetry?.renderMode || null,
    markdownRenderMode: analysisResult.reportValidation?.structuredTelemetry?.markdownRenderMode || null,
    appendixEvidenceCount: analysisResult.reportValidation?.structuredTelemetry?.appendixEvidenceCount ?? null,
    appendixRenderedCount: analysisResult.reportValidation?.structuredTelemetry?.appendixRenderedCount ?? null,
    appendixTruncated: !!analysisResult.reportValidation?.structuredTelemetry?.appendixTruncated,
    representedDomainCount: analysisResult.reportValidation?.structuredTelemetry?.representedDomainCount ?? null,
    requiredInspectedSurfaceRows:
      analysisResult.reportValidation?.structuredTelemetry?.requiredInspectedSurfaceRows ?? null,
    inspectedSurfaceCounts:
      analysisResult.reportValidation?.structuredTelemetry?.inspectedSurfaceCounts ?? null,
    inspectedSurfaceCountByTopic:
      analysisResult.reportValidation?.structuredTelemetry?.inspectedSurfaceCountByTopic || null,
    inspectedSurfaceSpecificityRate:
      analysisResult.reportValidation?.structuredTelemetry?.inspectedSurfaceSpecificityRate ?? null,
    placeholderSectionCount:
      analysisResult.reportValidation?.structuredTelemetry?.placeholderSectionCount ?? null,
    genericRecommendationCount:
      analysisResult.reportValidation?.structuredTelemetry?.genericRecommendationCount ?? null,
    repoSpecificSectionCount:
      analysisResult.reportValidation?.structuredTelemetry?.repoSpecificSectionCount ?? null,
    reportValueScore: analysisResult.reportValidation?.structuredTelemetry?.reportValueScore ?? null,
    reportValueGatePassed:
      !!analysisResult.reportValidation?.structuredTelemetry?.reportValueGatePassed,
    recommendationTypeCounts:
      analysisResult.reportValidation?.structuredTelemetry?.recommendationTypeCounts || null,
    analysisPassCount: analysisResult.reportValidation?.structuredTelemetry?.analysisPassCount ?? null,
    analysisPasses: analysisResult.reportValidation?.structuredTelemetry?.analysisPasses || null,
    passTypeCounts: analysisResult.reportValidation?.structuredTelemetry?.passTypeCounts || null,
    passEvidenceCounts: analysisResult.reportValidation?.structuredTelemetry?.passEvidenceCounts || null,
    passTrimmedEvidenceCounts:
      analysisResult.reportValidation?.structuredTelemetry?.passTrimmedEvidenceCounts || null,
    passPromptEstimatedTokens:
      analysisResult.reportValidation?.structuredTelemetry?.passPromptEstimatedTokens || null,
    passPromptAvailableInputTokens:
      analysisResult.reportValidation?.structuredTelemetry?.passPromptAvailableInputTokens || null,
    candidateCountsByPass: analysisResult.reportValidation?.structuredTelemetry?.candidateCountsByPass || null,
    admittedCountsByPass: analysisResult.reportValidation?.structuredTelemetry?.admittedCountsByPass || null,
    observedControlCount: analysisResult.reportValidation?.structuredTelemetry?.observedControlCount ?? null,
    unverifiedControlCount:
      analysisResult.reportValidation?.structuredTelemetry?.unverifiedControlCount ?? null,
    reportSynthesisDedupedFindingCount:
      analysisResult.reportValidation?.structuredTelemetry?.reportSynthesisDedupedFindingCount ?? null,
    reportSynthesisDedupedRecommendationCount:
      analysisResult.reportValidation?.structuredTelemetry?.reportSynthesisDedupedRecommendationCount ?? null,
    clusterInventory: analysisResult.reportValidation?.structuredTelemetry?.clusterInventory || null,
    clusterSkipReasons: analysisResult.reportValidation?.structuredTelemetry?.clusterSkipReasons || null,
    sectionContentByTopicCounts:
      analysisResult.reportValidation?.structuredTelemetry?.sectionContentByTopicCounts || null,
    downscopedObservationCount:
      analysisResult.reportValidation?.structuredTelemetry?.downscopedObservationCount ?? null,
    lowInformationReport: !!analysisResult.reportValidation?.structuredTelemetry?.lowInformationReport,
    usedNoFindingsTemplate: !!analysisResult.reportValidation?.structuredTelemetry?.usedNoFindingsTemplate,
  }
}

export default async function handler(req, res) {
  // Sanitized logging - no sensitive data in production
  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    console.log('=== ANALYZE HANDLER CALLED ===')
    console.log('Method:', req.method)
    console.log('URL:', req.url)
    console.log('Has body:', !!req.body)
    const sanitized = sanitizeLogData({ body: req.body, headers: req.headers })
    console.log('Body (sanitized):', sanitized.body)
    console.log('Origin:', sanitizeHeaders(req.headers)['origin'] || 'none')
  } else {
    // Minimal logging in production
    console.log(`[${req.method}] ${req.url}`)
  }
  
  // Ensure we always send a response
  let responseSent = false
  const requestStartedAtMs = Date.now()
  
  try {
    const origin = req.headers?.origin || req.headers?.['origin']
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      const headers = corsHeaders(origin)
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value)
      })
      return res.status(204).end()
    }
    
    // Check CORS - allow requests from same origin (no origin header) or allowed origins
    const headers = corsHeaders(origin)
    
    // If no origin header (same-origin request from proxy), allow only in development
    if (!origin) {
      if (process.env.NODE_ENV === 'development') {
        // Same-origin request (likely from Vite proxy), allow it in dev only
        res.setHeader('Access-Control-Allow-Origin', '*')
      }
      Object.entries(headers).forEach(([key, value]) => {
        if (key !== 'Access-Control-Allow-Origin') {
          res.setHeader(key, value)
        }
      })
    } else if (origin && !headers['Access-Control-Allow-Origin']) {
      // Origin provided but not in allowlist
      console.error('CORS violation - origin not allowed')
      if (process.env.NODE_ENV === 'development') {
        console.error('Origin:', origin)
      }
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value)
      })
      return res.status(403).json({ error: 'CORS policy violation: Origin not allowed' })
    } else {
      // Origin is in allowlist
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value)
      })
    }
    
    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    
    console.log('Processing POST request...')
    // Rate limiting
    const rateLimitResult = rateLimit(req, 5, 60 * 60 * 1000) // 5 requests per hour
    
    if (!rateLimitResult.allowed) {
      const resetTime = new Date(rateLimitResult.resetTime).toISOString()
      const retryAfter = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
      res.setHeader('Retry-After', retryAfter.toString())
      res.setHeader('X-RateLimit-Limit', '5')
      res.setHeader('X-RateLimit-Remaining', '0')
      res.setHeader('X-RateLimit-Reset', resetTime)
      return res.status(429).json({ 
        error: 'Too many requests. Please try again later.',
        retryAfter
      })
    }
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', '5')
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString())
    
    // Validate request body
    const { repositoryUrl, githubToken } = req.body || {}
    
    // Debug logging for production issues
    if (!isDev) {
      console.log('Request body type:', typeof req.body)
      console.log('Request body keys:', req.body ? Object.keys(req.body) : 'no body')
      console.log('repositoryUrl type:', typeof repositoryUrl)
      console.log('repositoryUrl value:', repositoryUrl ? repositoryUrl.substring(0, 100) : 'null/undefined')
    }
    
    // Validate and sanitize GitHub URL
    if (!repositoryUrl || typeof repositoryUrl !== 'string') {
      if (!isDev) {
        console.error('Invalid repositoryUrl:', { type: typeof repositoryUrl, value: repositoryUrl })
      }
      return res.status(400).json({ error: 'Repository URL is required' })
    }
    
    // Validate input length (but don't HTML-escape URLs - that breaks them)
    let trimmedUrl = repositoryUrl.trim()
    
    // Handle potential URL encoding issues
    try {
      // Decode URL if it's encoded (but keep original if decode fails)
      const decoded = decodeURIComponent(trimmedUrl)
      if (decoded !== trimmedUrl && decoded.includes('github.com')) {
        trimmedUrl = decoded
      }
    } catch {
      // If decoding fails, use original URL
      if (!isDev) {
        console.log('URL decode attempt failed, using original')
      }
    }
    
    if (trimmedUrl.length === 0) {
      return res.status(400).json({ error: 'Repository URL cannot be empty' })
    }
    if (trimmedUrl.length > 500) {
      return res.status(400).json({ error: 'Repository URL exceeds maximum length of 500 characters' })
    }
    
    // Sanitize GitHub URL using utility function (use original trimmed URL, not HTML-escaped)
    const sanitizedUrl = sanitizeGitHubUrl(trimmedUrl)
    if (!sanitizedUrl) {
      if (!isDev) {
        console.error('sanitizeGitHubUrl failed for:', trimmedUrl.substring(0, 100))
        console.error('URL length:', trimmedUrl.length)
        console.error('URL char codes:', Array.from(trimmedUrl.substring(0, 50)).map(c => c.charCodeAt(0)))
      }
      return res.status(400).json({ error: 'Invalid GitHub repository URL format' })
    }
    
    // Normalize githubToken: empty string becomes undefined
    const normalizedToken = (githubToken && typeof githubToken === 'string' && githubToken.trim()) 
      ? githubToken.trim() 
      : undefined
    
    // Fetch repository content
    let repoData
    try {
      repoData = await fetchRepositoryContent(sanitizedUrl, { githubToken: normalizedToken })
    } catch (error) {
      // Log error details only in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Repository fetch error:', error.message)
      } else {
        console.error('Repository fetch error: Failed to fetch repository')
      }
      
      // Specific private/permission errors
      const msg = error.message || ''
      if (msg.includes('private') || msg.includes('access is denied') || msg.includes('403')) {
        return res.status(403).json({ 
          error: 'Access to repository denied. Ensure the token has repo read access to this repository.'
        })
      }
      if (msg.includes('invalid or expired (401)') || msg.includes('401')) {
        return res.status(401).json({ 
          error: 'GitHub token invalid or expired.'
        })
      }
      if (msg.includes('not found')) {
        return res.status(404).json({ error: 'Repository not found.' })
      }
      if (error.code === 'BRANCH_REF_RESOLUTION_FAILED') {
        return res.status(422).json({
          error:
            'SecLens can access the repository metadata, but could not resolve the selected branch/ref. Check that the branch exists and, for private repositories, that the token has Contents: Read-only permission.',
          ...(process.env.NODE_ENV === 'development' && {
            details: {
              selectedRef: error.ref || null,
              resolutionAttempts: Array.isArray(error.attempts) ? error.attempts : [],
            },
          }),
        })
      }
      
      return res.status(500).json({ 
        error: 'An error occurred while fetching the repository. Please try again later.',
        ...(process.env.NODE_ENV === 'development' && { 
          details: error.message,
          stack: error.stack 
        })
      })
    }
    
    // Analyze security
    let report
    let reportContractVersion
    let reportValidation
    let analysisResult
    try {
      analysisResult = await analyzeSecurity(repoData)
      report = analysisResult.report
      reportContractVersion = analysisResult.reportContractVersion
      reportValidation = analysisResult.reportValidation
    } catch (error) {
      if (error instanceof ReportQualityGateError) {
        const categories = error.categories.join(',')
        console.error(
          `[ReportQualityGate] correlationId=${error.correlationId} categories=${categories}`
        )
        return res.status(422).json({
          error: 'The report failed SecLens quality checks. Please retry the scan.',
          code: error.code,
          correlationId: error.correlationId,
          categories: error.categories,
          ...(process.env.NODE_ENV === 'development' && {
            details: `Validation categories: ${categories}`,
          }),
        })
      }

      // Log error details only in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Security analysis error:', error.message)
        console.error('Error name:', error.name)
        console.error('Error stack:', error.stack)
      } else {
        console.error('Security analysis error: Analysis failed')
      }
      
      // Generic error messages
      if (error.message.includes('API key')) {
        return res.status(500).json({ 
          error: 'An error occurred while analyzing the repository. Please try again later.',
          ...(process.env.NODE_ENV === 'development' && { 
            details: error.message,
            stack: error.stack 
          })
        })
      }
      
      if (error.message.includes('rate limit')) {
        return res.status(503).json({ 
          error: 'Service temporarily unavailable. Please try again later.',
          ...(process.env.NODE_ENV === 'development' && { 
            details: error.message,
            stack: error.stack 
          })
        })
      }
      
      return res.status(500).json({ 
        error: 'An error occurred while analyzing the repository. Please try again later.',
        ...(process.env.NODE_ENV === 'development' && { 
          details: error.message,
          stack: error.stack 
        })
      })
    }
    
    // Return success response (telemetry: manual testing / cost planning only; no persistence)
    return res.status(200).json({
      report,
      reportContractVersion,
      reportValidation,
      telemetry: buildTelemetry(analysisResult, repoData, requestStartedAtMs),
      ...(analysisResult.dashboard ? { dashboard: analysisResult.dashboard } : {}),
      repository: {
        url: repoData.url,
        owner: repoData.owner,
        name: repoData.repo,
        language: repoData.language,
        ...(repoData.defaultBranch != null && { defaultBranch: repoData.defaultBranch }),
        ...(repoData.scannedRef != null && { scannedRef: repoData.scannedRef }),
        ...(repoData.scannedSha != null && { scannedSha: repoData.scannedSha }),
      },
      ...(repoData.ingestion != null && { ingestion: repoData.ingestion }),
      timestamp: new Date().toISOString(),
    })
    
  } catch (error) {
    // Log error details only in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Unexpected error in analyze handler:', error.message)
      console.error('Error name:', error.name)
      console.error('Error stack:', error.stack)
    } else {
      console.error('Unexpected error in analyze handler')
    }
    
    // Ensure we send a response even if something goes wrong
    try {
      const origin = req.headers?.origin || req.headers?.['origin']
      const errorHeaders = corsHeaders(origin)
      Object.entries(errorHeaders).forEach(([key, value]) => {
        try {
          res.setHeader(key, value)
        } catch (headerError) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Error setting header:', key, headerError.message)
          }
        }
      })
      
      if (!res.headersSent && !responseSent) {
        responseSent = true
        res.status(500).json({ 
          error: 'An unexpected error occurred. Please try again later.',
          ...(process.env.NODE_ENV === 'development' && { 
            details: error.message,
            stack: error.stack 
          })
        })
      }
    } catch (responseError) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error sending error response:', responseError.message)
        console.error('Response error stack:', responseError.stack)
      }
      // Last resort - try to send a basic response
      if (!res.headersSent && !responseSent) {
        try {
          responseSent = true
          res.status(500).json({ error: 'Internal server error' })
        } catch (finalError) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Failed to send final error response:', finalError.message)
          }
        }
      }
    }
  }
}
