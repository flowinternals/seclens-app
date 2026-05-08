import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeAdminRequestMock = vi.fn()
const getRunByIdMock = vi.fn()
const getScanJobResponseMock = vi.fn()

vi.mock('../../lib/server/adminAuth.js', () => ({
  authorizeAdminRequest: authorizeAdminRequestMock,
}))

vi.mock('../../lib/server/runTelemetryStore.js', () => ({
  getRunById: getRunByIdMock,
}))

vi.mock('../../lib/server/scanJobs.js', () => ({
  getScanJobResponse: getScanJobResponseMock,
}))

vi.mock('../../lib/server/productionAccessGuard.js', () => ({
  enforceProductionAccessGuard: () => true,
}))

vi.mock('../../lib/server/cors.js', () => ({
  corsHeaders: () => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
  }),
}))

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    ended: false,
    setHeader(key, value) {
      this.headers[key] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.payload = data
      return this
    },
    end() {
      this.ended = true
      return this
    },
  }
}

describe('POST /api/admin/runs/:runId/post-mortem', () => {
  beforeEach(() => {
    authorizeAdminRequestMock.mockReset()
    getRunByIdMock.mockReset()
    getScanJobResponseMock.mockReset()
  })

  it('returns post-mortem payload for admins', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId]/post-mortem.js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: true,
      uid: 'admin-uid',
      role: 'admin',
    })
    getRunByIdMock.mockResolvedValue({
      runId: 'run-1',
      status: 'SUCCESS',
      completedAt: new Date().toISOString(),
      telemetry: {
        schemaVersion: 1,
        outcome: 'completed',
        ingestion: { selectedFileCount: 1, omittedFileCount: 0, capHits: [] },
        tokenUsage: { total: { total_tokens: 50 } },
      },
      modelUsageSummary: { totalTokens: 50 },
      dimensionSummary: { dimensionsReviewed: 2, totalDimensions: 2 },
      repository: { owner: 'o', name: 'r' },
    })

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      query: { runId: 'run-1' },
      url: '/api/admin/runs/run-1/post-mortem',
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.payload.postMortem.schemaVersion).toBe(1)
    expect(res.payload.postMortem.assertions.length).toBeGreaterThan(0)
    expect(res.payload.requestedBy).toBe('admin-uid')
  })

  it('merges in-memory dashboard so advisory contract replay is not skipped', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId]/post-mortem.js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: true,
      uid: 'admin-uid',
      role: 'admin',
    })
    getRunByIdMock.mockResolvedValue({
      runId: 'run-1',
      status: 'SUCCESS',
      completedAt: new Date().toISOString(),
      telemetry: {
        schemaVersion: 1,
        outcome: 'completed',
        ingestion: { selectedFileCount: 1, omittedFileCount: 0, capHits: [] },
        tokenUsage: { total: { total_tokens: 50 } },
      },
      modelUsageSummary: { totalTokens: 50 },
      dimensionSummary: { dimensionsReviewed: 1, totalDimensions: 1 },
      repository: { owner: 'o', name: 'r', displayName: 'o/r', url: 'https://github.com/o/r' },
      telemetryLogEntry: { timestampUtc: 'x', repo: 'o/r', profile: 'custom' },
    })
    getScanJobResponseMock.mockReturnValue({
      jobId: 'run-1',
      dashboard: {
        runState: 'completed',
        repoProfile: {},
        dimensions: [
          {
            dimensionId: 'dim_rate_limiting_abuse_controls',
            label: 'Rate limiting',
            progress: 'completed',
            applicability: { status: 'not_applicable' },
            recommendations: [],
            evidence: { reviewedPaths: [] },
          },
        ],
      },
    })

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      query: { runId: 'run-1' },
      url: '/api/admin/runs/run-1/post-mortem',
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const advisory = res.payload.postMortem.assertions.find((a) => a.id === 'pm.advisory_contract')
    expect(advisory?.message || '').not.toContain('Skipped full advisory contract replay')
  })

  it('returns 401 when unauthorized', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId]/post-mortem.js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Missing bearer token.',
    })

    const req = { method: 'POST', headers: {}, query: { runId: 'run-1' }, url: '/api/admin/runs/run-1/post-mortem' }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(401)
  })
})
