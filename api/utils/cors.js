/**
 * CORS middleware for Vercel serverless functions
 * Strict origin allowlist - no wildcards
 */

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  // Add production domain here when deployed
  // 'https://your-domain.vercel.app',
])

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
  
  // If no origin (same-origin request), allow all (for local dev with proxy)
  if (!origin) {
    headers['Access-Control-Allow-Origin'] = '*'
    return headers
  }
  
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  
  return headers
}
