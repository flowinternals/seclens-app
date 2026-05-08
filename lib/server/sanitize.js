/**
 * Server-side sanitization utilities for API endpoints
 * Uses isomorphic-sanitize-fork or manual sanitization for Node.js environment
 */

/**
 * Sanitizes HTML content to prevent XSS attacks (server-side)
 * Uses manual HTML escaping since DOMPurify requires DOM environment
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML string
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return ''
  
  // Escape HTML metacharacters without over-encoding normal prose.
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitizes plain text to prevent XSS attacks
 * Escapes HTML special characters
 * @param {string} text - Text string to sanitize
 * @returns {string} Sanitized text string
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') return ''
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Validates GitHub repository URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid GitHub URL format
 */
export function isValidGitHubUrl(url) {
  if (!url || typeof url !== 'string') return false
  
  const githubUrlPattern =
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/tree\/(?:[A-Za-z0-9._/-]+))?\/?$/
  return githubUrlPattern.test(url.trim())
}

/** True if the string begins with http:// or https:// (any letter case). */
function hasHttpOrHttpsSchemePrefix(trimmed) {
  return /^https?:\/\//i.test(trimmed)
}

/**
 * True if the value parses as a URL with hostname exactly `github.com` (not subdomains or suffix tricks).
 * Avoids incomplete substring checks for trust decisions.
 */
export function isGitHubComHostUrlString(url) {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  const normalized =
    hasHttpOrHttpsSchemePrefix(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(normalized).hostname === 'github.com'
  } catch {
    return false
  }
}

function isSafeGitRef(ref) {
  if (!ref || typeof ref !== 'string') return false
  const trimmed = ref.trim()
  if (!trimmed || trimmed.length > 255) return false
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return false
  if (trimmed.includes('..') || trimmed.includes('@{') || trimmed.includes('\\')) return false
  if (trimmed.endsWith('.lock') || /\s/.test(trimmed)) return false
  return /^[A-Za-z0-9._/-]+$/.test(trimmed)
}

/**
 * Sanitizes a GitHub URL by extracting and validating the repository path
 * @param {string} url - GitHub URL to sanitize
 * @returns {string|null} Sanitized URL or null if invalid
 */
export function sanitizeGitHubUrl(url) {
  if (!url || typeof url !== 'string') return null
  
  const trimmed = url.trim()
  const unsafeTreeRefPattern = /\/tree\/[^?#]*(\.\.|@{|\\|\s)/
  if (unsafeTreeRefPattern.test(trimmed)) return null

  const normalized =
    hasHttpOrHttpsSchemePrefix(trimmed) ? trimmed : `https://${trimmed}`
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    return null
  }

  if (parsed.hostname !== 'github.com') return null

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, '')
  let sanitized = `https://github.com/${owner}/${repo}`

  if (segments[2] === 'tree' && segments.length >= 4) {
    const ref = decodeURIComponent(segments.slice(3).join('/'))
    if (!isSafeGitRef(ref)) return null
    sanitized = `${sanitized}/tree/${ref}`
  }
  
  // Validate the sanitized URL
  if (isValidGitHubUrl(sanitized)) {
    return sanitized
  }
  
  return null
}

const ALLOWED_MARKDOWN_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Executable / high-risk schemes (CodeQL js/incomplete-url-scheme-check: cover javascript, data, vbscript).
 * Additional schemes are rejected via {@link ALLOWED_MARKDOWN_URL_PROTOCOLS} when parsed as a URL.
 */
const DISALLOWED_EXECUTABLE_SCHEMES = new Set(['javascript', 'vbscript', 'data'])

/**
 * @param {string} decoded
 * @returns {string | null}
 */
function normalizeSchemeTokenBeforeColon(decoded) {
  const colon = decoded.indexOf(':')
  if (colon === -1) return null
  return decoded.slice(0, colon).replace(/[\u0000-\u0020\u00A0]+/g, '').toLowerCase()
}

function decodeCommonUrlEntityObfuscation(s) {
  let t = s
    .replace(/&#x3a;/gi, ':')
    .replace(/&#58;/g, ':')
    .replace(/&colon;/gi, ':')
  t = t.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _
    try {
      return String.fromCodePoint(code)
    } catch {
      return _
    }
  })
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, h) => {
    const code = parseInt(h, 16)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _
    try {
      return String.fromCodePoint(code)
    } catch {
      return _
    }
  })
  return t
}

