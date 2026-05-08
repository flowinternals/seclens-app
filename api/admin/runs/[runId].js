import { corsHeaders } from '../../../lib/server/cors.js'
import { authorizeAdminRequest } from '../../../lib/server/adminAuth.js'
import { logProtectedEndpointRejection, sendAuthFailureJson } from '../../../lib/server/apiAuth.js'
import { deleteScanJob, getScanJobResponse } from '../../../lib/server/scanJobs.js'
import { enforceProductionAccessGuard } from '../../../lib/server/productionAccessGuard.js'
import { mergePersistedRunWithInMemoryJob } from '../../../lib/server/adminRunMerge.js'
import { deleteRunById, getRunById } from '../../../lib/server/runTelemetryStore.js'

function resolveRunId(req) {
  if (typeof req.query?.runId === 'string' && req.query.runId.trim()) {
    return req.query.runId.trim()
  }
  const parts = String(req.url || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
  const runsIdx = parts.indexOf('runs')
  if (runsIdx >= 0 && parts[runsIdx + 1]) {
    return parts[runsIdx + 1]
  }
  return null
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

  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authResult = await authorizeAdminRequest(req)
  if (!authResult.ok) {
    logProtectedEndpointRejection({
      req,
      endpoint: '/api/admin/runs/[runId]',
      statusCode: authResult.status || 403,
      reasonCode: authResult.reasonCode,
      authenticatedUserId: authResult.uid ?? null,
    })
    return sendAuthFailureJson(res, authResult)
  }

  const runId = resolveRunId(req)
  if (!runId) {
    return res.status(400).json({ error: 'runId is required' })
  }

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
