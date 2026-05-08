import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeAdminRequestMock = vi.fn()
const listRecentScanJobsMock = vi.fn()
const listRecentRunsMock = vi.fn()

vi.mock('../../lib/server/adminAuth.js', () => ({
  authorizeAdminRequest: authorizeAdminRequestMock,
}))

vi.mock('../../lib/server/scanJobs.js', () => ({
  listRecentScanJobs: listRecentScanJobsMock,
}))

vi.mock('../../lib/server/runTelemetryStore.js', () => ({
  listRecentRuns: listRecentRunsMock,
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

describe('GET /api/admin/runs', () => {
  beforeEach(() => {
    authorizeAdminRequestMock.mockReset()
    listRecentScanJobsMock.mockReset()
    listRecentRunsMock.mockReset()
  })

  it('returns 401 when auth token is missing/invalid', async () => {
    const { default: handler } = await import('../../api/admin/runs.js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Missing bearer token.',
    })

    const req = { method: 'GET', headers: {} }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(res.payload.error).toContain('Missing bearer token')
  })

  it('returns 403 for non-admin users', async () => {
    const { default: handler } = await import('../../api/admin/runs.js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Admin access required.',
    })

    const req = { method: 'GET', headers: { authorization: 'Bearer token' } }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(403)
    expect(res.payload.error).toContain('Admin access required')
  })

  it('returns run list for admins', async () => {
    const { default: handler } = await import('../../api/admin/runs.js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: true,
      uid: 'admin-uid',
      role: 'admin',
    })
    listRecentRunsMock.mockResolvedValue([
      { runId: 'run-1', status: 'SUCCESS', repository: { displayName: 'owner/repo' } },
    ])
    listRecentScanJobsMock.mockReturnValue([
      { jobId: 'a1', status: 'completed', repository: { displayName: 'owner/repo' } },
    ])

    const req = { method: 'GET', headers: { authorization: 'Bearer token' } }
    const res = createMockRes()
    await handler(req, res)

    expect(listRecentRunsMock).toHaveBeenCalledWith(50)
    expect(res.statusCode).toBe(200)
    expect(res.payload.count).toBe(1)
    expect(res.payload.requestedBy).toBe('admin-uid')
    expect(res.payload.runs[0].runId).toBe('run-1')
  })
})