/**
 * @param {string} markdown
 * @param {number} closeBracketIdx Index of `]` in `](url)`
 * @returns {{ urlStart: number, urlEnd: number, closeParenEnd: number } | null}
 */
function findMarkdownInlineLinkUrlBounds(markdown, closeBracketIdx) {
  const urlStart = closeBracketIdx + 2
  if (urlStart >= markdown.length) return null
  if (markdown[urlStart] === '<') {
    const gt = markdown.indexOf('>', urlStart)
    if (gt === -1) return null
    if (gt + 1 >= markdown.length || markdown[gt + 1] !== ')') return null
    return { urlStart: urlStart + 1, urlEnd: gt, closeParenEnd: gt + 2 }
  }
  let depth = 0
  let j = urlStart
  while (j < markdown.length) {
    const c = markdown[j]
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) return { urlStart, urlEnd: j, closeParenEnd: j + 1 }
      depth--
    }
    j++
  }
  return null
}

/**
 * @param {string} raw
 * @returns {boolean} True if the URL target uses a disallowed or dangerous scheme.
 */
function markdownUrlTargetIsBlocked(raw) {
  const decoded = decodeCommonUrlEntityObfuscation(raw.trim())
  if (!decoded) return false

  const earlyScheme = normalizeSchemeTokenBeforeColon(decoded)
  if (earlyScheme && DISALLOWED_EXECUTABLE_SCHEMES.has(earlyScheme)) {
    return true
  }

  if (
    (decoded.startsWith('/') && !decoded.startsWith('//')) ||
    decoded.startsWith('./') ||
    decoded.startsWith('../') ||
    decoded.startsWith('#')
  ) {
    return false
  }

  try {
    const u = decoded.startsWith('//') ? new URL(`https:${decoded}`) : new URL(decoded)
    const proto = u.protocol.toLowerCase()
    const schemeName = proto.endsWith(':') ? proto.slice(0, -1) : proto
    if (DISALLOWED_EXECUTABLE_SCHEMES.has(schemeName)) {
      return true
    }
    return !ALLOWED_MARKDOWN_URL_PROTOCOLS.has(proto)
  } catch {
    return false
  }
}

/**
 * Rewrites href (on &lt;a&gt;) or src (on &lt;img&gt;) when blocked — character-wise attribute parse, no regex.
 * @param {string} inner Tag interior without angle brackets (includes leading tag name).
 * @param {'a' | 'img'} tagLower
 */
function rewriteUriAttrIfBlockedInOpeningTagInner(inner, tagLower) {
  const targetAttr = tagLower === 'a' ? 'href' : 'src'
  let pos = 0
  while (pos < inner.length && /[a-zA-Z]/.test(inner[pos])) pos++
  while (pos < inner.length) {
    while (pos < inner.length && /\s/.test(inner[pos])) pos++
    if (pos >= inner.length) break
    const nameStart = pos
    while (pos < inner.length && /[a-zA-Z-]/.test(inner[pos])) pos++
    const attrName = inner.slice(nameStart, pos).toLowerCase()
    while (pos < inner.length && /\s/.test(inner[pos])) pos++
    if (pos >= inner.length || inner[pos] !== '=') {
      pos = nameStart + 1
      continue
    }
    pos++
    while (pos < inner.length && /\s/.test(inner[pos])) pos++
    if (pos >= inner.length) break
    let valStart
    let valEnd
    if (inner[pos] === '"' || inner[pos] === "'") {
      const q = inner[pos]
      pos++
      valStart = pos
      while (pos < inner.length && inner[pos] !== q) pos++
      if (pos >= inner.length) break
      valEnd = pos
      pos++
    } else {
      valStart = pos
      while (pos < inner.length && !/\s/.test(inner[pos]) && inner[pos] !== '>') pos++
      valEnd = pos
    }
    const rawVal = inner.slice(valStart, valEnd)
    if (attrName === targetAttr) {
      if (markdownUrlTargetIsBlocked(rawVal)) {
        return inner.slice(0, valStart) + '#' + inner.slice(valEnd)
      }
      return inner
    }
  }
  return inner
}

