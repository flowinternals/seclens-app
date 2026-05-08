import { corsHeaders } from '../../../../lib/server/cors.js'
import { authorizeAdminRequest } from '../../../../lib/server/adminAuth.js'
import { logProtectedEndpointRejection, sendAuthFailureJson } from '../../../../lib/server/apiAuth.js'
import { getScanJobResponse } from '../../../../lib/server/scanJobs.js'
import { enforceProductionAccessGuard } from '../../../../lib/server/productionAccessGuard.js'
import { mergePersistedRunWithInMemoryJob } from '../../../../lib/server/adminRunMerge.js'
import { getRunById } from '../../../../lib/server/runTelemetryStore.js'
import { buildRunPostMortem } from '../../../../lib/server/runPostMortem.js'

function resolveRunIdFromPath(req) {
  if (typeof req.query?.runId === 'string' && req.query.runId.trim()) {
    return req.query.runId.trim()
  }
  const parts = String(req.url || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
  const runsIdx = parts.indexOf('runs')
  if (runsIdx >= 0 && parts[runsIdx + 1] && parts[runsIdx + 1] !== 'post-mortem') {
    return parts[runsIdx + 1]
  }
  return parts.length ? parts[parts.length - 2] : null
}

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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authResult = await authorizeAdminRequest(req)
  if (!authResult.ok) {
    logProtectedEndpointRejection({
      req,
      endpoint: '/api/admin/runs/[runId]/post-mortem',
      statusCode: authResult.status || 403,
      reasonCode: authResult.reasonCode,
      authenticatedUserId: authResult.uid ?? null,
    })
    return sendAuthFailureJson(res, authResult)
  }

  const runId = resolveRunIdFromPath(req)
  if (!runId) {
    return res.status(400).json({ error: 'runId is required' })
  }

  const persistedRun = await getRunById(runId)
  const memoryRun = getScanJobResponse(runId)
  const run = mergePersistedRunWithInMemoryJob(persistedRun, memoryRun)
  if (!run) {
    return res.status(404).json({ error: 'Run not found' })
  }

  const postMortem = buildRunPostMortem(run)

  return res.status(200).json({
    postMortem,
    requestedBy: authResult.uid,
  })
}
