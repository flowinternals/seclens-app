/**
 * Section-scoped oracle scoring against machine markers (AUTO-SPO-001 design §7).
 */

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Split markdown into finding-like sections on ### headings (plus a preamble bucket).
 * @param {string} reportMarkdown
 * @returns {{ heading: string, body: string, startLine: number }[]}
 */
export function splitFindingSections(reportMarkdown) {
  const normalized = normalizeText(reportMarkdown)
  if (!normalized) return []

  const lines = normalized.split('\n')
  const sections = []
  let current = { heading: '(preamble)', bodyLines: [], startLine: 1 }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(/^#{2,3}\s+(.+)\s*$/)
    if (headingMatch && i > 0) {
      sections.push({
        heading: current.heading,
        body: current.bodyLines.join('\n').trim(),
        startLine: current.startLine,
      })
      current = {
        heading: headingMatch[1].trim(),
        bodyLines: [line],
        startLine: i + 1,
      }
    } else {
      current.bodyLines.push(line)
    }
  }
  sections.push({
    heading: current.heading,
    body: current.bodyLines.join('\n').trim(),
    startLine: current.startLine,
  })
  return sections.filter((s) => s.body.length > 0)
}

function compileMatchers(mustMatchAll = []) {
  return mustMatchAll.map((rule, index) => {
    if (!rule || rule.type !== 'regex' || typeof rule.pattern !== 'string') {
      throw new Error(`Invalid mustMatchAll rule at index ${index}`)
    }
    const flags = typeof rule.flags === 'string' ? rule.flags : 'i'
    return { index, regex: new RegExp(rule.pattern, flags), pattern: rule.pattern }
  })
}

function sectionMatchesRejectOnly(sectionText, rejectIfOnly = []) {
  if (!Array.isArray(rejectIfOnly) || rejectIfOnly.length === 0) return false
  const lower = sectionText.toLowerCase()
  const hitReject = rejectIfOnly.some((phrase) => lower.includes(String(phrase).toLowerCase()))
  if (!hitReject) return false
  // "rejectIfOnly": section is disqualified when it looks like generic reject phrasing
  // without substantive path/symbol hints — evaluated by caller with match details.
  return true
}

function findPathHint(sectionText, hints = []) {
  const lower = sectionText.toLowerCase()
  for (const hint of hints) {
    const h = String(hint || '').trim()
    if (!h) continue
    if (lower.includes(h.toLowerCase())) {
      return h
    }
  }
  return null
}

function matchSnippet(text, regex) {
  const m = text.match(regex)
  if (!m) return null
  const idx = m.index ?? 0
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + m[0].length + 40)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

/**
 * Score one issue against finding sections.
 * @returns {{ outcome: 'found'|'partially found'|'missed', matchedSection: object|null, matchedSnippets: string[], matchedPathHint: string|null, missing: string[] }}
 */
export function scoreIssueAgainstSections(issue, sections) {
  const matchers = compileMatchers(issue.mustMatchAll || [])
  const hints = issue.anyOfPathHints || []
  const rejectPhrases = issue.rejectIfOnly || []

  let bestPartial = null

  for (const section of sections) {
    const text = `${section.heading}\n${section.body}`
    const pathHint = findPathHint(text, hints)
    const matcherHits = matchers.map((m) => ({
      ...m,
      hit: m.regex.test(text),
      snippet: matchSnippet(text, m.regex),
    }))
    const allMatchers = matcherHits.every((m) => m.hit)
    const anyMatcher = matcherHits.some((m) => m.hit)
    const hitCount = matcherHits.filter((m) => m.hit).length

    if (sectionMatchesRejectOnly(text, rejectPhrases)) {
      // rejectIfOnly before positive: if reject phrases present and we lack full find signals, skip section
      if (!(allMatchers && pathHint)) {
        continue
      }
    }

    if (allMatchers && pathHint) {
      return {
        outcome: 'found',
        matchedSection: { heading: section.heading, startLine: section.startLine },
        matchedSnippets: matcherHits.map((m) => m.snippet).filter(Boolean),
        matchedPathHint: pathHint,
        missing: [],
      }
    }

    if (anyMatcher || pathHint) {
      const missing = []
      for (const m of matcherHits) {
        if (!m.hit) missing.push(`mustMatchAll[${m.index}]: ${m.pattern}`)
      }
      if (!pathHint) missing.push('anyOfPathHints')
      const candidate = {
        outcome: 'partially found',
        matchedSection: { heading: section.heading, startLine: section.startLine },
        matchedSnippets: matcherHits.map((m) => m.snippet).filter(Boolean),
        matchedPathHint: pathHint,
        missing,
        hitCount,
      }
      if (!bestPartial || candidate.hitCount > bestPartial.hitCount) {
        bestPartial = candidate
      }
    }
  }

  if (bestPartial) {
    const { hitCount: _hc, ...rest } = bestPartial
    return rest
  }

  return {
    outcome: 'missed',
    matchedSection: null,
    matchedSnippets: [],
    matchedPathHint: null,
    missing: [
      ...matchers.map((m) => `mustMatchAll[${m.index}]: ${m.pattern}`),
      'anyOfPathHints',
    ],
  }
}

/**
 * @param {{ reportMarkdown: string, markers: object, meta?: object }} input
 */
