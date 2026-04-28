/**
 * Simple reusable validators for API inputs
 */

export function validateString(value, { required = true, maxLength = 10000, trim = true } = {}) {
  if (value == null) {
    return required ? { valid: false, error: 'Value is required' } : { valid: true, value: '' }
  }
  if (typeof value !== 'string') {
    return { valid: false, error: 'Value must be a string' }
  }
  let v = trim ? value.trim() : value
  if (required && v.length === 0) {
    return { valid: false, error: 'Value cannot be empty' }
  }
  if (v.length > maxLength) {
    return { valid: false, error: `Value exceeds maximum length of ${maxLength}` }
  }
  return { valid: true, value: v }
}

export function validateRepoName(name, { maxLength = 200 } = {}) {
  const res = validateString(name, { required: false, maxLength })
  if (!res.valid) return res
  if (!res.value) return { valid: true, value: '' }
  // Allow alphanumerics, dash, underscore, dot
  const ok = /^[a-z0-9._-]+$/i.test(res.value)
  return ok ? { valid: true, value: res.value } : { valid: false, error: 'Repository name contains invalid characters' }
}

export function validateGitHubUrl(url) {
  const res = validateString(url, { required: true, maxLength: 500 })
  if (!res.valid) return res
  const pattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/
  return pattern.test(res.value)
    ? { valid: true, value: res.value }
    : { valid: false, error: 'Invalid GitHub repository URL format' }
}


