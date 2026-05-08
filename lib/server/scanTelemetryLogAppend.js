/**
 * Append one row to canonical SCAN-TELEMETRY-LOG.md (CR-2.1-001 / CR-2.1-005).
 * Path: SECLENS_TELEMETRY_LOG, or SECLENS_ASSETS_ROOT + design/.../SCAN-TELEMETRY-LOG.md, or common repo-relative Assets locations (see listScanTelemetryLogPathCandidates).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

import { buildTelemetry } from './scanTelemetryPayload.js'

const APPEND_DISABLED = () => {
  const v = String(process.env.SECLENS_TELEMETRY_LOG_APPEND || '').trim().toLowerCase()
  return v === 'false' || v === '0'
}

/** Relative path under an Assets root or repo-adjacent folder. */
const SCAN_TELEMETRY_LOG_REL = join('design', 'mvp4 - launch-readiness', 'SCAN-TELEMETRY-LOG.md')

/**
 * Ordered candidates so scan-jobs and /api/analyze append to the real log from common workspace layouts.
 */
export function listScanTelemetryLogPathCandidates() {
  const cwd = process.cwd()
  const out = []
  if (process.env.SECLENS_TELEMETRY_LOG) {
    out.push(resolve(process.env.SECLENS_TELEMETRY_LOG))
  }
  if (process.env.SECLENS_ASSETS_ROOT) {
    out.push(join(resolve(process.env.SECLENS_ASSETS_ROOT), SCAN_TELEMETRY_LOG_REL))
  }
  out.push(resolve(cwd, '..', '..', 'Assets', 'flowinternals-seclens-app-Assets', SCAN_TELEMETRY_LOG_REL))
  out.push(resolve(cwd, '..', 'flowinternals-seclens-app-Assets', SCAN_TELEMETRY_LOG_REL))
  return [...new Set(out.filter(Boolean))]
}

/** First existing log file, or the primary default path (for diagnostics). */
export function resolveScanTelemetryLogPath() {
  const candidates = listScanTelemetryLogPathCandidates()
  return (
    candidates.find((p) => existsSync(p)) ||
    candidates[0] ||
    join(resolve(process.cwd(), '..', '..', 'Assets', 'flowinternals-seclens-app-Assets'), SCAN_TELEMETRY_LOG_REL)
  )
}

function resolveScanTelemetryLogPathForWrite() {
  const candidates = listScanTelemetryLogPathCandidates()
  return candidates.find((p) => existsSync(p)) || null
}

function findTelemetryRowInsertIndex(content) {
  const needles = ['\n## Exceptional run notes (appendix', '\n## Exceptional run notes']
  for (const n of needles) {
    const i = content.indexOf(n)
    if (i !== -1) return i
  }
  const loose = content.indexOf('## Exceptional run notes')
  if (loose === -1) return -1
  const before = content.lastIndexOf('\n', loose)
  return before === -1 ? loose : before
}

function utcTimestampForLog() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

function formatDurationShort(elapsedMs) {
  if (elapsedMs == null || elapsedMs < 1000) return '-'
  const totalSec = Math.floor(elapsedMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s}s`
}

function formatCapHitsCell(capHits) {
  if (!Array.isArray(capHits) || capHits.length === 0) return '`none`'
  return capHits.map((h) => `\`${String(h).replace(/`/g, '')}\``).join(', ')
}

function escPipe(s) {
  return String(s ?? '').replace(/\|/g, '\\|')
}

function deriveQaVerdict(reportValidation, gateError) {
  if (gateError) return 'Quality-gate fail'
  if (reportValidation && reportValidation.ok === false) return 'Quality-gate fail'
  return 'Validator OK / QA concerns'
}

