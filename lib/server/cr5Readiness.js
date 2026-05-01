import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const PASS_VERDICTS = new Set(['Closure-grade', 'Validator OK / QA concerns'])
const ISSUE_OUTCOMES = new Set(['found', 'partially found', 'missed', 'false positive nearby'])

function parseMarkdownRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

export function parseTelemetryLog(markdown) {
  const lines = markdown.split(/\r?\n/)
  const rows = []
  for (const line of lines) {
    const cells = parseMarkdownRow(line)
    if (!cells || cells.length < 21) continue
    if (cells[0] === 'Timestamp (UTC)' || cells[0] === '---') continue
    rows.push({
      timestamp: cells[0],
      repo: cells[1].replace(/`/g, ''),
      qaVerdict: cells[19].replace(/`/g, ''),
      correlationId: cells[20].replace(/`/g, ''),
    })
  }
  return rows
}

function parsePercent(raw) {
  if (typeof raw !== 'string') return null
  const match = raw.match(/(\d+(?:\.\d+)?)\s*%/)
  if (!match) return null
  return Number(match[1]) / 100
}

function parseBoolean(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (['yes', 'true', 'y', 'pass', 'passed'].includes(v)) return true
  if (['no', 'false', 'n', 'fail', 'failed'].includes(v)) return false
  return null
}

function extractRepoIdentity(markdown) {
  const lines = markdown.split(/\r?\n/)
  for (const line of lines) {
    const clean = line.replace(/^\s*[-*]\s*/, '').trim()
    if (/repo\s*:/i.test(clean)) {
      const repo = clean.split(':').slice(1).join(':').trim().replace(/`/g, '')
      if (repo) return repo
    }
  }
  return null
}

function parseOracleIssueComparisons(markdown) {
  const lines = markdown.split(/\r?\n/)
  const issues = []
  const canonicalIssues = []
  const issuePattern =
    /^[-*]\s*issue id\s*:\s*([^\s|]+).*severity\s*:\s*(critical|high|medium|low).*outcome\s*:\s*(found|partially found|missed|false positive nearby)/i
  let currentIssue = null

  for (const line of lines) {
    const heading = line.match(/^###\s+([A-Za-z0-9_-]+)\s*$/)
    if (heading) {
      if (currentIssue?.issueId && currentIssue?.severity) canonicalIssues.push(currentIssue)
      currentIssue = {
        issueId: heading[1].trim(),
        severity: null,
        mandatoryPass: null,
      }
      continue
    }

    const field = line.match(/^\s*[-*]\s*(severity|mandatory pass flag|outcome)\s*:\s*(.+)\s*$/i)
    if (field && currentIssue) {
      const key = field[1].toLowerCase()
      const value = field[2].replace(/`/g, '').trim()
      if (key === 'severity') {
        const sev = value.toLowerCase()
        if (['critical', 'high', 'medium', 'low'].includes(sev)) currentIssue.severity = sev
      } else if (key === 'mandatory pass flag') {
        currentIssue.mandatoryPass = parseBoolean(value)
      } else if (key === 'outcome') {
        const outcome = value.toLowerCase()
        if (ISSUE_OUTCOMES.has(outcome)) {
          issues.push({
            issueId: currentIssue.issueId,
            severity: currentIssue.severity,
            outcome,
          })
        }
      }
      continue
    }

    const row = parseMarkdownRow(line)
    if (row && row.length >= 3 && /^issue id$/i.test(row[0]) && /^severity$/i.test(row[1]) && /^outcome$/i.test(row[2])) {
      continue
    }
    if (row && row.length >= 3) {
      const severity = String(row[1] || '').trim().toLowerCase()
      const outcome = String(row[2] || '').trim().toLowerCase()
      const issueId = String(row[0] || '').trim()
      if (issueId && ['critical', 'high', 'medium', 'low'].includes(severity) && ISSUE_OUTCOMES.has(outcome)) {
        issues.push({ issueId, severity, outcome })
      }
      continue
    }
    const compact = line.trim().replace(/`/g, '')
    const match = compact.match(issuePattern)
    if (match) {
      issues.push({
        issueId: match[1],
        severity: match[2].toLowerCase(),
        outcome: match[3].toLowerCase(),
      })
    }
  }
  if (currentIssue?.issueId && currentIssue?.severity) canonicalIssues.push(currentIssue)
  return { issues, canonicalIssues }
}

function extractOracleOutcome(markdown) {
  const lines = markdown.split(/\r?\n/)
  const parsed = parseOracleIssueComparisons(markdown)
  const comparedIssuesById = new Map(parsed.issues.map((i) => [i.issueId, i]))
  const expectedIssues =
    parsed.canonicalIssues.length > 0
      ? parsed.canonicalIssues
      : parsed.issues.map((i) => ({
          issueId: i.issueId,
          severity: i.severity,
          mandatoryPass: null,
        }))
  const issueCount = expectedIssues.length
  const comparedIssueCount = expectedIssues.filter((i) => comparedIssuesById.has(i.issueId)).length
  const foundCount = expectedIssues.filter((i) => comparedIssuesById.get(i.issueId)?.outcome === 'found').length
  const recall = issueCount > 0 && comparedIssueCount === issueCount ? foundCount / issueCount : null
  const expectedCriticalHigh = expectedIssues.filter((i) => i.severity === 'critical' || i.severity === 'high')
  const missingCriticalHighOutcome = expectedCriticalHigh.some((i) => !comparedIssuesById.has(i.issueId))
  const criticalHighAllFound =
    expectedCriticalHigh.length === 0
      ? true
      : missingCriticalHighOutcome
        ? null
        : expectedCriticalHigh.every((i) => comparedIssuesById.get(i.issueId)?.outcome === 'found')

  const data = {
    repo: extractRepoIdentity(markdown),
    recall,
    criticalHighAllFound,
    reportQualityAccepted: null,
    telemetryComplete: null,
    pass: null,
    issueCount,
    comparedIssueCount,
    foundCount,
    partialCount: parsed.issues.filter((i) => i.outcome === 'partially found').length,
    missedCount: parsed.issues.filter((i) => i.outcome === 'missed').length,
    falsePositiveNearbyCount: parsed.issues.filter((i) => i.outcome === 'false positive nearby').length,
    hasCanonicalIssueEvidence: issueCount > 0,
  }

  for (const line of lines) {
    const clean = line.replace(/^\s*[-*]\s*/, '').trim()
    if (data.reportQualityAccepted == null && /report quality.*accepted/i.test(clean)) {
      data.reportQualityAccepted = parseBoolean(clean.split(':').slice(1).join(':').trim())
    }
    if (data.telemetryComplete == null && /telemetry.*complete/i.test(clean)) {
      data.telemetryComplete = parseBoolean(clean.split(':').slice(1).join(':').trim())
    }
    if (data.pass == null && /(final verdict|repo verdict|pass status)/i.test(clean)) {
      data.pass = parseBoolean(clean.split(':').slice(1).join(':').trim())
    }
    // Allow explicit recall override if provided.
    if (data.recall == null && /recall|find rate|expected-issue find rate/i.test(clean)) {
      data.recall = parsePercent(clean)
    }
  }
  return data
}

export function evaluateCr5Readiness({ telemetryRows, oracleOutcomes, nonRegressionGreen = true }) {
  const telemetryByRepo = new Map()
  for (const row of telemetryRows) {
    const current = telemetryByRepo.get(row.repo) || []
    current.push(row)
    telemetryByRepo.set(row.repo, current)
  }

  const consistentlyPassingRepos = []
  for (const [repo, rows] of telemetryByRepo.entries()) {
    const ordered = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const recent = ordered.slice(-2)
    if (recent.length < 2) continue
    if (recent.every((r) => PASS_VERDICTS.has(r.qaVerdict))) consistentlyPassingRepos.push(repo)
  }

  const oraclePassRepos = oracleOutcomes.filter((o) => {
    const hasRequiredEvidence =
      !!o.hasCanonicalIssueEvidence &&
      !!o.repo &&
      typeof o.issueCount === 'number' &&
      o.issueCount > 0 &&
      typeof o.comparedIssueCount === 'number' &&
      o.comparedIssueCount === o.issueCount
    return (
      hasRequiredEvidence &&
      o.pass === true &&
      o.recall != null &&
      o.recall > 0.8 &&
      o.criticalHighAllFound === true &&
      o.reportQualityAccepted === true &&
      o.telemetryComplete === true
    )
  })

  const repoPassSet = new Set(oraclePassRepos.map((o) => o.repo).filter(Boolean))
  const consistentlyPassingRepoSet = new Set(consistentlyPassingRepos)
  const consistentlyPassingOracleRepos = [...repoPassSet].filter((repo) =>
    consistentlyPassingRepoSet.has(repo)
  )
  const launchGatePassed = consistentlyPassingOracleRepos.length > 20
  // Fail closed for unknowns: null/undefined should fail launch gating integrity.
  const criticalHighRuleRespected =
    oracleOutcomes.length > 0 && oracleOutcomes.every((o) => o.criticalHighAllFound === true)
  const canonicalEvidenceComplete =
    oracleOutcomes.length > 0 &&
    oracleOutcomes.every((o) => o.hasCanonicalIssueEvidence && typeof o.issueCount === 'number' && o.issueCount > 0)
  const telemetryCompletenessRespected =
    oracleOutcomes.length > 0 && oracleOutcomes.every((o) => o.telemetryComplete === true)
  const allPassingReposTelemetryConsistent = [...repoPassSet].every((repo) =>
    consistentlyPassingRepoSet.has(repo)
  )

  return {
    launchGatePassed,
    nonRegressionGreen: !!nonRegressionGreen,
    criticalHighRuleRespected,
    canonicalEvidenceComplete,
    telemetryCompletenessRespected,
    allPassingReposTelemetryConsistent,
    telemetryCoverage: {
      uniqueReposLogged: telemetryByRepo.size,
      consistentlyPassingRepos: consistentlyPassingRepos.length,
      consistentlyPassingOracleRepos: consistentlyPassingOracleRepos.length,
    },
    oracleCoverage: {
      evaluatedRepos: oracleOutcomes.length,
      passingRepos: repoPassSet.size,
    },
    readinessPassed:
      launchGatePassed &&
      !!nonRegressionGreen &&
      criticalHighRuleRespected &&
      canonicalEvidenceComplete &&
      telemetryCompletenessRespected &&
      allPassingReposTelemetryConsistent,
  }
}

export function readOracleOutcomesFromFolder(folderPath) {
  const entries = readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /acceptance-criteria\.md$/i.test(entry.name))
    .map((entry) => join(folderPath, entry.name))

  return entries.map((path) => {
    const content = readFileSync(path, 'utf8')
    return extractOracleOutcome(content)
  })
}
