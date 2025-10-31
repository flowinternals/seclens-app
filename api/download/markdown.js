/**
 * Markdown download endpoint
 * POST /api/download/markdown
 */

import { corsHeaders } from '../utils/cors.js'

// Helper to sanitize markdown content
function sanitizeMarkdown(content) {
  if (!content || typeof content !== 'string') return ''
  // Remove potentially dangerous HTML/script tags while preserving markdown
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
}

// Generate filename with timestamp
function generateFilename(format, repositoryName = 'report') {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const sanitizedName = repositoryName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  return `SecLens_${sanitizedName}_${timestamp}.${format}`
}

export default async function handler(req, res) {
  const origin = req.headers.origin
  const headers = corsHeaders(origin)
  
  // Set CORS headers
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value)
  })
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  try {
    const { report, repository } = req.body
    
    if (!report || typeof report !== 'string') {
      return res.status(400).json({ error: 'Report content is required' })
    }
    
    // Sanitize markdown content
    const sanitizedReport = sanitizeMarkdown(report)
    const filename = generateFilename('md', repository?.name || 'report')
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    
    return res.status(200).send(sanitizedReport)
  } catch (error) {
    console.error('Markdown download error:', error)
    return res.status(500).json({ error: 'Failed to generate markdown file' })
  }
}