/**
 * Neutralizes dangerous href/src on embedded HTML &lt;a&gt; / &lt;img&gt; tags without regex-based matching.
 * @param {string} s
 */
function neutralizeBlockedHtmlAnchorAndImgUrls(s) {
  let result = ''
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt === -1) {
      result += s.slice(i)
      break
    }
    result += s.slice(i, lt)
    const tagInfo = readOpeningTagName(s, lt)
    if (!tagInfo) {
      const gt = findTagSpanEnd(s, lt)
      if (gt === -1) {
        result += s.slice(lt)
        break
      }
      result += s.slice(lt, gt + 1)
      i = gt + 1
      continue
    }
    const lower = tagInfo.name.toLowerCase()
    if (lower !== 'a' && lower !== 'img') {
      const gt = findTagSpanEnd(s, lt)
      if (gt === -1) {
        result += s[lt]
        i = lt + 1
        continue
      }
      result += s.slice(lt, gt + 1)
      i = gt + 1
      continue
    }
    const gt = findTagSpanEnd(s, lt)
    if (gt === -1) {
      result += s[lt]
      i = lt + 1
      continue
    }
    const openInner = s.slice(lt + 1, gt)
    const newInner = rewriteUriAttrIfBlockedInOpeningTagInner(openInner, lower)
    result += '<' + newInner + '>'
    i = gt + 1
  }
  return result
}

function neutralizeBlockedMarkdownUrlTargets(markdown) {
  let out = ''
  let i = 0
  while (i < markdown.length) {
    const linkClose = markdown.indexOf('](', i)
    if (linkClose === -1) {
      out += markdown.slice(i)
      break
    }
    const bounds = findMarkdownInlineLinkUrlBounds(markdown, linkClose)
    if (!bounds) {
      out += markdown.slice(i, linkClose + 2)
      i = linkClose + 2
      continue
    }
    const url = markdown.slice(bounds.urlStart, bounds.urlEnd)
    if (markdownUrlTargetIsBlocked(url)) {
      out += markdown.slice(i, linkClose + 1)
      out += '(#)'
      i = bounds.closeParenEnd
    } else {
      out += markdown.slice(i, bounds.closeParenEnd)
      i = bounds.closeParenEnd
    }
  }

  return neutralizeBlockedHtmlAnchorAndImgUrls(out)
}

const DANGEROUS_PAIRED_HTML_TAGS = new Set(['script', 'iframe'])

function startsWithInsensitive(s, pos, asciiPattern) {
  if (pos + asciiPattern.length > s.length) return false
  for (let p = 0; p < asciiPattern.length; p++) {
    if (s[pos + p].toLowerCase() !== asciiPattern[p].toLowerCase()) return false
  }
  return true
}

/**
 * Removes stray closing tags (e.g. `</script>` left after stripping inner pairs).
 * Uses literal scans only (no regex tag stripping).
 */
function stripOrphanClosingTagOnce(s, tagLower) {
  const pattern = '</' + tagLower
  let out = ''
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt === -1) {
      out += s.slice(i)
      break
    }
    out += s.slice(i, lt)
    if (startsWithInsensitive(s, lt, pattern)) {
      let k = lt + pattern.length
      while (k < s.length && /\s/.test(s[k])) k++
      if (k < s.length && s[k] === '>') {
        i = k + 1
        continue
      }
    }
    out += s[lt]
    i = lt + 1
  }
  return out
}

function stripOrphanDangerousClosingTags(s) {
  let cur = s
  let guard = 0
  while (guard++ < 32) {
    const next = stripOrphanClosingTagOnce(stripOrphanClosingTagOnce(cur, 'script'), 'iframe')
    if (next === cur) break
    cur = next
  }
  return cur
}

/** @returns {number} Index of closing `>`, or -1 */
function findGtClosingOpeningTag(s, start) {
  if (start < s.length && s[start] === '<') return -1
  let i = start
  let quote = null
  while (i < s.length) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i++
      continue
    }
    if (c === '>') return i
    i++
  }
  return -1
}

