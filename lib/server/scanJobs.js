import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fetchRepositoryContent, probeGithubRepositoryAccess } from './github.js'
import { sanitizeGitHubUrl } from './sanitize.js'
import { analyzeSecurity } from './openai.js'
import { createQueuedDashboard, buildRepositoryDisplay } from './dimensionAnalysis.js'
import { getIngestionCaps } from './ingestionCaps.js'
import { buildScanJobLifecycleTelemetry, estimateUsageCostUsd } from './scanTelemetryPayload.js'
import { ReportQualityGateError } from './reportQualityGateError.js'
import { buildTelemetryLogEntry, tryAppendScanTelemetryLog } from './scanTelemetryLogAppend.js'
import { resolveOpenAIModel } from '../shared/openaiModels.js'
import { buildRunTelemetryPatch, createRunOnStart, mapJobStatusToRunStatus, upsertRunTelemetry } from './runTelemetryStore.js'

const jobs = new Map()
const JOB_TTL_MS = 1000 * 60 * 30

const SECRET_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /ghu_[A-Za-z0-9]{20,}/g,
  /ghs_[A-Za-z0-9]{20,}/g,
  /ghr_[A-Za-z0-9]{20,}/g,
]

function nowIso() {
  return new Date().toISOString()
}

function liveValidationArtifactsEnabled() {
  return (
    process.env.SECLENS_LIVE_VALIDATION_ARTIFACTS === 'true' ||
    process.env.SECLENS_LIVE_VALIDATION_ARTIFACTS === '1' ||
    process.env.NODE_ENV === 'development'
  )
}

