/**
 * PDF download endpoint
 * POST /api/download/pdf
 */

import { corsHeaders } from '../../lib/server/cors.js'
import { generateFilename, setDownloadHeaders, handleDownloadError, validatePdfExportText } from '../../lib/server/downloadUtils.js'
import { validateString, validateRepoName } from '../../lib/server/validation.js'
import { enforceProductionAccessGuard } from '../../lib/server/productionAccessGuard.js'
import { authenticateRequest } from '../../lib/server/adminAuth.js'
import { logProtectedEndpointRejection, sendAuthFailureJson } from '../../lib/server/apiAuth.js'
import { renderReportPdfBuffer } from '../../lib/server/renderReportPdf.js'

export default async function handler(req, res) {
  const origin = req.headers.origin
  const headers = corsHeaders(origin)

  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value)
  })
  const isOriginAllowed = Boolean(headers['Access-Control-Allow-Origin'])

  if (!enforceProductionAccessGuard({ req, res, origin, isOriginAllowed })) {
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const authResult = await authenticateRequest(req)
    if (!authResult.ok) {
      logProtectedEndpointRejection({
        req,
        endpoint: '/api/download/pdf',
        statusCode: authResult.status || 401,
        reasonCode: authResult.reasonCode,
      })
      return sendAuthFailureJson(res, authResult)
    }

    const { report, repository, runCost = null } = req.body

    const reportCheck = validateString(report, { required: true, maxLength: 200000 })
    if (!reportCheck.valid) return res.status(400).json({ error: reportCheck.error })
    const repoCheck = validateRepoName(repository?.name || 'report')
    if (!repoCheck.valid) return res.status(400).json({ error: repoCheck.error })

    const exportCheck = validatePdfExportText(reportCheck.value)
    if (!exportCheck.valid) {
      return res.status(422).json({
        error: 'Report export failed customer-language quality checks.',
        reasonCode: 'PDF_EXPORT_QUALITY_FAILED',
        issues: exportCheck.issues.map(({ code, message }) => ({ code, message })),
      })
    }

    const pdfBytes = await renderReportPdfBuffer(reportCheck.value, repository, runCost)
    const filename = generateFilename('pdf', repoCheck.value || 'report')
    setDownloadHeaders(res, 'application/pdf', filename)
    return res.status(200).send(pdfBytes)
  } catch (error) {
    return handleDownloadError(res, 'PDF generation', error)
  }
}
