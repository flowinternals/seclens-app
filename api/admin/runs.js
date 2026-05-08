import { corsHeaders } from '../../lib/server/cors.js'
import { authorizeAdminRequest } from '../../lib/server/adminAuth.js'
import { logProtectedEndpointRejection, sendAuthFailureJson } from '../../lib/server/apiAuth.js'
import { listRecentScanJobs } from '../../lib/server/scanJobs.js'
import { enforceProductionAccessGuard } from '../../lib/server/productionAccessGuard.js'
import { listRecentRuns } from '../../lib/server/runTelemetryStore.js'

export default async function handler(req, res) {
  const origin = req.headers?.origin || req.headers?.['origin']
  const headers = corsHeaders(origin)
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== 'Access-Control-Allow-Origin' || value) {
      res.setHeader(key, value)
    }
  })
  const isOriginAllowed = Boolean(headers['Access-Control-Allow-Origin'])

  if (!enforceProductionAccessGuard({ req, res, origin, isOriginAllowed })) {
    return
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authResult = await authorizeAdminRequest(req)
  if (!authResult.ok) {
    logProtectedEndpointRejection({
      req,
      endpoint: '/api/admin/runs',
      statusCode: authResult.status || 403,
      reasonCode: authResult.reasonCode,
      authenticatedUserId: authResult.uid ?? null,
    })
    return sendAuthFailureJson(res, authResult)
  }

  const persistedRuns = await listRecentRuns(50)
  const runs = persistedRuns.length > 0 ? persistedRuns : listRecentScanJobs(50)
  return res.status(200).json({
    runs,
    count: runs.length,
    requestedBy: authResult.uid,
  })
}