export function buildTelemetryLogEntry({
  telemetry,
  repository,
  reportContractVersion,
  reportValidation,
  gateError,
  analysisError,
}) {
  const ts = utcTimestampForLog()
  const owner = repository?.owner || 'unknown'
  const name = repository?.name || 'unknown'
  const repo = `${owner}/${name}`
  const profile = telemetry.profile || 'custom'
  const caps = telemetry.caps || {}
  const maxFiles = caps.maxFiles ?? null
  const bytesPerFile = caps.maxBytesPerFile ?? null
  const totalEvidenceBytes = caps.maxTotalEvidenceBytes ?? null
  const treeCap = caps.maxTreeEntries ?? null
  const ing = telemetry.ingestion || {}
  const selectedFileCount = ing.selectedFileCount ?? null
  const omittedFileCount = ing.omittedFileCount ?? null
  const selectedOmitted =
    selectedFileCount != null && omittedFileCount != null
      ? `${selectedFileCount} / ${omittedFileCount}`
      : null
  const capHits = Array.isArray(ing.capHits) ? ing.capHits : []
  const durationShort = formatDurationShort(telemetry.duration?.elapsedMs)
  const contract = reportContractVersion || null
  let validation = 'OK'
  if (gateError?.categories?.length) {
    validation = `FAIL: ${gateError.categories.join(', ')}`
  } else if (reportValidation && reportValidation.ok === false) {
    const cats = [
      ...(reportValidation.finalValidationCategories || []),
      ...(reportValidation.initialValidationCategories || []),
    ].filter(Boolean)
    const uniq = [...new Set(cats)]
    validation = uniq.length ? `FAIL: ${uniq.join(', ')}` : 'FAIL'
  }
  const criticRepairRan = !!telemetry.criticRepairRan
  const draft = telemetry.tokenUsage?.draft || {}
  const criticU = telemetry.tokenUsage?.critic
  const total = telemetry.tokenUsage?.total || {}
  const hasTokens = (total.total_tokens || 0) > 0
  const draftIn = hasTokens ? draft.prompt_tokens ?? 0 : null
  const draftOut = hasTokens ? draft.completion_tokens ?? 0 : null
  const criticIn =
    criticU && (criticU.prompt_tokens > 0 || criticU.completion_tokens > 0) ? criticU.prompt_tokens ?? 0 : null
  const criticOut =
    criticU && (criticU.prompt_tokens > 0 || criticU.completion_tokens > 0) ? criticU.completion_tokens ?? 0 : null
  const totalTokens = hasTokens ? total.total_tokens ?? 0 : null
  const estimatedCostUsd = hasTokens && telemetry.estimatedCostUsd != null ? telemetry.estimatedCostUsd : null

  let qaVerdict = deriveQaVerdict(reportValidation, gateError)
  if (analysisError && !gateError) {
    qaVerdict = 'Operational failure'
  }

  return {
    timestampUtc: ts,
    repo,
    profile,
    maxFiles,
    bytesPerFile,
    totalEvidenceBytes,
    treeCap,
    selectedFileCount,
    omittedFileCount,
    selectedOmitted,
    capHits,
    durationShort: durationShort === '-' ? null : durationShort,
    contractVersion: contract,
    validation,
    criticRepairRan,
    draftIn,
    draftOut,
    criticIn,
    criticOut,
    totalTokens,
    estimatedCostUsd,
    qaVerdict,
    correlationId: telemetry.correlationId || null,
    analysisModel: telemetry.analysisModel || null,
  }
}

/**
 * Build one markdown table row matching SCAN-TELEMETRY-LOG.md schema.
 * @param {object} params
 * @param {ReturnType<typeof buildTelemetry>} params.telemetry
 * @param {{ owner?: string, name?: string }} params.repository
 * @param {string | null} params.reportContractVersion
 * @param {object | null} params.reportValidation
 * @param {{ categories?: string[] } | null} params.gateError ReportQualityGateError-like
 * @param {Error | null} params.analysisError non-gate failure after OpenAI started
 */
