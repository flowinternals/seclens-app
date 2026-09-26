/**
 * Shared PDF buffer builder for live and history exports.
 */

import {
  appendMandatoryDisclaimer,
  markdownToPlainText,
} from './downloadUtils.js'

export async function renderReportPdfBuffer(reportMarkdown, repository = null) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([595, 842])
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const sanitizedText = markdownToPlainText(appendMandatoryDisclaimer(reportMarkdown))

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
      font,
      color: rgb(0.3, 0.3, 0.3),
    })
  }

  page.drawText(`Generated: ${new Date().toLocaleDateString()}`, {
    x: 50,
    y: 750,
    size: 10,
    font,
    color: rgb(0.5, 0.5, 0.5),
  })

  page.drawLine({
    start: { x: 50, y: 735 },
    end: { x: 545, y: 735 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  })

  const lines = sanitizedText.split('\n')
  let yPosition = 710
  const lineHeight = 14
  const margin = 50
  const maxWidth = 495

  for (const line of lines) {
    if (yPosition < 50) {
      page = pdfDoc.addPage([595, 842])
      yPosition = 800
    }

    const words = line.split(' ')
    let currentLine = ''

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const width = font.widthOfTextAtSize(testLine, 11)

      if (width > maxWidth && currentLine) {
        page.drawText(currentLine, {
          x: margin,
          y: yPosition,
          size: 11,
          font,
          color: rgb(0, 0, 0),
          maxWidth,
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

    if (currentLine.trim()) {
      page.drawText(currentLine, {
        x: margin,
        y: yPosition,
        size: 11,
        font,
        color: rgb(0, 0, 0),
        maxWidth,
      })
      yPosition -= lineHeight
    } else {
      yPosition -= lineHeight * 0.5
    }
  }

  return Buffer.from(await pdfDoc.save())
}