function toFileSlug(value, fallback = 'unknown') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function formatArtifactTimestamp(isoValue) {
  const iso = String(isoValue || new Date().toISOString())
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/)
  if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`
  return iso.replace(/[:.]/g, '-')
}

function buildLiveArtifactFileName(record) {
  const ts = formatArtifactTimestamp(record.updatedAt || record.createdAt)
  const owner = toFileSlug(record?.repository?.owner, 'unknown-owner')
  const repo = toFileSlug(record?.repository?.name, 'unknown-repo')
  const status = toFileSlug(record?.status, 'unknown-status')
  const model = toFileSlug(record?.analysisModel || record?.requestedAnalysisModel, 'unknown-model')
  const jobShort = String(record?.jobId || '').slice(0, 8) || 'nojob'
  return `${ts}--${owner}-${repo}--${status}--${model}--${jobShort}.json`
}

function redactSensitiveString(value) {
  let out = String(value || '')
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED_TOKEN]')
  }
  return out
}

export function redactSensitiveTokens(value) {
  if (value == null) return value
  if (typeof value === 'string') return redactSensitiveString(value)
  if (Array.isArray(value)) return value.map((v) => redactSensitiveTokens(v))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactSensitiveTokens(v)])
    )
  }
  return value
}

/**
 * Best-effort JSON snapshot for QA (GUI and API scan jobs). Never throws to callers.
 * @param {object} record
 * @param {{ analysisCorrelationId?: string|null }} [extra]
 */
function tryWriteScanJobLiveArtifact(record, extra = {}) {
  if (!liveValidationArtifactsEnabled()) return
  try {
    const outDir = resolve(process.cwd(), '.seclens-live-validation')
    mkdirSync(outDir, { recursive: true })
    const outPath = join(outDir, buildLiveArtifactFileName(record))
    const dimensions = Array.isArray(record.dashboard?.dimensions) ? record.dashboard.dimensions : []
    const payload = {
      jobId: record.jobId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      error: record.error,
      repository: record.repository,
      telemetry: record.telemetry,
      requestedAnalysisModel: record.requestedAnalysisModel,
      analysisModel: record.analysisModel,
      analysisCorrelationId: extra.analysisCorrelationId ?? null,
      dashboard: record.dashboard
        ? {
            runState: record.dashboard.runState,
            consolidatedReportAvailable: record.dashboard.consolidatedReportAvailable,
            reportReadinessReasons: record.dashboard.reportReadinessReasons,
            summary: record.dashboard.summary,
            dimensions: dimensions.map((d) => ({
              dimensionId: d.dimensionId,
              label: d.label,
              progress: d.progress,
              status: d.status,
              applicability: d.applicability,
              findingsCount: Array.isArray(d.findings) ? d.findings.length : 0,
              reviewedFiles: d.coverage?.reviewedFiles ?? 0,
            })),
          }
        : null,
      reportLength: typeof record.report === 'string' ? record.report.length : 0,
      reportValidationOk: record.reportValidation?.ok ?? null,
    }
    const safePayload = redactSensitiveTokens(payload)
    writeFileSync(outPath, JSON.stringify(safePayload, null, 2))
  } catch (err) {
    console.warn('[scan-job] live artifact write failed:', err instanceof Error ? err.message : String(err))
  }
}

function cleanupExpiredJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [jobId, job] of jobs.entries()) {
    if (Date.parse(job.updatedAt || job.createdAt || 0) < cutoff) {
      jobs.delete(jobId)
    }
  }
}

function baseJobRecord({
  jobId,
  repositoryUrl,
  analysisModel,
  requestedAnalysisModel = null,
  triggeredBy = null,
  ingestionCaps = null,
}) {
  const repository = buildRepositoryDisplay(repositoryUrl)
  const resolvedModel = resolveOpenAIModel(analysisModel)
  const caps =
    ingestionCaps && typeof ingestionCaps === 'object' ? ingestionCaps : getIngestionCaps()
  return {
    jobId,
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    repository,
    dashboard: createQueuedDashboard(repository),
    report: null,
    reportValidation: null,
    telemetry: null,
    requestedAnalysisModel: requestedAnalysisModel || null,
    analysisModel: resolvedModel.id,
    triggeredBy: triggeredBy && typeof triggeredBy === 'object' ? triggeredBy : null,
    ingestionCaps: caps,
    error: null,
  }
}

function summarizeJob(record) {
  return {
    jobId: record.jobId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    repository: record.repository,
    dashboard: record.dashboard,
    report: record.report,
    reportValidation: record.reportValidation,
    telemetry: record.telemetry,
    requestedAnalysisModel: record.requestedAnalysisModel,
    analysisModel: record.analysisModel,
    triggeredBy: record.triggeredBy,
    error: record.error,
  }
}

function buildFileSelectionSummary(telemetry) {
  const ingestion = telemetry?.ingestion
  if (!ingestion || typeof ingestion !== 'object') return null
  return {
    selectedFileCount: ingestion.selectedFileCount ?? null,
    omittedFileCount: ingestion.omittedFileCount ?? null,
    capHits: Array.isArray(ingestion.capHits) ? ingestion.capHits : [],
    coverageSummary: ingestion.coverageSummary ?? null,
  }
}

function buildDimensionSummary(dashboard) {
  const totals = dashboard?.summary?.totals
  if (!totals || typeof totals !== 'object') return null
  return {
    dimensionsReviewed: totals.dimensionsReviewed ?? null,
    totalDimensions: totals.totalDimensions ?? null,
    findingsAdmitted: totals.findingsAdmitted ?? null,
    statusDistribution: totals.statusDistribution ?? null,
    progressDistribution: totals.progressDistribution ?? null,
  }
}

function buildModelUsageSummary(analysisResult, fallbackModel) {
  const total = analysisResult?.tokenUsage?.total
  const telemetry = analysisResult?.dashboard?.telemetry
  if (!total && !telemetry) return null
  const modelId = analysisResult?.analysisModel || fallbackModel || null
  const estimatedFromDashboard = telemetry?.estimatedCostUsd
  const estimatedFromUsage =
    total && typeof total.total_tokens === 'number' && total.total_tokens > 0
      ? estimateUsageCostUsd(total, modelId)
      : null
  return {
    analysisModel: modelId,
    requestedAnalysisModel: analysisResult?.requestedAnalysisModel || null,
    promptTokens: total?.prompt_tokens ?? null,
    completionTokens: total?.completion_tokens ?? null,
    totalTokens: total?.total_tokens ?? null,
    estimatedCostUsd: estimatedFromDashboard ?? estimatedFromUsage ?? null,
  }
}

/**
 * Dashboard `telemetry` intentionally omits `tokenUsage` (authoritative usage is on `analysisResult`).
 * Merge before persisting telemetryLogEntry so admin SCAN rows match modelUsageSummary / markdown log.
 */
function mergeTelemetryForLogEntry(telemetry, analysisResult, jobStartedAtMs) {
  const base = telemetry && typeof telemetry === 'object' ? { ...telemetry } : {}
  const tu = analysisResult?.tokenUsage
  const total = tu?.total
  if (total && typeof total.total_tokens === 'number' && total.total_tokens > 0) {
    base.tokenUsage = {
      draft: tu.draft ?? null,
      critic: tu.critic ?? null,
      total,
    }
    const modelId = analysisResult?.analysisModel || base.analysisModel
    base.estimatedCostUsd = estimateUsageCostUsd(total, modelId)
  }
  if (typeof jobStartedAtMs === 'number' && jobStartedAtMs > 0) {
    const elapsedMs = Math.max(0, Date.now() - jobStartedAtMs)
    base.duration = {
      elapsedMs,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
    }
  }
  return base
}

function queueRunTelemetryUpdate(runId, patch) {
  void upsertRunTelemetry(runId, patch).catch(() => {})
}

export function getScanJob(jobId) {
  cleanupExpiredJobs()
  return jobs.get(jobId) || null
}

/** Remove an in-memory scan job (admin cleanup). Returns whether a job was removed. */
export function deleteScanJob(jobId) {
  const id = typeof jobId === 'string' ? jobId.trim() : ''
  if (!id) return false
  cleanupExpiredJobs()
  return jobs.delete(id)
}

export async function createScanJob({
  repositoryUrl,
  githubToken,
  analysisModel,
  requestedAnalysisModel = null,
  triggeredBy = null,
  ingestionCaps = null,
}) {
  cleanupExpiredJobs()
  const sanitizedUrl = sanitizeGitHubUrl(repositoryUrl?.trim())
  if (!sanitizedUrl) {
    throw new Error('Invalid GitHub repository URL format')
  }

  const probeCache = await probeGithubRepositoryAccess(sanitizedUrl, { githubToken })

  const jobId = randomUUID()
  const record = baseJobRecord({
    jobId,
    repositoryUrl: sanitizedUrl,
    analysisModel,
    requestedAnalysisModel,
    triggeredBy,
    ingestionCaps,
  })
  jobs.set(jobId, record)
  await createRunOnStart({
    runId: jobId,
    repository: record.repository,
    requestedAnalysisModel: record.requestedAnalysisModel || null,
    analysisModel: record.analysisModel || null,
    triggeredBy: record.triggeredBy,
  })

  void runScanJob({
    jobId,
    repositoryUrl: sanitizedUrl,
    githubToken,
    analysisModel: record.analysisModel,
    requestedAnalysisModel: record.requestedAnalysisModel,
    probeCache,
  })

  return summarizeJob(record)
}

async function runScanJob({
  jobId,
  repositoryUrl,
  githubToken,
  analysisModel,
  requestedAnalysisModel = null,
  probeCache,
}) {
  const record = jobs.get(jobId)
  if (!record) return

  const triggeredBy = record.triggeredBy && typeof record.triggeredBy === 'object' ? record.triggeredBy : null

  let repoData
  const jobStartedAtMs = Date.now()

  try {
    record.status = 'fetching'
    record.updatedAt = nowIso()
    {
      const prevDash = record.dashboard || createQueuedDashboard(record.repository)
      record.dashboard = {
        ...prevDash,
        runState: 'fetching',
        updatedAt: nowIso(),
      }
    }
    queueRunTelemetryUpdate(
      jobId,
      buildRunTelemetryPatch({
        status: mapJobStatusToRunStatus(record.status),
        runState: record.status,
        triggeredBy,
      })
    )

    repoData = await fetchRepositoryContent(repositoryUrl, {
      githubToken,
      probeCache,
      ingestionCaps: record.ingestionCaps,
    })
    record.repository = buildRepositoryDisplay(repositoryUrl, repoData)
    record.dashboard = {
      ...(record.dashboard || createQueuedDashboard(record.repository)),
      repository: record.repository,
      runState: 'running',
      updatedAt: nowIso(),
    }
    record.status = 'running'
    record.updatedAt = nowIso()
    queueRunTelemetryUpdate(
      jobId,
      buildRunTelemetryPatch({
        status: mapJobStatusToRunStatus(record.status),
        runState: record.status,
        repository: record.repository,
        triggeredBy,
      })
    )

    const analysisResult = await analyzeSecurity(repoData, {
      analysisModel,
      ingestionCaps: record.ingestionCaps,
      onProgress: (dashboard) => {
        const current = jobs.get(jobId)
        if (!current) return
        current.dashboard = dashboard
        current.updatedAt = nowIso()
        if (dashboard.runState === 'completed') {
          current.status = 'completed'
        } else if (dashboard.runState === 'synthesizing') {
          current.status = 'synthesizing'
        } else {
          current.status = 'running'
        }
        queueRunTelemetryUpdate(
          jobId,
          buildRunTelemetryPatch({
            status: mapJobStatusToRunStatus(current.status),
            runState: dashboard.runState || current.status,
            repository: current.repository,
            dimensionSummary: buildDimensionSummary(dashboard),
            triggeredBy: current.triggeredBy && typeof current.triggeredBy === 'object' ? current.triggeredBy : null,
          })
        )
      },
    })

    tryAppendScanTelemetryLog({
      analysisResult: {
        ...analysisResult,
        requestedAnalysisModel: requestedAnalysisModel || record.requestedAnalysisModel || null,
      },
      repoData,
      requestStartedAtMs: jobStartedAtMs,
      repository: record.repository,
      reportValidation: analysisResult.reportValidation ?? null,
    })

    record.report = analysisResult.report
    record.reportValidation = analysisResult.reportValidation
    record.telemetry = analysisResult.dashboard?.telemetry || null
    record.dashboard = analysisResult.dashboard || record.dashboard
    record.status = 'completed'
    record.updatedAt = nowIso()

    const lifecycle = buildScanJobLifecycleTelemetry({
      outcome: 'completed',
      dashboard: record.dashboard,
      correlationId: analysisResult.correlationId ?? null,
      analysisModel: analysisResult.analysisModel ?? record.analysisModel ?? analysisModel ?? null,
      requestedAnalysisModel: requestedAnalysisModel || record.requestedAnalysisModel || null,
    })
    record.telemetry =
      record.telemetry && typeof record.telemetry === 'object' ? { ...lifecycle, ...record.telemetry } : lifecycle
    queueRunTelemetryUpdate(
      jobId,
      buildRunTelemetryPatch({
        status: 'SUCCESS',
        runState: record.dashboard?.runState || 'completed',
        completedAt: record.updatedAt,
        repository: record.repository,
        warnings: Array.isArray(analysisResult?.advisoryOutput?.warnings) ? analysisResult.advisoryOutput.warnings : [],
        errors: Array.isArray(analysisResult?.advisoryOutput?.errors) ? analysisResult.advisoryOutput.errors : [],
        fileSelectionSummary: buildFileSelectionSummary(record.telemetry),
        dimensionSummary: buildDimensionSummary(record.dashboard),
        modelUsageSummary: buildModelUsageSummary(
          {
            ...analysisResult,
            requestedAnalysisModel: requestedAnalysisModel || record.requestedAnalysisModel || null,
          },
          record.analysisModel
        ),
        requestedAnalysisModel: requestedAnalysisModel || record.requestedAnalysisModel || null,
        analysisModel: analysisResult.analysisModel || record.analysisModel || null,
        correlationId: analysisResult.correlationId || null,
        triggeredBy,
        telemetry: record.telemetry && typeof record.telemetry === 'object' ? record.telemetry : null,
        dashboard: record.dashboard && typeof record.dashboard === 'object' ? record.dashboard : null,
        telemetryLogEntry: buildTelemetryLogEntry({
          telemetry: mergeTelemetryForLogEntry(record.telemetry, analysisResult, jobStartedAtMs),
          repository: {
            owner: record.repository?.owner,
            name: record.repository?.name,
          },
          reportContractVersion: analysisResult.reportContractVersion || null,
          reportValidation: analysisResult.reportValidation || null,
          gateError: null,
          analysisError: null,
        }),
      })
    )
    tryWriteScanJobLiveArtifact(record, { analysisCorrelationId: analysisResult.correlationId ?? null })
  } catch (error) {
    const current = jobs.get(jobId)
    if (!current) return
    if (repoData) {
      if (error instanceof ReportQualityGateError) {
        tryAppendScanTelemetryLog({
          analysisResult: {
            correlationId: error.correlationId,
            analysisModel: current.analysisModel ?? analysisModel ?? null,
            requestedAnalysisModel: current.requestedAnalysisModel ?? requestedAnalysisModel ?? null,
          },
          repoData,
          requestStartedAtMs: jobStartedAtMs,
          repository: current.repository,
          gateError: { categories: error.categories },
        })
      } else {
        tryAppendScanTelemetryLog({
          analysisResult: {
            analysisModel: current.analysisModel ?? analysisModel ?? null,
            requestedAnalysisModel: current.requestedAnalysisModel ?? requestedAnalysisModel ?? null,
          },
          repoData,
          requestStartedAtMs: jobStartedAtMs,
          repository: current.repository,
          analysisError: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
    current.status = 'failed'
    current.updatedAt = nowIso()
    current.error = error instanceof Error ? error.message : String(error)
    current.dashboard = {
      ...(current.dashboard || createQueuedDashboard(current.repository)),
      runState: 'failed',
      completedAt: nowIso(),
      updatedAt: nowIso(),
    }
    const correlationId = error instanceof ReportQualityGateError ? error.correlationId : null
    const priorTelemetry = current.telemetry && typeof current.telemetry === 'object' ? current.telemetry : null
    current.telemetry = {
      ...buildScanJobLifecycleTelemetry({
        outcome: 'failed',
        errorMessage: current.error,
        dashboard: current.dashboard,
        correlationId,
        analysisModel: current.analysisModel ?? analysisModel ?? null,
        requestedAnalysisModel: current.requestedAnalysisModel ?? requestedAnalysisModel ?? null,
      }),
      ...(priorTelemetry ? { priorRunTelemetry: priorTelemetry } : {}),
    }
    queueRunTelemetryUpdate(
      jobId,
      buildRunTelemetryPatch({
        status: 'FAILED',
        reasonCode: 'RUN_EXECUTION_FAILED',
        runState: current.dashboard?.runState || 'failed',
        completedAt: current.updatedAt,
        repository: current.repository,
        warnings: [],
        errors: [current.error].filter(Boolean),
        fileSelectionSummary: buildFileSelectionSummary(current.telemetry),
        dimensionSummary: buildDimensionSummary(current.dashboard),
        modelUsageSummary: {
          analysisModel: current.analysisModel || analysisModel || null,
          requestedAnalysisModel: current.requestedAnalysisModel || requestedAnalysisModel || null,
        },
        requestedAnalysisModel: current.requestedAnalysisModel || requestedAnalysisModel || null,
        analysisModel: current.analysisModel || analysisModel || null,
        correlationId,
        triggeredBy:
          current.triggeredBy && typeof current.triggeredBy === 'object' ? current.triggeredBy : null,
        telemetry: current.telemetry && typeof current.telemetry === 'object' ? current.telemetry : null,
        telemetryLogEntry: buildTelemetryLogEntry({
          telemetry: mergeTelemetryForLogEntry(current.telemetry, {}, jobStartedAtMs),
          repository: {
            owner: current.repository?.owner || repoData?.owner || 'unknown',
            name: current.repository?.name || repoData?.repo || 'unknown',
          },
          reportContractVersion: null,
          reportValidation: null,
          gateError: error instanceof ReportQualityGateError ? { categories: error.categories } : null,
          analysisError: error instanceof Error ? error : new Error(String(error)),
        }),
      })
    )
    tryWriteScanJobLiveArtifact(current, { analysisCorrelationId: correlationId })
  }
}

export function getScanJobResponse(jobId) {
  const record = getScanJob(jobId)
  if (!record) return null
  return summarizeJob(record)
}

export function buildScanJobTelemetryCaps() {
  const caps = getIngestionCaps()
  return {
    maxFiles: caps.maxFiles,
    maxBytesPerFile: caps.maxBytesPerFile,
    maxTotalBytes: caps.maxTotalBytes,
    maxTreeEntries: caps.maxTreeEntries,
  }
}

export function listRecentScanJobs(limit = 50) {
  cleanupExpiredJobs()
  const max = Number.isFinite(limit) ? Math.max(1, Math.min(200, Number(limit))) : 50
  return Array.from(jobs.values())
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
    .slice(0, max)
    .map((record) => summarizeJob(record))
}
