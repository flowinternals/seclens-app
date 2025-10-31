/**
 * Text download endpoint
 * POST /api/download/text
 */

import { corsHeaders } from '../utils/cors.js'
import { markdownToPlainText, generateFilename, setDownloadHeaders, handleDownloadError } from '../utils/downloadUtils.js'
import { validateString, validateRepoName } from '../utils/validation.js'

export default async function handler(req, res) {
  const origin = req.headers.origin
  const headers = corsHeaders(origin)
  
  // Set CORS headers
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value)
  })
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  try {
    const { report, repository } = req.body
    
    // Validate inputs
    const reportCheck = validateString(report, { required: true, maxLength: 200000 })
    if (!reportCheck.valid) return res.status(400).json({ error: reportCheck.error })
    const repoCheck = validateRepoName(repository?.name || 'report')
    if (!repoCheck.valid) return res.status(400).json({ error: repoCheck.error })
    
    // Convert markdown to sanitized plain text
    const sanitizedText = markdownToPlainText(reportCheck.value)
    const filename = generateFilename('txt', repoCheck.value || 'report')
    
    // Set headers for file download
    setDownloadHeaders(res, 'text/plain; charset=utf-8', filename)
    
    return res.status(200).send(sanitizedText)
  } catch (error) {
    return handleDownloadError(res, 'Text generation', error)
  }
}

