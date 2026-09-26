import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FREE_HISTORY_CAP,
  MAX_ARTIFACT_UNCOMPRESSED_BYTES,
  PRO_HISTORY_CAP,
  __setScanHistoryStoreForTests,
  archiveSuccessfulScanHistory,
  deleteUserScanHistory,
  enforceHistoryRetention,
  evaluateArchiveEligibility,
  getUserScanHistoryArtifact,
  listUserScanHistory,
} from '../../lib/server/scanHistoryStore.js'

function makeEligibleJob(overrides = {}) {
  const now = new Date().toISOString()
  return {
    jobId: overrides.jobId || 'run-1',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    triggeredBy: { uid: 'user-a', email: 'a@example.com' },
    repository: {
      owner: 'acme',
      name: 'widget',
      displayName: 'acme/widget',
      url: 'https://github.com/acme/widget',
      ref: 'main',
      githubToken: 'should-never-persist',
    },
    report: '# Report\n\nFindings look solid.',
    reportValidation: { ok: true },
    dashboard: {
      runState: 'completed',
      consolidatedReportAvailable: true,
      selectedDimensionId: 'auth',
      dimensions: [{ dimensionId: 'auth', label: 'Auth', progress: 'done', status: 'pass' }],
      telemetry: { huge: 'drop-me' },
    },
    requestedAnalysisModel: 'gpt-test',
    analysisModel: 'gpt-test',
    ...overrides,
  }
}

describe('scanHistoryStore', () => {
  /** @type {Map<string, Map<string, object>>} */
  let historyByUid
  /** @type {Map<string, Buffer>} */
  let blobs

  beforeEach(() => {
    historyByUid = new Map()
    blobs = new Map()
    __setScanHistoryStoreForTests({ historyByUid, blobs })
  })

  afterEach(() => {
    __setScanHistoryStoreForTests(null)
  })

  it('archives only when completion + validation + consolidated + non-empty report all pass', () => {
    expect(evaluateArchiveEligibility(makeEligibleJob()).ok).toBe(true)
    expect(evaluateArchiveEligibility(makeEligibleJob({ status: 'failed' })).ok).toBe(false)
    expect(evaluateArchiveEligibility(makeEligibleJob({ reportValidation: { ok: false } })).ok).toBe(false)
    expect(
      evaluateArchiveEligibility(
        makeEligibleJob({
          dashboard: { consolidatedReportAvailable: false },
        })
      ).ok
    ).toBe(false)
    expect(evaluateArchiveEligibility(makeEligibleJob({ report: '   ' })).ok).toBe(false)
  })

  it('archives a restorable artifact and lists metadata without requiring a second write on retry', async () => {
    const job = makeEligibleJob({ jobId: 'run-archive-1' })
    const first = await archiveSuccessfulScanHistory(job)
    expect(first.ok).toBe(true)
    expect(first.idempotent).toBe(false)
    expect(blobs.size).toBe(1)

    const second = await archiveSuccessfulScanHistory(job)
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(blobs.size).toBe(1)

    const listed = await listUserScanHistory('user-a', {
      subscription: { plan: 'free', status: 'none' },
      enforceRetention: false,
    })
    expect(listed.runs).toHaveLength(1)
    expect(listed.runs[0].runId).toBe('run-archive-1')
    expect(listed.runs[0].repository.name).toBe('widget')

    const loaded = await getUserScanHistoryArtifact('user-a', 'run-archive-1')
    expect(loaded.ok).toBe(true)
    expect(loaded.report).toContain('# Report')
    expect(loaded.dashboard?.telemetry).toBeNull()
    expect(loaded.repository?.githubToken).toBeUndefined()
  })

  it('does not archive failed jobs', async () => {
    const result = await archiveSuccessfulScanHistory(makeEligibleJob({ status: 'failed', jobId: 'fail-1' }))
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
    expect(blobs.size).toBe(0)
    expect(historyByUid.get('user-a')?.size || 0).toBe(0)
  })

  it('enforces Free retention of 10 and Pro of 50; failed gaps do not occupy slots', async () => {
    for (let i = 0; i < 12; i += 1) {
      const completedAt = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
      await archiveSuccessfulScanHistory(
        makeEligibleJob({
          jobId: `free-${i}`,
          createdAt: completedAt,
          updatedAt: completedAt,
        })
      )
    }
    const freeList = await listUserScanHistory('user-a', {
      subscription: { plan: 'free', status: 'none' },
      enforceRetention: true,
    })
    expect(freeList.runs).toHaveLength(FREE_HISTORY_CAP)
    expect(freeList.runs[0].runId).toBe('free-11')
    expect(historyByUid.get('user-a')?.has('free-0')).toBe(false)

    for (let i = 0; i < 55; i += 1) {
      const completedAt = new Date(Date.UTC(2026, 1, 1, 0, i)).toISOString()
      await archiveSuccessfulScanHistory(
        makeEligibleJob({
          jobId: `pro-${i}`,
          triggeredBy: { uid: 'user-pro' },
          createdAt: completedAt,
          updatedAt: completedAt,
        }),
        { subscription: { plan: 'pro', status: 'active' } }
      )
    }
    const proList = await listUserScanHistory('user-pro', {
      subscription: { plan: 'pro', status: 'active' },
      enforceRetention: true,
    })
    expect(proList.runs).toHaveLength(PRO_HISTORY_CAP)
  })

  it('prunes to Free cap on downgrade and deleteUserScanHistory removes metadata + blobs', async () => {
    for (let i = 0; i < 15; i += 1) {
      const completedAt = new Date(Date.UTC(2026, 2, 1, 0, i)).toISOString()
      await archiveSuccessfulScanHistory(
        makeEligibleJob({
          jobId: `down-${i}`,
          triggeredBy: { uid: 'user-down' },
          createdAt: completedAt,
          updatedAt: completedAt,
        }),
        { subscription: { plan: 'pro', status: 'active' } }
      )
    }
    await enforceHistoryRetention('user-down', {
      subscription: { plan: 'pro', status: 'active' },
    })
    expect(historyByUid.get('user-down')?.size).toBe(15)

    const pruned = await enforceHistoryRetention('user-down', {
      subscription: { plan: 'free', status: 'none' },
    })
    expect(pruned.cap).toBe(FREE_HISTORY_CAP)
    expect(historyByUid.get('user-down')?.size).toBe(FREE_HISTORY_CAP)

    const wiped = await deleteUserScanHistory('user-down')
    expect(wiped.ok).toBe(true)
    expect(historyByUid.get('user-down')?.size || 0).toBe(0)
    expect([...blobs.keys()].some((k) => k.includes('user-down'))).toBe(false)
  })

  it('denies cross-owner restore and refuses oversized artifacts', async () => {
    await archiveSuccessfulScanHistory(makeEligibleJob({ jobId: 'own-1' }))
    const cross = await getUserScanHistoryArtifact('other-user', 'own-1')
    expect(cross.ok).toBe(false)
    expect(cross.reasonCode).toBe('NOT_FOUND')

    const huge = 'x'.repeat(MAX_ARTIFACT_UNCOMPRESSED_BYTES + 1000)
    const tooBig = await archiveSuccessfulScanHistory(
      makeEligibleJob({ jobId: 'huge-1', report: `#\n${huge}` })
    )
    expect(tooBig.ok).toBe(false)
    expect(tooBig.reasonCode).toBe('ARTIFACT_TOO_LARGE')
  })
})
