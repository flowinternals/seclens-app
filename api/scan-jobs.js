import { corsHeaders } from '../lib/server/cors.js'
import { rateLimit } from '../lib/server/rateLimit.js'
import { createScanJob, getScanJobResponse, buildScanJobTelemetryCaps } from '../lib/server/scanJobs.js'
import { getOpenAIModelById } from '../lib/shared/openaiModels.js'
import { enforceProductionAccessGuard } from '../lib/server/productionAccessGuard.js'
import { authenticateRequest, buildTriggeredByProfile } from '../lib/server/adminAuth.js'
import { assertResourceOwner, logProtectedEndpointRejection, sendAuthFailureJson } from '../lib/server/apiAuth.js'
import { githubAccessFailureHttp } from '../lib/server/githubAccessHttp.js'
import { getFirebaseAdminDb } from '../lib/server/firebaseAdmin.js'
import { getPlanAwareIngestionCaps } from '../lib/server/ingestionCaps.js'
import { getUserSubscription } from '../lib/server/billing.js'
import { evaluateAdvisoryRunQuota, recordAdvisoryRunStart } from '../lib/server/advisoryUsage.js'

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

  if (req.method === 'POST') {
    const authResult = await authenticateRequest(req)
    if (!authResult.ok) {
      logProtectedEndpointRejection({
        req,
        endpoint: '/api/scan-jobs',
        statusCode: authResult.status || 401,
        reasonCode: authResult.reasonCode,
      })
      return sendAuthFailureJson(res, authResult)
    }

    const rateLimitResult = rateLimit(req, 5, 60 * 60 * 1000)
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
      })
    }

    const { repositoryUrl, githubToken, analysisModel } = req.body || {}
    const requestedAnalysisModel = typeof analysisModel === 'string' ? analysisModel.trim() : ''
    const resolvedRequestedModel = requestedAnalysisModel
      ? getOpenAIModelById(requestedAnalysisModel)?.id || null
      : null
    if (!repositoryUrl || typeof repositoryUrl !== 'string') {
      return res.status(400).json({ error: 'Repository URL is required' })
    }
    if (requestedAnalysisModel && !resolvedRequestedModel) {
      return res.status(400).json({
        error: `Invalid analysis model '${requestedAnalysisModel}'. Please reselect a supported model.`,
      })
    }

    try {
      const triggeredBy = await buildTriggeredByProfile(authResult)
      const db = getFirebaseAdminDb()
      let subscription = null
      let ingestionCaps = getPlanAwareIngestionCaps(null)
      if (triggeredBy?.uid && db) {
        subscription = await getUserSubscription(db, triggeredBy.uid)
        ingestionCaps = getPlanAwareIngestionCaps(subscription)
        const quota = await evaluateAdvisoryRunQuota(db, triggeredBy.uid, subscription)
        if (!quota.allowed) {
          return res.status(429).json({
            error:
              'Advisory run limit reached for your current plan over the rolling 30-day window. Upgrade, wait, or contact support.',
            quota,
          })
        }
      }

      const job = await createScanJob({
        repositoryUrl,
        githubToken: typeof githubToken === 'string' && githubToken.trim() ? githubToken.trim() : undefined,
        analysisModel: resolvedRequestedModel || undefined,
        requestedAnalysisModel: requestedAnalysisModel || null,
        triggeredBy,
        ingestionCaps,
      })

      if (triggeredBy?.uid && db) {
        try {
          await recordAdvisoryRunStart(db, triggeredBy.uid)
        } catch {
          // quota already evaluated; recording must not block accepted jobs
        }
      }

      return res.status(202).json({
        ...job,
        polling: {
          intervalMs: 1500,
        },
        caps: buildScanJobTelemetryCaps(),
      })
    } catch (error) {
      const { status, body } = githubAccessFailureHttp(error)
      return res.status(status).json(body)
    }
  }

  if (req.method === 'GET') {
    const pollAuth = await authenticateRequest(req)
    if (!pollAuth.ok) {
      logProtectedEndpointRejection({
        req,
        endpoint: '/api/scan-jobs',
        statusCode: pollAuth.status || 401,
        reasonCode: pollAuth.reasonCode,
      })
      return sendAuthFailureJson(res, pollAuth)
    }

    const jobId = typeof req.query?.jobId === 'string' ? req.query.jobId : null
    if (!jobId) {
      return res.status(400).json({ error: 'jobId query parameter is required' })
    }

    const job = getScanJobResponse(jobId)
    if (!job) {
      return res.status(404).json({ error: 'Scan job not found' })
    }

    const ownerUid = job.triggeredBy && typeof job.triggeredBy === 'object' ? job.triggeredBy.uid : null
    const ownerCheck = assertResourceOwner(pollAuth.uid, ownerUid)
    if (!ownerCheck.ok) {
      logProtectedEndpointRejection({
        req,
        endpoint: '/api/scan-jobs',
        statusCode: ownerCheck.status || 403,
        reasonCode: ownerCheck.reasonCode,
        authenticatedUserId: pollAuth.uid,
      })
      return sendAuthFailureJson(res, ownerCheck)
    }

    return res.status(200).json(job)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
