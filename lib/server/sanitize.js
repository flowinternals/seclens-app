/**
 * Server-side sanitization utilities for API endpoints
 * Uses isomorphic-sanitize-fork or manual sanitization for Node.js environment
 */

/**
 * Sanitizes HTML content to prevent XSS attacks (server-side)
 * Uses manual HTML escaping since DOMPurify requires DOM environment
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML string
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return ''
  
  // Escape HTML metacharacters without over-encoding normal prose.
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitizes plain text to prevent XSS attacks
 * Escapes HTML special characters
 * @param {string} text - Text string to sanitize
 * @returns {string} Sanitized text string
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') return ''
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Validates GitHub repository URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid GitHub URL format
 */
export function isValidGitHubUrl(url) {
  if (!url || typeof url !== 'string') return false
  
  const githubUrlPattern =
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/tree\/(?:[A-Za-z0-9._/-]+))?\/?$/
  return githubUrlPattern.test(url.trim())
}

function isSafeGitRef(ref) {
  if (!ref || typeof ref !== 'string') return false
  const trimmed = ref.trim()
  if (!trimmed || trimmed.length > 255) return false
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return false
  if (trimmed.includes('..') || trimmed.includes('@{') || trimmed.includes('\\')) return false
  if (trimmed.endsWith('.lock') || /\s/.test(trimmed)) return false
  return /^[A-Za-z0-9._/-]+$/.test(trimmed)
}

/**
 * Sanitizes a GitHub URL by extracting and validating the repository path
 * @param {string} url - GitHub URL to sanitize
 * @returns {string|null} Sanitized URL or null if invalid
 */
export function sanitizeGitHubUrl(url) {
  if (!url || typeof url !== 'string') return null
  
  const trimmed = url.trim()
  const unsafeTreeRefPattern = /\/tree\/[^?#]*(\.\.|@{|\\|\s)/
  if (unsafeTreeRefPattern.test(trimmed)) return null

  const normalized = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    return null
  }

  if (parsed.hostname !== 'github.com') return null

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, '')
  let sanitized = `https://github.com/${owner}/${repo}`

  if (segments[2] === 'tree' && segments.length >= 4) {
    const ref = decodeURIComponent(segments.slice(3).join('/'))
    if (!isSafeGitRef(ref)) return null
    sanitized = `${sanitized}/tree/${ref}`
  }
  
  // Validate the sanitized URL
  if (isValidGitHubUrl(sanitized)) {
    return sanitized
  }
  
  return null
}

/**
 * Sanitizes markdown content for safe display
 * Removes potentially dangerous HTML/script tags
 * @param {string} markdown - Markdown string to sanitize
 * @returns {string} Sanitized markdown string
 */
export function sanitizeMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return ''
  
  // Remove script tags and other dangerous elements
  return markdown
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
}

/**
 * Sanitizes object properties recursively
 * Useful for sanitizing API response data
 * @param {any} data - Data to sanitize
 * @returns {any} Sanitized data
 */
export function sanitizeObject(data) {
  if (typeof data === 'string') {
    return sanitizeText(data)
  }
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizeObject(item))
  }
  
  if (data && typeof data === 'object') {
    const sanitized = {}
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        sanitized[key] = sanitizeObject(data[key])
      }
    }
    return sanitized
  }
  
  return data
}

/**
 * Validates and sanitizes user input
 * @param {string} input - User input string
 * @param {object} options - Validation options
 * @returns {object} Validation result with sanitized value
 */
export function validateInput(input, options = {}) {
  const {
    maxLength = 10000,
    allowEmpty = false,
    trim = true
  } = options
  
  if (!input || typeof input !== 'string') {
    return { valid: allowEmpty, value: '', error: 'Input must be a string' }
  }
  
  let processed = input
  if (trim) {
    processed = processed.trim()
  }
  
  if (!allowEmpty && processed.length === 0) {
    return { valid: false, value: '', error: 'Input cannot be empty' }
  }
  
  if (processed.length > maxLength) {
    return { valid: false, value: '', error: `Input exceeds maximum length of ${maxLength}` }
  }
  
  return {
    valid: true,
    value: sanitizeText(processed),
    originalLength: processed.length
  }
}

