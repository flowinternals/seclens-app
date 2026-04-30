import { randomUUID } from 'crypto'
import { fetchRepositoryContent } from './github.js'
import { sanitizeGitHubUrl } from './sanitize.js'
import { analyzeSecurity } from './openai.js'
import { createQueuedDashboard, buildRepositoryDisplay } from './dimensionAnalysis.js'
import { getIngestionCaps } from './ingestionCaps.js'

const jobs = new Map()
const JOB_TTL_MS = 1000 * 60 * 30

function nowIso() {
  return new Date().toISOString()
}

function cleanupExpiredJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [jobId, job] of jobs.entries()) {
    if (Date.parse(job.updatedAt || job.createdAt || 0) < cutoff) {
      jobs.delete(jobId)
    }
  }
}

function baseJobRecord({ jobId, repositoryUrl }) {
  const repository = buildRepositoryDisplay(repositoryUrl)
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
    error: record.error,
  }
}

export function getScanJob(jobId) {
  cleanupExpiredJobs()
  return jobs.get(jobId) || null
}

export async function createScanJob({ repositoryUrl, githubToken }) {
  cleanupExpiredJobs()
  const sanitizedUrl = sanitizeGitHubUrl(repositoryUrl?.trim())
  if (!sanitizedUrl) {
    throw new Error('Invalid GitHub repository URL format')
  }

  const jobId = randomUUID()
  const record = baseJobRecord({ jobId, repositoryUrl: sanitizedUrl })
  jobs.set(jobId, record)

  void runScanJob({ jobId, repositoryUrl: sanitizedUrl, githubToken })

  return summarizeJob(record)
}

async function runScanJob({ jobId, repositoryUrl, githubToken }) {
  const record = jobs.get(jobId)
  if (!record) return

  try {
    record.status = 'fetching'
    record.updatedAt = nowIso()

    const repoData = await fetchRepositoryContent(repositoryUrl, { githubToken })
    record.repository = buildRepositoryDisplay(repositoryUrl, repoData)
    record.dashboard = {
      ...(record.dashboard || createQueuedDashboard(record.repository)),
      repository: record.repository,
      updatedAt: nowIso(),
    }
    record.status = 'running'
    record.updatedAt = nowIso()

    const analysisResult = await analyzeSecurity(repoData, {
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

    record.report = analysisResult.report
    record.reportValidation = analysisResult.reportValidation
    record.telemetry = analysisResult.dashboard?.telemetry || null
    record.dashboard = analysisResult.dashboard || record.dashboard
    record.status = 'completed'
    record.updatedAt = nowIso()
  } catch (error) {
    const current = jobs.get(jobId)
    if (!current) return
    current.status = 'failed'
    current.updatedAt = nowIso()
    current.error = error instanceof Error ? error.message : String(error)
    current.dashboard = {
      ...(current.dashboard || createQueuedDashboard(current.repository)),
      runState: 'failed',
      updatedAt: nowIso(),
    }
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
