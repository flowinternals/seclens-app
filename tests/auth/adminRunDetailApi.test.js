import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeAdminRequestMock = vi.fn()
const getRunByIdMock = vi.fn()
const deleteRunByIdMock = vi.fn()
const getScanJobResponseMock = vi.fn()
const deleteScanJobMock = vi.fn()

vi.mock('../../lib/server/adminAuth.js', () => ({
  authorizeAdminRequest: authorizeAdminRequestMock,
}))

vi.mock('../../lib/server/runTelemetryStore.js', () => ({
  getRunById: getRunByIdMock,
  deleteRunById: deleteRunByIdMock,
}))

vi.mock('../../lib/server/scanJobs.js', () => ({
  getScanJobResponse: getScanJobResponseMock,
  deleteScanJob: deleteScanJobMock,
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

describe('GET /api/admin/runs/:runId', () => {
  beforeEach(() => {
    authorizeAdminRequestMock.mockReset()
    getRunByIdMock.mockReset()
    deleteRunByIdMock.mockReset()
    getScanJobResponseMock.mockReset()
    deleteScanJobMock.mockReset()
  })

  it('returns 401 when auth token is missing/invalid', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId].js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Missing bearer token.',
    })

    const req = { method: 'GET', headers: {}, query: { runId: 'run-1' } }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(401)
  })

  it('returns run detail for admins', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId].js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: true,
      uid: 'admin-uid',
      role: 'admin',
    })
    getRunByIdMock.mockResolvedValue({
      runId: 'run-1',
      status: 'SUCCESS',
    })

    const req = { method: 'GET', headers: { authorization: 'Bearer token' }, query: { runId: 'run-1' } }
    const res = createMockRes()
    await handler(req, res)

    expect(getRunByIdMock).toHaveBeenCalledWith('run-1')
    expect(res.statusCode).toBe(200)
    expect(res.payload.requestedBy).toBe('admin-uid')
    expect(res.payload.run.runId).toBe('run-1')
  })

  it('falls back to in-memory scan jobs when persistent run is missing', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId].js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: true,
      uid: 'admin-uid',
      role: 'admin',
    })
    getRunByIdMock.mockResolvedValue(null)
    getScanJobResponseMock.mockReturnValue({ jobId: 'run-2', status: 'running' })

    const req = { method: 'GET', headers: { authorization: 'Bearer token' }, query: { runId: 'run-2' } }
    const res = createMockRes()
    await handler(req, res)

    expect(getScanJobResponseMock).toHaveBeenCalledWith('run-2')
    expect(res.statusCode).toBe(200)
    expect(res.payload.run.jobId).toBe('run-2')
  })

  it('merges dashboard from in-memory job when Firestore run has no dimensions', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId].js')
    authorizeAdminRequestMock.mockResolvedValue({
      ok: true,
      uid: 'admin-uid',
      role: 'admin',
    })
    const dash = {
      runState: 'completed',
      dimensions: [{ dimensionId: 'd1', label: 'L', progress: 'completed', applicability: { status: 'applicable' } }],
    }
    getRunByIdMock.mockResolvedValue({ runId: 'run-1', status: 'SUCCESS' })
    getScanJobResponseMock.mockReturnValue({ jobId: 'run-1', dashboard: dash })

    const req = { method: 'GET', headers: { authorization: 'Bearer token' }, query: { runId: 'run-1' } }
    const res = createMockRes()
    await handler(req, res)

    expect(res.payload.run.dashboard).toBe(dash)
  })
})

describe('DELETE /api/admin/runs/:runId', () => {
  beforeEach(() => {
    authorizeAdminRequestMock.mockReset()
    getRunByIdMock.mockReset()
    deleteRunByIdMock.mockReset()
    getScanJobResponseMock.mockReset()
    deleteScanJobMock.mockReset()
  })

  it('returns 404 when run does not exist', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId].js')
    authorizeAdminRequestMock.mockResolvedValue({ ok: true, uid: 'admin-uid', role: 'admin' })
    getRunByIdMock.mockResolvedValue(null)
    getScanJobResponseMock.mockReturnValue(null)

    const req = {
      method: 'DELETE',
      headers: { authorization: 'Bearer token' },
      query: { runId: 'missing' },
      url: '/api/admin/runs/missing',
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(404)
    expect(deleteRunByIdMock).not.toHaveBeenCalled()
  })

  it('deletes persisted run', async () => {
    const { default: handler } = await import('../../api/admin/runs/[runId].js')
    authorizeAdminRequestMock.mockResolvedValue({ ok: true, uid: 'admin-uid', role: 'admin' })
    getRunByIdMock.mockResolvedValue({ runId: 'run-1', status: 'SUCCESS' })
    getScanJobResponseMock.mockReturnValue(null)
    deleteRunByIdMock.mockResolvedValue({ deleted: true })
    deleteScanJobMock.mockReturnValue(false)

    const req = {
      method: 'DELETE',
      headers: { authorization: 'Bearer token' },
      query: { runId: 'run-1' },
      url: '/api/admin/runs/run-1',
    }
    const res = createMockRes()
    await handler(req, res)

    expect(deleteRunByIdMock).toHaveBeenCalledWith('run-1')
    expect(deleteScanJobMock).toHaveBeenCalledWith('run-1')
    expect(res.statusCode).toBe(200)
    expect(res.payload.ok).toBe(true)
    expect(res.payload.deleted.persisted).toBe(true)
    expect(res.payload.deleted.inMemory).toBe(false)
  })
})