export function buildTelemetryMarkdownTableRow({
  telemetry,
  repository,
  reportContractVersion,
  reportValidation,
  gateError,
  analysisError,
}) {
  const entry = buildTelemetryLogEntry({
    telemetry,
    repository,
    reportContractVersion,
    reportValidation,
    gateError,
    analysisError,
  })
  const ts = entry.timestampUtc
  const repo = `\`${escPipe(entry.repo || '-')}\``
  const profile = `\`${escPipe(entry.profile || 'custom')}\``
  const maxFiles = entry.maxFiles != null ? String(entry.maxFiles) : '-'
  const bytesPerFile = entry.bytesPerFile != null ? String(entry.bytesPerFile) : '-'
  const totalEv = entry.totalEvidenceBytes != null ? String(entry.totalEvidenceBytes) : '-'
  const treeCap = entry.treeCap != null ? String(entry.treeCap) : '-'
  const sel = entry.selectedOmitted || '-'
  const capHits = formatCapHitsCell(entry.capHits)
  const duration = entry.durationShort || '-'
  const contract = entry.contractVersion ? `\`${escPipe(entry.contractVersion)}\`` : '`-`'
  const validation = entry.validation || 'OK'
  const critic = entry.criticRepairRan ? 'Yes' : 'No'
  const draftIn = entry.draftIn != null ? String(entry.draftIn) : '-'
  const draftOut = entry.draftOut != null ? String(entry.draftOut) : '-'
  const criticIn = entry.criticIn != null ? String(entry.criticIn) : '-'
  const criticOut = entry.criticOut != null ? String(entry.criticOut) : '-'
  const totalTok = entry.totalTokens != null ? String(entry.totalTokens) : '-'
  const cost = entry.estimatedCostUsd != null ? String(entry.estimatedCostUsd) : '-'
  const qa = entry.qaVerdict || 'Validator OK / QA concerns'
  const corrRaw = entry.correlationId || '-'
  const correlation = corrRaw === '-' ? '`-`' : `\`${escPipe(corrRaw)}\``
  const analysisModel = entry.analysisModel ? `\`${escPipe(entry.analysisModel)}\`` : '`-`'

  return `| ${ts} | ${repo} | ${profile} | ${maxFiles} | ${bytesPerFile} | ${totalEv} | ${treeCap} | ${sel} | ${capHits} | ${duration} | ${contract} | ${validation} | ${critic} | ${draftIn} | ${draftOut} | ${criticIn} | ${criticOut} | ${totalTok} | ${cost} | \`${escPipe(qa)}\` | ${correlation} | ${analysisModel} |`
}

/**
 * Append a telemetry row to the canonical log (best-effort; never throws to callers).
 */
export function tryAppendScanTelemetryLog({
  analysisResult = {},
  repoData,
  requestStartedAtMs,
  repository,
  reportContractVersion = null,
  reportValidation = null,
  gateError = null,
  analysisError = null,
} = {}) {
  if (APPEND_DISABLED()) return
  if (!repoData) return

  const logPath = resolveScanTelemetryLogPathForWrite()
  if (!logPath) {
    console.warn('[telemetry-log] SCAN-TELEMETRY-LOG.md not found; set SECLENS_TELEMETRY_LOG or SECLENS_ASSETS_ROOT. Tried:', listScanTelemetryLogPathCandidates().join(' | '))
    return
  }

  try {
    const telemetry = buildTelemetry(analysisResult, repoData, requestStartedAtMs)
    const row = buildTelemetryMarkdownTableRow({
      telemetry,
      repository: repository || { owner: repoData.owner, name: repoData.repo },
      reportContractVersion: reportContractVersion ?? analysisResult.reportContractVersion ?? null,
      reportValidation: reportValidation ?? analysisResult.reportValidation ?? null,
      gateError,
      analysisError,
    })

    let content = readFileSync(logPath, 'utf8')
    const idx = findTelemetryRowInsertIndex(content)
    if (idx !== -1) {
      content = content.slice(0, idx) + `\n${row}` + content.slice(idx)
    } else {
      content = `${content.trimEnd()}\n${row}\n`
    }
    writeFileSync(logPath, content, 'utf8')
  } catch (err) {
    console.warn('[telemetry-log] append failed:', err instanceof Error ? err.message : String(err))
  }
}
