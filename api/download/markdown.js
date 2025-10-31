/**
 * Markdown download endpoint
 * POST /api/download/markdown
 */

import { corsHeaders } from '../utils/cors.js'
import { prepareMarkdown, generateFilename, setDownloadHeaders, handleDownloadError } from '../utils/downloadUtils.js'
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
    
    // Sanitize markdown content
    const sanitizedReport = prepareMarkdown(reportCheck.value)
    const filename = generateFilename('md', repoCheck.value || 'report')
    
    // Set headers for file download
    setDownloadHeaders(res, 'text/markdown; charset=utf-8', filename)
    
    return res.status(200).send(sanitizedReport)
  } catch (error) {
    return handleDownloadError(res, 'Markdown generation', error)
  }
}
