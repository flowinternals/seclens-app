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

/** True if the string begins with http:// or https:// (any letter case). */
function hasHttpOrHttpsSchemePrefix(trimmed) {
  return /^https?:\/\//i.test(trimmed)
}

/**
 * True if the value parses as a URL with hostname exactly `github.com` (not subdomains or suffix tricks).
 * Avoids incomplete substring checks for trust decisions.
 */
export function isGitHubComHostUrlString(url) {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  const normalized =
    hasHttpOrHttpsSchemePrefix(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(normalized).hostname === 'github.com'
  } catch {
    return false
  }
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

  const normalized =
    hasHttpOrHttpsSchemePrefix(trimmed) ? trimmed : `https://${trimmed}`
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

const ALLOWED_MARKDOWN_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function decodeCommonUrlEntityObfuscation(s) {
  let t = s
    .replace(/&#x3a;/gi, ':')
    .replace(/&#58;/g, ':')
    .replace(/&colon;/gi, ':')
  t = t.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _
    try {
      return String.fromCodePoint(code)
    } catch {
      return _
    }
  })
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, h) => {
    const code = parseInt(h, 16)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _
    try {
      return String.fromCodePoint(code)
    } catch {
      return _
    }
  })
  return t
}

/**
 * @param {string} markdown
 * @param {number} closeBracketIdx Index of `]` in `](url)`
 * @returns {{ urlStart: number, urlEnd: number, closeParenEnd: number } | null}
 */
function findMarkdownInlineLinkUrlBounds(markdown, closeBracketIdx) {
  const urlStart = closeBracketIdx + 2
  if (urlStart >= markdown.length) return null
  if (markdown[urlStart] === '<') {
    const gt = markdown.indexOf('>', urlStart)
    if (gt === -1) return null
    if (gt + 1 >= markdown.length || markdown[gt + 1] !== ')') return null
    return { urlStart: urlStart + 1, urlEnd: gt, closeParenEnd: gt + 2 }
  }
  let depth = 0
  let j = urlStart
  while (j < markdown.length) {
    const c = markdown[j]
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) return { urlStart, urlEnd: j, closeParenEnd: j + 1 }
      depth--
    }
    j++
  }
  return null
}

/**
 * @param {string} raw
 * @returns {boolean} True if the URL target uses a disallowed or dangerous scheme.
 */
function markdownUrlTargetIsBlocked(raw) {
  const decoded = decodeCommonUrlEntityObfuscation(raw.trim())
  if (!decoded) return false

  const colon = decoded.indexOf(':')
  if (colon !== -1) {
    const schemeName = decoded.slice(0, colon).replace(/\s+/g, '').toLowerCase()
    if (schemeName === 'javascript' || schemeName === 'vbscript' || schemeName === 'data') {
      return true
    }
  }

  if (
    (decoded.startsWith('/') && !decoded.startsWith('//')) ||
    decoded.startsWith('./') ||
    decoded.startsWith('../') ||
    decoded.startsWith('#')
  ) {
    return false
  }

  try {
    const u = decoded.startsWith('//') ? new URL(`https:${decoded}`) : new URL(decoded)
    return !ALLOWED_MARKDOWN_URL_PROTOCOLS.has(u.protocol.toLowerCase())
  } catch {
    return false
  }
}

function neutralizeBlockedMarkdownUrlTargets(markdown) {
  let out = ''
  let i = 0
  while (i < markdown.length) {
    const linkClose = markdown.indexOf('](', i)
    if (linkClose === -1) {
      out += markdown.slice(i)
      break
    }
    const bounds = findMarkdownInlineLinkUrlBounds(markdown, linkClose)
    if (!bounds) {
      out += markdown.slice(i, linkClose + 2)
      i = linkClose + 2
      continue
    }
    const url = markdown.slice(bounds.urlStart, bounds.urlEnd)
    if (markdownUrlTargetIsBlocked(url)) {
      out += markdown.slice(i, linkClose + 1)
      out += '(#)'
      i = bounds.closeParenEnd
    } else {
      out += markdown.slice(i, bounds.closeParenEnd)
      i = bounds.closeParenEnd
    }
  }

  out = out.replace(
    /(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']*)\2/gi,
    (full, pre, q, url) => (markdownUrlTargetIsBlocked(url) ? `${pre}${q}#${q}` : full)
  )
  out = out.replace(
    /(<a\b[^>]*\bhref\s*=\s*)([^\s>"']+)(?=[\s>])/gi,
    (full, pre, url) => (markdownUrlTargetIsBlocked(url) ? `${pre}#` : full)
  )
  out = out.replace(
    /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']*)\2/gi,
    (full, pre, q, url) => (markdownUrlTargetIsBlocked(url) ? `${pre}${q}#${q}` : full)
  )
  out = out.replace(
    /(<img\b[^>]*\bsrc\s*=\s*)([^\s>"']+)(?=[\s>])/gi,
    (full, pre, url) => (markdownUrlTargetIsBlocked(url) ? `${pre}#` : full)
  )
  return out
}

/**
 * Sanitizes markdown content for safe display
 * Removes potentially dangerous HTML/script tags
 * @param {string} markdown - Markdown string to sanitize
 * @returns {string} Sanitized markdown string
 */
export function sanitizeMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return ''

  let out = markdown
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
  out = neutralizeBlockedMarkdownUrlTargets(out)
  return out.replace(/on\w+\s*=/gi, '')
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

