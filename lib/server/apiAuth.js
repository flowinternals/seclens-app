/**
 * Shared helpers for API auth hardening (CR-SECLENS-PIVOT-009).
 * Does not verify tokens - use authenticateRequest / authorizeAdminRequest in adminAuth.js.
 */

/**
 * Log rejected protected endpoint calls (no secrets, tokens, or bodies).
 * @param {object} params
 * @param {import('http').IncomingMessage} params.req
 * @param {string} [params.endpoint]
 * @param {string} [params.method]
 * @param {number} params.statusCode
 * @param {string} [params.reasonCode]
 * @param {string|null} [params.authenticatedUserId]
 * @param {string|null} [params.role]
 * @param {string|null} [params.requestId]
 */
export function logProtectedEndpointRejection({
  req,
  endpoint,
  method,
  statusCode,
  reasonCode,
  authenticatedUserId = null,
  role = null,
  requestId = null,
}) {
  const safe = {
    ts: new Date().toISOString(),
    endpoint: endpoint ?? req?.url,
    method: method ?? req?.method,
    statusCode,
    reasonCode: reasonCode ?? null,
    authenticatedUserId,
    role,
    requestId:
      requestId ??
      (typeof req?.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : null) ??
      (typeof req?.headers?.['x-vercel-id'] === 'string' ? req.headers['x-vercel-id'] : null),
  }
  console.warn('[seclens-api-auth]', JSON.stringify(safe))
}

/**
 * @param {string|null|undefined} requesterUid
 * @param {string|null|undefined} resourceOwnerUid
 */
export function assertResourceOwner(requesterUid, resourceOwnerUid) {
  const owner = typeof resourceOwnerUid === 'string' ? resourceOwnerUid.trim() : ''
  const requester = typeof requesterUid === 'string' ? requesterUid.trim() : ''
  if (!owner || !requester || owner !== requester) {
    return {
      ok: false,
      status: 403,
      error: 'Access denied.',
      reasonCode: 'RESOURCE_OWNER_MISMATCH',
    }
  }
  return { ok: true }
}

/**
 * @param {any} res
 * @param {{ ok: boolean, status?: number, error?: string, reasonCode?: string }} authResult
 */
export function sendAuthFailureJson(res, authResult) {
  const status = authResult.status ?? 401
  const payload = { error: authResult.error || 'Unauthorized' }
  if (authResult.reasonCode) payload.reasonCode = authResult.reasonCode
  return res.status(status).json(payload)
}
