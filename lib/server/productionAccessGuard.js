function isProductionRuntime() {
  return process.env.NODE_ENV === 'production'
}

function envFlag(name, fallback = false) {
  const raw = process.env[name]
  if (typeof raw !== 'string') return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false
  return fallback
}

function hasValidServerApiKey(req) {
  const configured = process.env.SECLENS_SERVER_API_KEY
  if (!configured || typeof configured !== 'string' || configured.trim().length === 0) {
    return false
  }
  const supplied = req.headers?.['x-seclens-key']
  if (!supplied || typeof supplied !== 'string') return false
  return supplied.trim() === configured.trim()
}

export function enforceProductionAccessGuard({ req, res, origin, isOriginAllowed }) {
  if (!isProductionRuntime()) return true

  if (hasValidServerApiKey(req)) return true

  const allowNoOriginInProd = envFlag('SECLENS_ALLOW_NO_ORIGIN_IN_PROD', false)
  if (!origin && !allowNoOriginInProd) {
    res.status(403).json({
      error:
        'Origin header is required in production. For trusted automation, configure SECLENS_SERVER_API_KEY and send x-seclens-key.',
    })
    return false
  }

  if (origin && !isOriginAllowed) {
    res.status(403).json({ error: 'CORS policy violation: Origin not allowed' })
    return false
  }

  return true
}
