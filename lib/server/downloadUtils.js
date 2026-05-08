/**
 * Shared utilities for download endpoints (markdown, text, pdf)
 */

import { sanitizeMarkdown, sanitizeText } from './sanitize.js'

export const MANDATORY_EXPORT_DISCLAIMER =
  'SecLens is a repository security advisory tool. It does not prove the presence or absence of vulnerabilities. Recommendations, prompts and suggested tests are based on selected repository files and should be reviewed by a developer or security engineer before changes are made.'

const DISCLAIMER_SECTION_HEADING = '## Disclaimer'

export function appendMandatoryDisclaimer(markdown) {
  const base = typeof markdown === 'string' ? markdown.trim() : ''
  if (!base) {
    return `${DISCLAIMER_SECTION_HEADING}\n\n${MANDATORY_EXPORT_DISCLAIMER}`
  }
  if (base.includes(MANDATORY_EXPORT_DISCLAIMER)) {
    return base
  }
  return `${base}\n\n${DISCLAIMER_SECTION_HEADING}\n\n${MANDATORY_EXPORT_DISCLAIMER}`
}

/**
 * Generates a safe filename with project prefix and date stamp
 */
export function generateFilename(extension, repositoryName = 'report') {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const base = (repositoryName || 'report').toString()
  const sanitizedName = base.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  return `SecLens_${sanitizedName}_${timestamp}.${extension}`
}

/**
 * Sets common headers for file downloads
 */
export function setDownloadHeaders(res, contentType, filename) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

/**
 * Safely prepare markdown content for download
 */
export function prepareMarkdown(markdown) {
  return sanitizeMarkdown(appendMandatoryDisclaimer(markdown))
}

/**
 * Convert markdown to plaintext and sanitize for text/pdf outputs
 */
export function markdownToPlainText(markdown) {
  if (!markdown || typeof markdown !== 'string') return ''
  const plain = markdown
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^-\s+/gm, '- ')
    .replace(/^\d+\.\s+/gm, '')
  return sanitizeText(plain)
}

/**
 * Standardized error handler for download endpoints
 */
export function handleDownloadError(res, context, error) {
  const isDev = process.env.NODE_ENV === 'development'
  const message = context ? `${context} failed` : 'Operation failed'
  if (isDev) {
    console.error(message + ':', error?.message)
  } else {
    console.error(message)
  }
  return res.status(500).json({ error: message, code: 'DOWNLOAD_GENERATION_FAILED' })
}


