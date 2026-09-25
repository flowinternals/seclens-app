/**
 * Logging sanitization utilities
 * Prevents sensitive data from being logged in production
 */

/**
 * Neutralize CR/LF (and cap length) so request-derived values cannot forge log lines.
 * Uses explicit `.replace` of `\r`/`\n` — the form CodeQL js/log-injection recognizes.
 * @param {unknown} value
 * @param {number} [maxLen=200]
 * @returns {string}
 */
export function sanitizeLogLine(value, maxLen = 200) {
  const raw = String(value ?? '')
  const singleLine = raw.replace(/\r/g, '').replace(/\n/g, '')
  if (singleLine.length <= maxLen) return singleLine
  return `${singleLine.slice(0, maxLen)}…`
}

/**
 * Safe one-line request summary for console logging.
 * @param {{ method?: unknown, url?: unknown }} req
 * @returns {string}
 */
export function formatSafeRequestLogLine(req) {
  const method = sanitizeLogLine(req?.method || 'UNKNOWN', 16)
  const url = sanitizeLogLine(req?.url || '', 200)
  return `${method} ${url}`
}

/**
 * Sanitizes request headers to remove sensitive information
 * @param {object} headers - Request headers object
 * @returns {object} Sanitized headers object
 */
export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {}
  
  const sensitiveHeaders = [
    'authorization',
    'authorization',
    'x-api-key',
    'api-key',
    'x-auth-token',
    'cookie',
    'set-cookie',
    'github-token',
    'github_api_token',
    'openai-api-key',
    'openai_api_key'
  ]
  
  const sanitized = { ...headers }
  
  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase()
    if (sensitiveHeaders.some(header => lowerKey.includes(header))) {
      sanitized[key] = '[REDACTED]'
    }
  }
  
  return sanitized
}

/**
 * Sanitizes request body to remove sensitive fields
 * @param {object} body - Request body object
 * @returns {object} Sanitized body object
 */
export function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return {}
  
  const sensitiveFields = [
    'githubToken',
    'github_token',
    'apiKey',
    'api_key',
    'token',
    'password',
    'secret',
    'authorization'
  ]
  
  const sanitized = { ...body }
  
  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase()
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      sanitized[key] = '[REDACTED]'
    }
  }
  
  return sanitized
}

/**
 * Sanitizes log data for safe logging
 * Removes sensitive information from request objects
 * @param {object} data - Data to sanitize
 * @returns {object} Sanitized data
 */
export function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') return data
  
  const sanitized = { ...data }
  
  if (sanitized.headers) {
    sanitized.headers = sanitizeHeaders(sanitized.headers)
  }
  
  if (sanitized.body) {
    sanitized.body = sanitizeBody(sanitized.body)
  }
  
  // Sanitize nested objects
  for (const key of Object.keys(sanitized)) {
    if (sanitized[key] && typeof sanitized[key] === 'object') {
      const lowerKey = key.toLowerCase()
      if (lowerKey.includes('header') || lowerKey.includes('req')) {
        sanitized[key] = sanitizeHeaders(sanitized[key])
      }
    }
  }
  
  return sanitized
}

/**
 * Sanitizes error messages for client responses
 * Removes stack traces and sensitive details in production
 * @param {Error} error - Error object
 * @returns {object} Sanitized error response
 */
export function sanitizeErrorResponse(error) {
  const isDev = process.env.NODE_ENV === 'development'
  
  const response = {
    error: 'An unexpected error occurred. Please try again later.'
  }
  
  if (isDev) {
    response.details = error?.message || 'Unknown error'
    response.stack = error?.stack
  }
  
  return response
}

