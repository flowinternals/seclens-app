/**
 * Authenticated user scan-history APIs (CR-SECLENS-PIVOT-010).
 *
 * GET  /api/history
 * GET  /api/history/:runId
 * POST /api/history/:runId/download  { format: markdown|text|pdf }
 */

import { corsHeaders } from './cors.js'
import { authenticateRequest } from './adminAuth.js'
import { logProtectedEndpointRejection, sendAuthFailureJson } from './apiAuth.js'
import { enforceProductionAccessGuard } from './productionAccessGuard.js'
import { getFirebaseAdminDb } from './firebaseAdmin.js'
import { getUserSubscription } from './billing.js'
import {
  getUserScanHistoryArtifact,
  listUserScanHistory,
} from './scanHistoryStore.js'
import {
  appendMandatoryDisclaimer,
  generateFilename,
  handleDownloadError,
  markdownToPlainText,
  prepareMarkdown,
  setDownloadHeaders,
} from './downloadUtils.js'
import { renderReportPdfBuffer } from './renderReportPdf.js'
import { validatePdfExportText } from './downloadUtils.js'

function getRouteParts(req) {
  if (Array.isArray(req.query?.route)) {
    return req.query.route.filter((part) => typeof part === 'string' && part.trim())
  }
  if (typeof req.query?.route === 'string' && req.query.route.trim()) {
    return [req.query.route.trim()]
  }
  if (typeof req.query?.runId === 'string' && req.query.runId.trim()) {
    const parts = [req.query.runId.trim()]
    const path = String(req.url || '').split('?')[0]
    if (path.endsWith('/download') || path.includes('/download')) {
      parts.push('download')
    }
    return parts
  }

  const parts = String(req.url || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
  const historyIdx = parts.indexOf('history')
  if (historyIdx < 0) return []
  return parts.slice(historyIdx + 1)
}

function endpointLabel(parts) {
  if (parts.length === 0) return '/api/history'
  if (parts.length === 1) return '/api/history/[runId]'
  return '/api/history/[runId]/download'
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

  const authResult = await authenticateRequest(req)
  if (!authResult.ok) {
    logProtectedEndpointRejection({
      req,
      endpoint,
      statusCode: authResult.status || 401,
      reasonCode: authResult.reasonCode,
    })
    return sendAuthFailureJson(res, authResult)
  }

  const uid = authResult.uid
  const db = getFirebaseAdminDb()
  const subscription = db ? await getUserSubscription(db, uid) : { plan: 'free', status: 'none' }

  // GET /api/history — metadata only (no Storage downloads)
  if (parts.length === 0 && req.method === 'GET') {
    const { runs, retention } = await listUserScanHistory(uid, { subscription, enforceRetention: true })
    return res.status(200).json({
      runs,
      retention: retention
        ? { cap: retention.cap, retained: retention.retained, pruned: retention.deleted?.length || 0 }
        : null,
    })
  }

  // GET /api/history/:runId — restore payload (one Storage download)
  if (parts.length === 1 && req.method === 'GET') {
    const runId = parts[0]
    const result = await getUserScanHistoryArtifact(uid, runId)
    if (!result.ok) {
      const status =
        result.reasonCode === 'NOT_FOUND'
          ? 404
          : result.reasonCode === 'FORBIDDEN'
            ? 403
            : result.reasonCode === 'ARTIFACT_MISSING' ||
                result.reasonCode === 'ARTIFACT_CORRUPT' ||
                result.reasonCode === 'ARTIFACT_UNAVAILABLE' ||
                result.reasonCode === 'UNSUPPORTED_SCHEMA'
              ? 409
              : 400
      return res.status(status).json({
        error:
          result.reasonCode === 'NOT_FOUND'
            ? 'History run not found.'
            : result.reasonCode === 'FORBIDDEN'
              ? 'Not allowed to access this run.'
              : 'This saved run is unavailable. The artifact may be missing, corrupt, or an unsupported schema.',
        reasonCode: result.reasonCode,
        run: result.metadata || null,
      })
    }

    return res.status(200).json({
      runId,
      source: 'history',
      repository: result.repository,
      dashboard: result.dashboard,
      report: result.report,
      reportValidation: result.reportValidation,
      model: result.model,
      runCost: result.runCost || null,
      metadata: result.metadata,
    })
  }

  // POST /api/history/:runId/download — server-authoritative export
  if (parts.length === 2 && parts[1] === 'download' && req.method === 'POST') {
    const runId = parts[0]
    const format = String(req.body?.format || '').toLowerCase()
    if (!['markdown', 'text', 'pdf', 'md', 'txt'].includes(format)) {
      return res.status(400).json({ error: 'format must be markdown, text, or pdf.' })
    }

    const result = await getUserScanHistoryArtifact(uid, runId)
    if (!result.ok) {
      const status = result.reasonCode === 'NOT_FOUND' ? 404 : result.reasonCode === 'FORBIDDEN' ? 403 : 409
      return res.status(status).json({
        error: 'Unable to export this saved run.',
        reasonCode: result.reasonCode,
      })
    }

    if (!result.report || !String(result.report).trim()) {
      return res.status(409).json({ error: 'Saved run has no exportable report.', reasonCode: 'REPORT_EMPTY' })
    }

    const repoName = result.repository?.name || 'report'
    try {
      if (format === 'markdown' || format === 'md') {
        const sanitizedReport = prepareMarkdown(result.report)
        const filename = generateFilename('md', repoName)
        setDownloadHeaders(res, 'text/markdown; charset=utf-8', filename)
        return res.status(200).send(sanitizedReport)
      }
      if (format === 'text' || format === 'txt') {
        const sanitizedText = markdownToPlainText(appendMandatoryDisclaimer(result.report))
        const filename = generateFilename('txt', repoName)
        setDownloadHeaders(res, 'text/plain; charset=utf-8', filename)
        return res.status(200).send(sanitizedText)
      }
      const exportCheck = validatePdfExportText(result.report)
      if (!exportCheck.valid) {
        return res.status(422).json({
          error: 'Saved report export failed customer-language quality checks.',
          reasonCode: 'PDF_EXPORT_QUALITY_FAILED',
          issues: exportCheck.issues.map(({ code, message }) => ({ code, message })),
        })
      }
      const pdfBytes = await renderReportPdfBuffer(result.report, result.repository, result.runCost || null)
      const filename = generateFilename('pdf', repoName)
      setDownloadHeaders(res, 'application/pdf', filename)
      return res.status(200).send(pdfBytes)
    } catch (error) {
      return handleDownloadError(res, 'History export', error)
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
