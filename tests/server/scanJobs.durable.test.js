import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const probeGithubRepositoryAccessMock = vi.fn()
const fetchRepositoryContentMock = vi.fn()
const analyzeSecurityMock = vi.fn()
const createRunOnStartMock = vi.fn()
const upsertRunTelemetryMock = vi.fn()
const scheduleBackgroundWorkMock = vi.fn((work) => {
  const run = typeof work === 'function' ? work() : work
  return Promise.resolve(run)
})

vi.mock('../../lib/server/github.js', () => ({
  probeGithubRepositoryAccess: (...args) => probeGithubRepositoryAccessMock(...args),
  fetchRepositoryContent: (...args) => fetchRepositoryContentMock(...args),
}))

vi.mock('../../lib/server/openai.js', () => ({
  analyzeSecurity: (...args) => analyzeSecurityMock(...args),
}))

vi.mock('../../lib/server/runTelemetryStore.js', () => ({
  createRunOnStart: (...args) => createRunOnStartMock(...args),
  upsertRunTelemetry: (...args) => upsertRunTelemetryMock(...args),
  buildRunTelemetryPatch: (patch) => patch,
  mapJobStatusToRunStatus: (status) => (status === 'completed' ? 'SUCCESS' : status === 'failed' ? 'FAILED' : 'RUNNING'),
}))

vi.mock('../../lib/server/scheduleBackgroundWork.js', () => ({
  scheduleBackgroundWork: (...args) => scheduleBackgroundWorkMock(...args),
}))

vi.mock('../../lib/server/scanTelemetryLogAppend.js', () => ({
  tryAppendScanTelemetryLog: () => {},
  buildTelemetryLogEntry: () => ({ entry: true }),
}))

