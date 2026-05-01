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
import { buildScanJobLifecycleTelemetry, buildTelemetry } from '../lib/server/scanTelemetryPayload.js'
import { tryAppendScanTelemetryLog } from '../lib/server/scanTelemetryLogAppend.js'

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
    const { repositoryUrl, githubToken, analysisModel } = req.body || {}
    
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
      analysisResult = await analyzeSecurity(repoData, { analysisModel })
      report = analysisResult.report
      reportContractVersion = analysisResult.reportContractVersion
      reportValidation = analysisResult.reportValidation
    } catch (error) {
      if (error instanceof ReportQualityGateError) {
        const categories = error.categories.join(',')
        console.error(
          `[ReportQualityGate] correlationId=${error.correlationId} categories=${categories}`
        )
        tryAppendScanTelemetryLog({
          analysisResult: {
            correlationId: error.correlationId,
            analysisModel: analysisModel || null,
            requestedAnalysisModel: analysisModel || null,
          },
          repoData,
          requestStartedAtMs,
          gateError: { categories: error.categories },
        })
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

      tryAppendScanTelemetryLog({
        analysisResult: {
          analysisModel: analysisModel || null,
          requestedAnalysisModel: analysisModel || null,
        },
        repoData,
        requestStartedAtMs,
        analysisError: error instanceof Error ? error : new Error(String(error)),
      })

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
    
    tryAppendScanTelemetryLog({
      analysisResult,
      repoData,
      requestStartedAtMs,
    })

    // Return success response (includes telemetry JSON; merge lifecycle so GUI runs match scan-job contract — DEFECT-004)
    const telemetryPayload = buildTelemetry(analysisResult, repoData, requestStartedAtMs)
    const lifecycle = buildScanJobLifecycleTelemetry({
      outcome: 'completed',
      dashboard: analysisResult.dashboard ?? null,
      correlationId: analysisResult.correlationId ?? null,
      analysisModel: analysisResult.analysisModel ?? analysisModel ?? null,
    })
    return res.status(200).json({
      report,
      reportContractVersion,
      reportValidation,
      telemetry: { ...lifecycle, ...telemetryPayload },
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
