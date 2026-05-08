/**
 * MVP4 Stage 02 - deterministic line indexing and excerpts (no AST dependency).
 */

/** @param {string} content */
export function splitLines(content) {
  if (typeof content !== 'string') return []
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.split('\n')
}

/**
 * Build a contiguous excerpt from 1-based line numbers (inclusive).
 * @param {string[]} lines 0-based array; lines[i] is line i+1
 * @param {number} startLine 1-based
 * @param {number} endLine 1-based
 */
export function sliceLines(lines, startLine, endLine) {
  const start = Math.max(1, Math.floor(startLine))
  const end = Math.max(start, Math.floor(endLine))
  const slice = lines.slice(start - 1, end)
  const text = slice.join('\n')
  return { startLine: start, endLine: end, text }
}

/**
 * First contiguous block from line 1 up to maxBytes UTF-8 length (not adding fabricated ranges).
 * @param {string[]} lines
 * @param {number} maxBytes
 */
export function excerptWithinByteBudget(lines, maxBytes) {
  const budget = Math.max(0, maxBytes)
  if (lines.length === 0) {
    return { startLine: 1, endLine: 1, text: '', truncated: false, lineRangeUnavailable: true }
  }

  let used = 0
  let endIdx = 0
  for (let i = 0; i < lines.length; i++) {
    const sep = i > 0 ? 1 : 0
    const lineBuf = Buffer.byteLength(lines[i], 'utf8')
    const add = sep + lineBuf
    if (used + add > budget) {
      break
    }
    used += add
    endIdx = i + 1
  }

  if (endIdx === 0) {
    const first = lines[0] ?? ''
    const truncatedText = Buffer.from(first, 'utf8').subarray(0, budget).toString('utf8')
    return {
      startLine: 1,
      endLine: 1,
      text: truncatedText,
      truncated: truncatedText.length < first.length,
      lineRangeUnavailable: false,
    }
  }

  const block = lines.slice(0, endIdx)
  const text = block.join('\n')
  const truncated = endIdx < lines.length
  return {
    startLine: 1,
    endLine: endIdx,
    text,
    truncated,
    lineRangeUnavailable: false,
  }
}

/**
 * Format citation key for prompts: path:start-end
 * @param {string} path
 * @param {number} startLine
 * @param {number} endLine
 */
export function formatCitationRange(path, startLine, endLine) {
  const safePath = String(path || '').replace(/\\/g, '/')
  return `${safePath}:${startLine}-${endLine}`
}
