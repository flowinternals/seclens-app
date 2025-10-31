/**
 * Main analysis endpoint
 * POST /api/analyze
 */

import { rateLimit } from './utils/rateLimit.js'
import { corsHeaders } from './utils/cors.js'
import { fetchRepositoryContent } from './utils/github.js'
import { analyzeSecurity } from './utils/openai.js'
import { sanitizeLogData, sanitizeHeaders } from './utils/sanitizeLog.js'
import { sanitizeGitHubUrl, validateInput } from './utils/sanitize.js'

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
    const { repositoryUrl, githubToken } = req.body
    
    // Validate and sanitize GitHub URL
    if (!repositoryUrl || typeof repositoryUrl !== 'string') {
      return res.status(400).json({ error: 'Repository URL is required' })
    }
    
    const urlValidation = validateInput(repositoryUrl, { maxLength: 500 })
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error || 'Invalid repository URL format' })
    }
    
    // Sanitize GitHub URL using utility function
    const sanitizedUrl = sanitizeGitHubUrl(urlValidation.value)
    if (!sanitizedUrl) {
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
    try {
      report = await analyzeSecurity(repoData)
    } catch (error) {
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
    
    // Return success response
    return res.status(200).json({
      report,
      repository: {
        url: repoData.url,
        owner: repoData.owner,
        name: repoData.repo,
        language: repoData.language
      },
      timestamp: new Date().toISOString()
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