/**
 * End index of a tag that starts at openLt (`<`), inclusive of `>`.
 * Handles quoted attributes; closing tags `</div>`; declarations `<!...>` / `<?...>` naïvely.
 */
function findTagSpanEnd(s, openLt) {
  if (openLt >= s.length || s[openLt] !== '<') return -1
  let i = openLt + 1
  if (i >= s.length) return -1
  const c0 = s[i]
  if (c0 === '/') {
    i++
    while (i < s.length && /[A-Za-z]/.test(s[i])) i++
    return findGtClosingOpeningTag(s, i)
  }
  if (c0 === '!' || c0 === '?') {
    while (i < s.length && s[i] !== '>') i++
    return i < s.length ? i : -1
  }
  while (i < s.length && /[A-Za-z]/.test(s[i])) i++
  return findGtClosingOpeningTag(s, i)
}

/**
 * @returns {{ name: string, afterName: number } | null}
 */
function readOpeningTagName(s, pos) {
  if (pos >= s.length || s[pos] !== '<') return null
  if (pos + 1 >= s.length) return null
  const c = s[pos + 1]
  if (c === '/' || c === '!' || c === '?') return null
  let j = pos + 1
  const nameStart = j
  while (j < s.length && /[A-Za-z]/.test(s[j])) j++
  if (j === nameStart) return null
  const name = s.slice(nameStart, j)
  if (!name) return null
  return { name, afterName: j }
}

/**
 * @returns {number} Index after `>` of closing tag, or -1
 */
function findClosingPairedTagEnd(s, tagLower, from) {
  const n = tagLower.length
  let i = from
  while (i < s.length) {
    if (s[i] === '<' && i + 1 < s.length && s[i + 1] === '/') {
      let j = i + 2
      let k = 0
      while (k < n && j < s.length && s[j].toLowerCase() === tagLower[k]) {
        j++
        k++
      }
      if (k === n) {
        let m = j
        while (m < s.length && /\s/.test(s[m])) m++
        if (m < s.length && s[m] === '>') return m + 1
      }
    }
    i++
  }
  return -1
}

/**
 * Removes paired &lt;script&gt;…&lt;/script&gt; and &lt;iframe&gt;…&lt;/iframe&gt; blocks without
 * regex-based tag stripping (avoids incomplete multi-pass replace / nested-tag bypasses).
 * Repeats until stable to handle nested duplicate tags.
 */
function stripDangerousPairedHtmlBlocks(markdown) {
  let current = markdown
  let guard = 0
  while (guard++ < 64) {
    const next = stripDangerousPairedHtmlBlocksOnce(current)
    if (next === current) break
    current = next
  }
  return stripOrphanDangerousClosingTags(current)
}

function stripDangerousPairedHtmlBlocksOnce(s) {
  const parts = []
  let i = 0
  while (i < s.length) {
    if (s[i] !== '<') {
      const nextLt = s.indexOf('<', i)
      if (nextLt === -1) {
        parts.push(s.slice(i))
        break
      }
      parts.push(s.slice(i, nextLt))
      i = nextLt
      continue
    }
    const tagInfo = readOpeningTagName(s, i)
    if (!tagInfo) {
      const gt = findTagSpanEnd(s, i)
      if (gt === -1) {
        parts.push(s.slice(i))
        break
      }
      parts.push(s.slice(i, gt + 1))
      i = gt + 1
      continue
    }
    const lower = tagInfo.name.toLowerCase()
    if (!DANGEROUS_PAIRED_HTML_TAGS.has(lower)) {
      const gt = findTagSpanEnd(s, i)
      if (gt === -1) {
        parts.push(s[i])
        i++
        continue
      }
      parts.push(s.slice(i, gt + 1))
      i = gt + 1
      continue
    }
    const openGt = findGtClosingOpeningTag(s, tagInfo.afterName)
    if (openGt === -1) {
      parts.push(s[i])
      i++
      continue
    }
    const closeEnd = findClosingPairedTagEnd(s, lower, openGt + 1)
    if (closeEnd === -1) {
      parts.push(s[i])
      i++
      continue
    }
    i = closeEnd
  }
  return parts.join('')
}

/**
 * Removes inline event-handler attributes (on*) inside HTML tags; avoids matching substrings
 * like `longitude=` (requires a token boundary before `on`).
 */
