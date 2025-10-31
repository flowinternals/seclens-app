/**
 * PDF download endpoint
 * POST /api/download/pdf
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
    
    // Dynamic import for pdf-lib (Vercel serverless functions)
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
    
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create()
    let page = pdfDoc.addPage([595, 842]) // A4 size
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    
    // Sanitize and convert markdown to plain text for PDF
    const sanitizedText = markdownToPlainText(reportCheck.value)
    
    // Add title
    page.drawText('SecLens Security Report', {
      x: 50,
      y: 800,
      size: 20,
      font: boldFont,
      color: rgb(0, 0, 0),
    })
    
    if (repository?.name) {
      page.drawText(`Repository: ${repository.name}`, {
        x: 50,
        y: 770,
        size: 12,
        font: font,
        color: rgb(0.3, 0.3, 0.3),
      })
    }
    
    // Add date
    page.drawText(`Generated: ${new Date().toLocaleDateString()}`, {
      x: 50,
      y: 750,
      size: 10,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    })
    
    // Draw a line
    page.drawLine({
      start: { x: 50, y: 735 },
      end: { x: 545, y: 735 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    })
    
    // Split text into lines and add to PDF
    const lines = sanitizedText.split('\n')
    let yPosition = 710
    const lineHeight = 14
    const margin = 50
    const maxWidth = 495
    
    for (const line of lines) {
      if (yPosition < 50) {
        // Add new page if needed
        page = pdfDoc.addPage([595, 842])
        yPosition = 800
      }
      
      // Wrap long lines
      const words = line.split(' ')
      let currentLine = ''
      
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word
        const width = font.widthOfTextAtSize(testLine, 11)
        
        if (width > maxWidth && currentLine) {
          // Draw current line and start new one
          page.drawText(currentLine, {
            x: margin,
            y: yPosition,
            size: 11,
            font: font,
            color: rgb(0, 0, 0),
            maxWidth: maxWidth,
          })
          yPosition -= lineHeight
          currentLine = word
          
          if (yPosition < 50) {
            page = pdfDoc.addPage([595, 842])
            yPosition = 800
          }
        } else {
          currentLine = testLine
        }
      }
      
      // Draw the remaining line
      if (currentLine.trim()) {
        page.drawText(currentLine, {
          x: margin,
          y: yPosition,
          size: 11,
          font: font,
          color: rgb(0, 0, 0),
          maxWidth: maxWidth,
        })
        yPosition -= lineHeight
      } else {
        yPosition -= lineHeight * 0.5 // Space for empty lines
      }
    }
    
    // Save the PDF
    const pdfBytes = await pdfDoc.save()
    const filename = generateFilename('pdf', repoCheck.value || 'report')
    
    // Set headers for file download
    setDownloadHeaders(res, 'application/pdf', filename)
    
    return res.status(200).send(Buffer.from(pdfBytes))
  } catch (error) {
    return handleDownloadError(res, 'PDF generation', error)
  }
}