describe('scanJobs durable lifecycle', () => {
  /** @type {Map<string, object>} */
  let durableJobs
  /** @type {Map<string, object>} */
  let durableIdempotency

  beforeEach(async () => {
    vi.resetModules()
    probeGithubRepositoryAccessMock.mockReset()
    fetchRepositoryContentMock.mockReset()
    analyzeSecurityMock.mockReset()
    createRunOnStartMock.mockReset()
    upsertRunTelemetryMock.mockReset()
    scheduleBackgroundWorkMock.mockClear()

    durableJobs = new Map()
    durableIdempotency = new Map()

    const store = await import('../../lib/server/scanJobStore.js')
    store.__setScanJobStoreForTests({ jobs: durableJobs, idempotency: durableIdempotency })

    probeGithubRepositoryAccessMock.mockResolvedValue({ ok: true })
    fetchRepositoryContentMock.mockResolvedValue({
      owner: 'acme',
      repo: 'widgets',
      files: [],
    })
    analyzeSecurityMock.mockImplementation(async (_repo, opts) => {
      opts?.onProgress?.({
        runState: 'running',
        dimensions: [],
        summary: { totals: { dimensionsReviewed: 0, totalDimensions: 1 } },
      })
      return {
        report: '# Report\n\nDone.',
        reportValidation: { ok: true },
        dashboard: {
          runState: 'completed',
          consolidatedReportAvailable: true,
          dimensions: [{ dimensionId: 'd1', label: 'Auth', findings: [] }],
          summary: { totals: { dimensionsReviewed: 1, totalDimensions: 1, findingsAdmitted: 0 } },
          telemetry: { analysisModel: 'test-model' },
        },
        analysisModel: 'test-model',
        correlationId: 'corr-1',
        tokenUsage: { total: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      }
    })
    createRunOnStartMock.mockResolvedValue(true)
    upsertRunTelemetryMock.mockResolvedValue(true)
  })

  afterEach(async () => {
    const store = await import('../../lib/server/scanJobStore.js')
    store.__setScanJobStoreForTests(null)
  })

  it('creates, completes, and remains pollable after memory cache clear', async () => {
    const {
      createScanJob,
      getScanJobResponse,
      __clearScanJobMemoryCacheForTests,
    } = await import('../../lib/server/scanJobs.js')

    const created = await createScanJob({
      repositoryUrl: 'https://github.com/acme/widgets',
      analysisModel: 'test-model',
      triggeredBy: { uid: 'user-1', email: 'a@b.com', displayName: 'A' },
    })

    expect(created.jobId).toBeTruthy()
    expect(['queued', 'fetching', 'running', 'synthesizing', 'completed']).toContain(created.status)
    expect(durableJobs.has(created.jobId)).toBe(true)
    expect(scheduleBackgroundWorkMock).toHaveBeenCalled()

    // Allow scheduled work to finish.
    await vi.waitFor(async () => {
      const job = await getScanJobResponse(created.jobId)
      expect(job?.status).toBe('completed')
    })

    __clearScanJobMemoryCacheForTests()

    const polled = await getScanJobResponse(created.jobId)
    expect(polled?.status).toBe('completed')
    expect(polled?.report).toContain('# Report')
    expect(polled?.triggeredBy?.uid).toBe('user-1')
    expect(polled?.analysisModel).toBeTruthy()
    expect(polled?.dashboard?.consolidatedReportAvailable).toBe(true)
  })

  it('marks lease-expired non-terminal jobs as durable failed', async () => {
    const { getScanJobResponse, __clearScanJobMemoryCacheForTests } = await import(
      '../../lib/server/scanJobs.js'
    )
    const { persistScanJob, computeExpiresAt } = await import('../../lib/server/scanJobStore.js')

    await persistScanJob({
      jobId: 'stuck-1',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: computeExpiresAt(),
      repository: { owner: 'acme', name: 'widgets', displayName: 'acme/widgets' },
      dashboard: { runState: 'running', dimensions: [] },
      report: null,
      triggeredBy: { uid: 'user-1' },
      analysisModel: 'test-model',
      requestedAnalysisModel: null,
      telemetry: null,
      error: null,
      executionToken: 'tok',
      executionLeaseExpiresAt: '2000-01-01T00:00:00.000Z',
    })

    __clearScanJobMemoryCacheForTests()
    const job = await getScanJobResponse('stuck-1')
    expect(job?.status).toBe('failed')
    expect(job?.error).toMatch(/lease expired|interrupted/i)

    __clearScanJobMemoryCacheForTests()
    const again = await getScanJobResponse('stuck-1')
    expect(again?.status).toBe('failed')
  })

  it('replays idempotency key without scheduling a second run', async () => {
    const { createScanJob } = await import('../../lib/server/scanJobs.js')

    const first = await createScanJob({
      repositoryUrl: 'https://github.com/acme/widgets',
      triggeredBy: { uid: 'user-1' },
      idempotencyKey: 'client-key-1',
    })
    await vi.waitFor(async () => {
      const { getScanJobResponse } = await import('../../lib/server/scanJobs.js')
      const job = await getScanJobResponse(first.jobId)
      expect(job?.status).toBe('completed')
    })

    const scheduledBefore = scheduleBackgroundWorkMock.mock.calls.length
    const second = await createScanJob({
      repositoryUrl: 'https://github.com/acme/widgets',
      triggeredBy: { uid: 'user-1' },
      idempotencyKey: 'client-key-1',
    })

    expect(second.idempotentReplay).toBe(true)
    expect(second.jobId).toBe(first.jobId)
    expect(scheduleBackgroundWorkMock.mock.calls.length).toBe(scheduledBefore)
  })

  it('persists failure state durably', async () => {
    analyzeSecurityMock.mockRejectedValueOnce(new Error('boom'))
    const {
      createScanJob,
      getScanJobResponse,
      __clearScanJobMemoryCacheForTests,
    } = await import('../../lib/server/scanJobs.js')

    const created = await createScanJob({
      repositoryUrl: 'https://github.com/acme/widgets',
      triggeredBy: { uid: 'user-1' },
    })

    await vi.waitFor(async () => {
      const job = await getScanJobResponse(created.jobId)
      expect(job?.status).toBe('failed')
    })

    __clearScanJobMemoryCacheForTests()
    const polled = await getScanJobResponse(created.jobId)
    expect(polled?.status).toBe('failed')
    expect(polled?.error).toBe('boom')
  })
})