function scrubInlineEventHandlersFromTagOpen(inner) {
  let out = ''
  let p = 0
  while (p < inner.length) {
    const m = findNextInlineEventHandler(inner, p)
    if (!m) {
      out += inner.slice(p)
      break
    }
    out += inner.slice(p, m.start)
    let skip = m.end
    while (skip < inner.length && /\s/.test(inner[skip])) skip++
    p = skip
  }
  return out
}

function findNextInlineEventHandler(inner, from) {
  let i = from
  while (i < inner.length) {
    const boundary = i === 0 || /\s/.test(inner[i - 1])
    if (
      boundary &&
      inner[i].toLowerCase() === 'o' &&
      i + 1 < inner.length &&
      inner[i + 1].toLowerCase() === 'n' &&
      i + 2 < inner.length &&
      /[a-z]/i.test(inner[i + 2])
    ) {
      let j = i + 2
      while (j < inner.length && /[a-z]/i.test(inner[j])) j++
      while (j < inner.length && /\s/.test(inner[j])) j++
      if (j < inner.length && inner[j] === '=') {
        j++
        while (j < inner.length && /\s/.test(inner[j])) j++
        if (j < inner.length && (inner[j] === '"' || inner[j] === "'")) {
          const q = inner[j]
          j++
          while (j < inner.length && inner[j] !== q) j++
          if (j < inner.length) j++
        } else {
          while (j < inner.length && !/\s/.test(inner[j])) j++
        }
        return { start: i, end: j }
      }
    }
    i++
  }
  return null
}

function stripInlineEventHandlerAttributes(markdown) {
  let out = ''
  let i = 0
  while (i < markdown.length) {
    const lt = markdown.indexOf('<', i)
    if (lt === -1) {
      out += markdown.slice(i)
      break
    }
    out += markdown.slice(i, lt)
    const gt = findTagSpanEnd(markdown, lt)
    if (gt === -1) {
      out += markdown.slice(lt)
      break
    }
    const tag = markdown.slice(lt, gt + 1)
    if (tag.startsWith('</') || tag.startsWith('<!') || tag.startsWith('<?')) {
      out += tag
    } else {
      const inner = tag.slice(1, -1)
      out += '<' + scrubInlineEventHandlersFromTagOpen(inner) + '>'
    }
    i = gt + 1
  }
  return out
}

/**
 * Sanitizes markdown content for safe display
 * Removes potentially dangerous HTML/script tags
 * @param {string} markdown - Markdown string to sanitize
 * @returns {string} Sanitized markdown string
 */
export function sanitizeMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return ''

  let out = stripDangerousPairedHtmlBlocks(markdown)
  out = neutralizeBlockedMarkdownUrlTargets(out)
  out = stripInlineEventHandlerAttributes(out)
  return out
}

/**
 * Sanitizes object properties recursively
 * Useful for sanitizing API response data
 * @param {any} data - Data to sanitize
 * @returns {any} Sanitized data
 */
export function sanitizeObject(data) {
  if (typeof data === 'string') {
    return sanitizeText(data)
  }
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizeObject(item))
  }
  
  if (data && typeof data === 'object') {
    const sanitized = {}
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        sanitized[key] = sanitizeObject(data[key])
      }
    }
    return sanitized
  }
  
  return data
}

/**
 * Validates and sanitizes user input
 * @param {string} input - User input string
 * @param {object} options - Validation options
 * @returns {object} Validation result with sanitized value
 */
export function validateInput(input, options = {}) {
  const {
    maxLength = 10000,
    allowEmpty = false,
    trim = true
  } = options
  
  if (!input || typeof input !== 'string') {
    return { valid: allowEmpty, value: '', error: 'Input must be a string' }
  }
  
  let processed = input
  if (trim) {
    processed = processed.trim()
  }
  
  if (!allowEmpty && processed.length === 0) {
    return { valid: false, value: '', error: 'Input cannot be empty' }
  }
  
  if (processed.length > maxLength) {
    return { valid: false, value: '', error: `Input exceeds maximum length of ${maxLength}` }
  }
  
  return {
    valid: true,
    value: sanitizeText(processed),
    originalLength: processed.length
  }
}

