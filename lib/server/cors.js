/**
 * CORS middleware for Vercel serverless functions
 * Strict origin allowlist - no wildcards
 * Configured via CORS_ALLOWLIST environment variable (comma-separated origins)
 */

// Build allowed origins from environment variable with fallback for development
function getAllowedOrigins() {
  const envAllowlist = process.env.CORS_ALLOWLIST
  
  if (envAllowlist) {
    // Parse comma-separated list from environment variable
    return new Set(
      envAllowlist
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    )
  }
  
  // Fallback to localhost origins for development only
  if (process.env.NODE_ENV === 'development') {
    return new Set([
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ])
  }
  
  // Production must have CORS_ALLOWLIST set - return empty set to deny all
  return new Set()
}

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
  
  const allowedOrigins = getAllowedOrigins()
  
  // If no origin (same-origin request), allow only in development
  if (!origin) {
    if (process.env.NODE_ENV === 'development') {
      headers['Access-Control-Allow-Origin'] = '*'
    }
    return headers
  }
  
  // Check if origin is in allowlist
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  
  return headers
}