export function scoreOracleReport({ reportMarkdown, markers, meta = {} }) {
  if (!markers || !Array.isArray(markers.issues)) {
    throw new Error('markers.issues is required')
  }
  const sections = splitFindingSections(reportMarkdown)
  const issueResults = markers.issues.map((issue) => {
    const scored = scoreIssueAgainstSections(issue, sections)
    return {
      id: issue.id,
      severity: issue.severity,
      mandatory: !!issue.mandatory,
      title: issue.title || null,
      outcome: scored.outcome,
      matchedSection: scored.matchedSection,
      matchedSnippets: scored.matchedSnippets,
      matchedPathHint: scored.matchedPathHint,
      missing: scored.missing,
    }
  })

  const compared = issueResults.length
  const foundCount = issueResults.filter((i) => i.outcome === 'found').length
  const findRate = compared > 0 ? foundCount / compared : null
  const mandatory = issueResults.filter((i) => i.mandatory)
  const mandatoryCriticalHigh = mandatory.filter(
    (i) => i.severity === 'critical' || i.severity === 'high'
  )
  const criticalHighAllFound = mandatoryCriticalHigh.every((i) => i.outcome === 'found')
  const allFound = issueResults.every((i) => i.outcome === 'found')
  const allMissed = issueResults.every((i) => i.outcome === 'missed')

  let oracleStatus = 'partial'
  if (compared === 0) oracleStatus = 'not_scored'
  else if (allFound) oracleStatus = 'all_found'
  else if (allMissed) oracleStatus = 'all_missed'

  const oracleMode = meta.oracleMode || markers.devProfile?.oracleMode || 'record'
  const minFindRate = markers.passThreshold?.minFindRate ?? 0.8
  const requireAllCriticalHigh = markers.passThreshold?.allCriticalHighFound !== false
  const gateWouldPass =
    (!requireAllCriticalHigh || criticalHighAllFound) &&
    findRate != null &&
    findRate > minFindRate

  let gateStatus = 'not_applicable'
  if (oracleMode === 'gate') {
    gateStatus = gateWouldPass ? 'passed' : 'failed'
  }

  return {
    schemaVersion: 1,
    harnessStatus: meta.harnessStatus || 'ok',
    scanStatus: meta.scanStatus || 'completed',
    oracleStatus,
    gateStatus,
    baselineComparison: meta.baselineComparison || 'unverified',
    oracleMode,
    findRate,
    foundCount,
    issueCount: compared,
    criticalHighAllFound,
    gateWouldPass,
    requestedModel: meta.requestedModel || null,
    resolvedModel: meta.resolvedModel || null,
    requestedRef: meta.requestedRef || null,
    resolvedSha: meta.resolvedSha || null,
    baselineSha: meta.baselineSha || markers.baselineSha || null,
    localOutcomePath: meta.localOutcomePath || null,
    canonicalOutcomePath: meta.canonicalOutcomePath || null,
    canonicalWrite: meta.canonicalWrite || 'skipped',
    issues: issueResults,
    scoredAt: new Date().toISOString(),
  }
}

/**
 * Render CR5-compatible outcome markdown.
 */
export function renderOracleOutcomeMarkdown(score, opts = {}) {
  const repo = opts.repo || 'ITC2-AUS/SPO_Management'
  const lines = [
    `# ${opts.title || 'SPO Management Oracle Outcome'}`,
    '',
    `- repo: \`${repo}\``,
    `- execution date: \`${(score.scoredAt || '').slice(0, 10)}\``,
    `- harnessStatus: \`${score.harnessStatus}\``,
    `- scanStatus: \`${score.scanStatus}\``,
    `- oracleStatus: \`${score.oracleStatus}\``,
    `- gateStatus: \`${score.gateStatus}\``,
    `- baselineComparison: \`${score.baselineComparison}\``,
    `- oracleMode: \`${score.oracleMode}\``,
    `- requestedModel: \`${score.requestedModel || '-'}\``,
    `- resolvedModel: \`${score.resolvedModel || '-'}\``,
    `- requestedRef: \`${score.requestedRef || '-'}\``,
    `- resolvedSha: \`${score.resolvedSha || '-'}\``,
    `- baselineSha: \`${score.baselineSha || '-'}\``,
    `- findRate: \`${score.findRate == null ? '-' : (score.findRate * 100).toFixed(1) + '%'}\``,
    `- localOutcomePath: \`${score.localOutcomePath || '-'}\``,
    `- canonicalOutcomePath: \`${score.canonicalOutcomePath || '-'}\``,
    `- canonicalWrite: \`${score.canonicalWrite}\``,
    '',
    '## Summary',
    '',
    `- foundCount: ${score.foundCount} / ${score.issueCount}`,
    `- criticalHighAllFound: \`${score.criticalHighAllFound}\``,
    '',
    '## Expected Issues',
    '',
  ]

  for (const issue of score.issues || []) {
    lines.push(`### ${issue.id}`)
    lines.push('')
    lines.push(`- severity: \`${issue.severity}\``)
    lines.push(`- mandatory pass flag: \`${issue.mandatory}\``)
    lines.push(`- outcome: \`${issue.outcome}\``)
    if (issue.matchedSection?.heading) {
      lines.push(`- matchedSection: \`${issue.matchedSection.heading}\` (line ${issue.matchedSection.startLine})`)
    }
    if (issue.matchedPathHint) {
      lines.push(`- matchedPathHint: \`${issue.matchedPathHint}\``)
    }
    if (issue.matchedSnippets?.length) {
      lines.push(`- matchedSnippets: ${issue.matchedSnippets.map((s) => `\`${s}\``).join('; ')}`)
    }
    if (issue.missing?.length) {
      lines.push(`- missing: ${issue.missing.map((s) => `\`${s}\``).join('; ')}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Map score + mode to process exit code (design §6).
 * 0 = harness ok and (record OR gate passed)
 * 1 = harness failed
 * 2 = gate failed while harness ok
 */
export function exitCodeForOracleScore(score) {
  if (score.harnessStatus !== 'ok') return 1
  if (score.oracleMode === 'gate' && score.gateStatus === 'failed') return 2
  return 0
}
