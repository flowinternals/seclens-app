import { corsHeaders } from '../lib/server/cors.js'
import { rateLimit } from '../lib/server/rateLimit.js'
import { createScanJob, getScanJobResponse, buildScanJobTelemetryCaps } from '../lib/server/scanJobs.js'
import { getOpenAIModelById } from '../lib/shared/openaiModels.js'
import { enforceProductionAccessGuard } from '../lib/server/productionAccessGuard.js'

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
      const job = await createScanJob({
        repositoryUrl,
        githubToken: typeof githubToken === 'string' && githubToken.trim() ? githubToken.trim() : undefined,
        analysisModel: resolvedRequestedModel || undefined,
        requestedAnalysisModel: requestedAnalysisModel || null,
      })
      return res.status(202).json({
        ...job,
        polling: {
          intervalMs: 1500,
        },
        caps: buildScanJobTelemetryCaps(),
      })
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Could not create scan job',
      })
    }
  }

  if (req.method === 'GET') {
    const jobId = typeof req.query?.jobId === 'string' ? req.query.jobId : null
    if (!jobId) {
      return res.status(400).json({ error: 'jobId query parameter is required' })
    }

    const job = getScanJobResponse(jobId)
    if (!job) {
      return res.status(404).json({ error: 'Scan job not found' })
    }

    return res.status(200).json(job)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
