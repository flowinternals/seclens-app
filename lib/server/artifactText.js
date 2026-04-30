function isLikelyBinaryUtf8(content, buf) {
  return buf.includes(0) || String(content || '').includes('\uFFFD')
}

function normalizeExtractedText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function fallbackReadableStringsFromBinary(buf, minLen = 6) {
  const text = buf.toString('latin1')
  const matches = text.match(new RegExp(`[ -~]{${minLen},}`, 'g')) || []
  const joined = matches.slice(0, 300).join('\n')
  return normalizeExtractedText(joined)
}

export async function decodeRepositoryArtifact(path, base64Content) {
  const raw = String(base64Content || '').replace(/\n/g, '')
  const buf = Buffer.from(raw, 'base64')
  const lowerPath = String(path || '').toLowerCase()
  const utf8 = buf.toString('utf8')

  if (!isLikelyBinaryUtf8(utf8, buf)) {
    return { ok: true, content: utf8, artifactType: 'text' }
  }

  if (lowerPath.endsWith('.pdf')) {
    try {
      const { default: pdfParse } = await import('pdf-parse')
      const parsed = await pdfParse(buf)
      const extracted = normalizeExtractedText(parsed?.text || '')
      if (extracted) return { ok: true, content: extracted, artifactType: 'pdf' }
    } catch {
      // Fall through to printable-string fallback.
    }

    const fallback = fallbackReadableStringsFromBinary(buf)
    if (fallback) return { ok: true, content: fallback, artifactType: 'pdf_fallback' }
    return { ok: false, reason: 'binary' }
  }

  if (lowerPath.endsWith('.docx')) {
    try {
      const mammoth = await import('mammoth')
      const parsed = await mammoth.extractRawText({ buffer: buf })
      const extracted = normalizeExtractedText(parsed?.value || '')
      if (extracted) return { ok: true, content: extracted, artifactType: 'docx' }
    } catch {
      return { ok: false, reason: 'binary' }
    }
    return { ok: false, reason: 'binary' }
  }

  return { ok: false, reason: 'binary' }
}
