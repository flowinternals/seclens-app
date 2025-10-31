/**
 * Text download endpoint
 * POST /api/download/text
 */

import { corsHeaders } from '../utils/cors.js'

// Sanitize text content
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
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
    
    // Convert markdown to plain text (strip markdown syntax)
    const plainText = report
      .replace(/^#+\s+/gm, '') // Remove headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/`(.*?)`/g, '$1') // Remove inline code
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove links, keep text
      .replace(/^-\s+/gm, '• ') // Convert list items
      .replace(/^\d+\.\s+/gm, '') // Remove numbered list markers
    
    // Sanitize text content
    const sanitizedText = sanitizeText(plainText)
    const filename = generateFilename('txt', repository?.name || 'report')
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    
    return res.status(200).send(sanitizedText)
  } catch (error) {
    console.error('Text download error:', error)
    return res.status(500).json({ error: 'Failed to generate text file' })
  }
}

