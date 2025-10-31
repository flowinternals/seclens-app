/**
 * Rate limiting middleware for Vercel serverless functions
 * Uses in-memory storage (resets on cold start)
 * For production, consider using Redis or Vercel KV
 */

const rateLimitMap = new Map()

function getRateLimitKey(ip) {
  const now = Date.now()
  const hour = Math.floor(now / (1000 * 60 * 60)) // Hour bucket
  return `${ip}:${hour}`
}

export function rateLimit(req, maxRequests = 5, windowMs = 60 * 60 * 1000) {
  // Handle both Express and Vercel request formats
  const headers = req.headers || {}
  const ip = headers['x-forwarded-for']?.split(',')[0]?.trim() || 
             headers['x-real-ip'] || 
             headers['x-forwarded-for'] || 
             req.socket?.remoteAddress ||
             req.ip ||
             'unknown'
  
  const key = getRateLimitKey(ip)
  const now = Date.now()
  
  // Clean up old entries (older than 2 hours)
  const cutoff = now - (2 * windowMs)
  for (const [k, v] of rateLimitMap.entries()) {
    if (v.timestamp < cutoff) {
      rateLimitMap.delete(k)
    }
  }
  
  const current = rateLimitMap.get(key)
  
  if (!current) {
    rateLimitMap.set(key, { count: 1, timestamp: now })
    return { allowed: true, remaining: maxRequests - 1 }
  }
  
  if (current.count >= maxRequests) {
    return { 
      allowed: false, 
      remaining: 0,
      resetTime: current.timestamp + windowMs
    }
  }
  
  current.count++
  return { 
    allowed: true, 
    remaining: maxRequests - current.count,
    resetTime: current.timestamp + windowMs
  }
}
