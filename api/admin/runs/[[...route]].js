import { corsHeaders } from '../../../lib/server/cors.js'
import { authorizeAdminRequest } from '../../../lib/server/adminAuth.js'
import { logProtectedEndpointRejection, sendAuthFailureJson } from '../../../lib/server/apiAuth.js'
import { deleteScanJob, getScanJobResponse, listRecentScanJobs } from '../../../lib/server/scanJobs.js'
import { enforceProductionAccessGuard } from '../../../lib/server/productionAccessGuard.js'
import { mergePersistedRunWithInMemoryJob } from '../../../lib/server/adminRunMerge.js'
import { buildRunPostMortem } from '../../../lib/server/runPostMortem.js'
import { deleteRunById, getRunById, listRecentRuns } from '../../../lib/server/runTelemetryStore.js'

function getRouteParts(req) {
  if (Array.isArray(req.query?.route)) {
    return req.query.route.filter((part) => typeof part === 'string' && part.trim())
  }
  if (typeof req.query?.route === 'string' && req.query.route.trim()) {
    return [req.query.route.trim()]
  }

  const parts = String(req.url || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
  const runsIdx = parts.indexOf('runs')
  if (runsIdx < 0) return []
  return parts.slice(runsIdx + 1)
}

function endpointLabel(parts) {
  if (parts.length === 0) return '/api/admin/runs'
  if (parts.length === 1) return '/api/admin/runs/[runId]'
  return '/api/admin/runs/[runId]/post-mortem'
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

  const parts = getRouteParts(req)
  const endpoint = endpointLabel(parts)

  const authResult = await authorizeAdminRequest(req)
  if (!authResult.ok) {
    logProtectedEndpointRejection({
      req,
      endpoint,
      statusCode: authResult.status || 403,
      reasonCode: authResult.reasonCode,
      authenticatedUserId: authResult.uid ?? null,
    })
    return sendAuthFailureJson(res, authResult)
  }

  // GET /api/admin/runs
  if (parts.length === 0 && req.method === 'GET') {
    const persistedRuns = await listRecentRuns(50)
    const runs = persistedRuns.length > 0 ? persistedRuns : listRecentScanJobs(50)
    return res.status(200).json({
      runs,
      count: runs.length,
      requestedBy: authResult.uid,
    })
  }

  const runId = typeof parts[0] === 'string' && parts[0].trim() ? parts[0].trim() : null
  if (!runId) {
    return res.status(400).json({ error: 'runId is required' })
  }

  // POST /api/admin/runs/:runId/post-mortem
  if (parts[1] === 'post-mortem') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
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

  // GET /api/admin/runs/:runId
  if (req.method === 'GET') {
    const persistedRun = await getRunById(runId)
    const memoryRun = getScanJobResponse(runId)
    const run = mergePersistedRunWithInMemoryJob(persistedRun, memoryRun)
    if (!run) {
      return res.status(404).json({ error: 'Run not found' })
    }
    return res.status(200).json({
      run,
      requestedBy: authResult.uid,
    })
  }

  // DELETE /api/admin/runs/:runId
  if (req.method === 'DELETE') {
    const persistedRun = await getRunById(runId)
    const memoryRun = getScanJobResponse(runId)
    if (!persistedRun && !memoryRun) {
      return res.status(404).json({ error: 'Run not found' })
    }

    const persistResult = await deleteRunById(runId)
    const removedMemory = deleteScanJob(runId)

    const persistedDeleted = persistResult.deleted === true
    const inMemoryDeleted = removedMemory === true

    if (!persistedDeleted && !inMemoryDeleted) {
      return res.status(404).json({ error: 'Run not found' })
    }

    return res.status(200).json({
      ok: true,
      runId,
      deleted: {
        persisted: persistedDeleted,
        inMemory: inMemoryDeleted,
      },
      requestedBy: authResult.uid,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
