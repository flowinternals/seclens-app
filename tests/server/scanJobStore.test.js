import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __setScanJobStoreForTests,
  claimScanJobExecution,
  computeExpiresAt,
  getPersistedScanJob,
  isExecutionLeaseExpired,
  isScanJobExpired,
  persistScanJob,
  resolveIdempotentJobId,
  sanitizeScanJobForPersistence,
} from '../../lib/server/scanJobStore.js'

describe('scanJobStore', () => {
  /** @type {Map<string, object>} */
  let jobs
  /** @type {Map<string, object>} */
  let idempotency

  beforeEach(() => {
    jobs = new Map()
    idempotency = new Map()
    __setScanJobStoreForTests({ jobs, idempotency })
  })

  afterEach(() => {
    __setScanJobStoreForTests(null)
  })

  it('persists and reads job state across store lookups', async () => {
    const record = {
      jobId: 'job-1',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: computeExpiresAt(),
      triggeredBy: { uid: 'u1' },
      analysisModel: 'gpt-test',
      report: null,
      githubToken: 'should-not-persist',
    }

    await persistScanJob(record)
    const loaded = await getPersistedScanJob('job-1')
    expect(loaded?.status).toBe('queued')
    expect(loaded?.triggeredBy?.uid).toBe('u1')
    expect(loaded?.githubToken).toBeUndefined()
  })

  it('expires jobs past expiresAt', async () => {
    await persistScanJob({
      jobId: 'old',
      status: 'completed',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:30:00.000Z',
    })
    expect(await getPersistedScanJob('old')).toBeNull()
    expect(jobs.has('old')).toBe(false)
  })

  it('claims execution once while lease is active', async () => {
    await persistScanJob({
      jobId: 'job-lease',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: computeExpiresAt(),
    })

    const first = await claimScanJobExecution('job-lease', { executionToken: 'tok-a' })
    expect(first.claimed).toBe(true)

    const second = await claimScanJobExecution('job-lease', { executionToken: 'tok-b' })
    expect(second.claimed).toBe(false)
    expect(second.executionToken).toBe('tok-a')
  })

  it('allows reclaim after lease expiry', async () => {
    await persistScanJob({
      jobId: 'job-reclaim',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: computeExpiresAt(),
      executionToken: 'old-tok',
      executionLeaseExpiresAt: '2000-01-01T00:00:00.000Z',
    })

    expect(
      isExecutionLeaseExpired({
        status: 'running',
        executionLeaseExpiresAt: '2000-01-01T00:00:00.000Z',
      })
    ).toBe(true)

    const reclaim = await claimScanJobExecution('job-reclaim', { executionToken: 'new-tok' })
    expect(reclaim.claimed).toBe(true)
    expect(reclaim.executionToken).toBe('new-tok')
  })

  it('resolves idempotency keys without creating duplicate job ids', async () => {
    const first = await resolveIdempotentJobId({
      uid: 'user-1',
      idempotencyKey: 'scan-abc',
      jobId: 'job-a',
    })
    expect(first.replay).toBe(false)
    expect(first.jobId).toBe('job-a')

    const second = await resolveIdempotentJobId({
      uid: 'user-1',
      idempotencyKey: 'scan-abc',
      jobId: 'job-b',
    })
    expect(second.replay).toBe(true)
    expect(second.jobId).toBe('job-a')
  })

  it('sanitizes oversized reports and drops secrets', () => {
    const huge = 'x'.repeat(800_000)
    const safe = sanitizeScanJobForPersistence({
      jobId: 'j',
      report: huge,
      githubToken: 'secret',
      probeCache: { x: 1 },
    })
    expect(safe.report.length).toBeLessThan(huge.length)
    expect(safe.reportTruncated).toBe(true)
    expect(safe.githubToken).toBeUndefined()
    expect(safe.probeCache).toBeUndefined()
  })

  it('detects expired records via updatedAt fallback', () => {
    expect(
      isScanJobExpired({
        updatedAt: '2000-01-01T00:00:00.000Z',
      })
    ).toBe(true)
  })
})
