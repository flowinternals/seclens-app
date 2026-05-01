import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fetchRepositoryContent } from './github.js'
import { sanitizeGitHubUrl } from './sanitize.js'
import { analyzeSecurity } from './openai.js'
import { createQueuedDashboard, buildRepositoryDisplay } from './dimensionAnalysis.js'
import { getIngestionCaps } from './ingestionCaps.js'
import { buildScanJobLifecycleTelemetry } from './scanTelemetryPayload.js'
import { ReportQualityGateError } from './reportQualityGateError.js'
import { tryAppendScanTelemetryLog } from './scanTelemetryLogAppend.js'
import { resolveOpenAIModel } from '../shared/openaiModels.js'

const jobs = new Map()
const JOB_TTL_MS = 1000 * 60 * 30

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
    writeFileSync(outPath, JSON.stringify(payload, null, 2))
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

function baseJobRecord({ jobId, repositoryUrl, analysisModel, requestedAnalysisModel = null }) {
  const repository = buildRepositoryDisplay(repositoryUrl)
  const resolvedModel = resolveOpenAIModel(analysisModel)
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
    error: record.error,
  }
}

export function getScanJob(jobId) {
  cleanupExpiredJobs()
  return jobs.get(jobId) || null
}

export async function createScanJob({ repositoryUrl, githubToken, analysisModel, requestedAnalysisModel = null }) {
  cleanupExpiredJobs()
  const sanitizedUrl = sanitizeGitHubUrl(repositoryUrl?.trim())
  if (!sanitizedUrl) {
    throw new Error('Invalid GitHub repository URL format')
  }

  const jobId = randomUUID()
  const record = baseJobRecord({
    jobId,
    repositoryUrl: sanitizedUrl,
    analysisModel,
    requestedAnalysisModel,
  })
  jobs.set(jobId, record)

  void runScanJob({
    jobId,
    repositoryUrl: sanitizedUrl,
    githubToken,
    analysisModel: record.analysisModel,
    requestedAnalysisModel: record.requestedAnalysisModel,
  })

  return summarizeJob(record)
}

async function runScanJob({ jobId, repositoryUrl, githubToken, analysisModel, requestedAnalysisModel = null }) {
  const record = jobs.get(jobId)
  if (!record) return

  let repoData
  const jobStartedAtMs = Date.now()

  try {
    record.status = 'fetching'
    record.updatedAt = nowIso()

    repoData = await fetchRepositoryContent(repositoryUrl, { githubToken })
    record.repository = buildRepositoryDisplay(repositoryUrl, repoData)
    record.dashboard = {
      ...(record.dashboard || createQueuedDashboard(record.repository)),
      repository: record.repository,
      updatedAt: nowIso(),
    }
    record.status = 'running'
    record.updatedAt = nowIso()

    const analysisResult = await analyzeSecurity(repoData, {
      analysisModel,
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
