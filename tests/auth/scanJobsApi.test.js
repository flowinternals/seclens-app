import { beforeEach, describe, expect, it, vi } from 'vitest'

const authenticateRequestMock = vi.fn()
const buildTriggeredByProfileMock = vi.fn()
const createScanJobMock = vi.fn()
const getScanJobResponseMock = vi.fn()

vi.mock('../../lib/server/adminAuth.js', () => ({
  authenticateRequest: authenticateRequestMock,
  buildTriggeredByProfile: buildTriggeredByProfileMock,
}))

vi.mock('../../lib/server/scanJobs.js', () => ({
  createScanJob: createScanJobMock,
  getScanJobResponse: getScanJobResponseMock,
  buildScanJobTelemetryCaps: () => ({ maxFiles: 10 }),
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

vi.mock('../../lib/server/rateLimit.js', () => ({
  rateLimit: () => ({ allowed: true, remaining: 4, resetTime: Date.now() + 3600000 }),
}))

vi.mock('../../lib/server/firebaseAdmin.js', () => ({
  getFirebaseAdminDb: () => null,
}))

vi.mock('../../lib/server/advisoryUsage.js', () => ({
  evaluateAdvisoryRunQuota: vi.fn().mockResolvedValue({ allowed: true }),
  recordAdvisoryRunStart: vi.fn().mockResolvedValue(undefined),
}))

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader() {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.payload = data
      return this
    },
    end() {
      return this
    },
  }
}

describe('/api/scan-jobs', () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    buildTriggeredByProfileMock.mockReset()
    createScanJobMock.mockReset()
    getScanJobResponseMock.mockReset()
  })

  it('POST returns 401 when token is missing', async () => {
    const { default: handler } = await import('../../api/scan-jobs.js')
    authenticateRequestMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Missing bearer token.',
      reasonCode: 'AUTH_TOKEN_MISSING',
    })

    const req = {
      method: 'POST',
      headers: {},
      body: { repositoryUrl: 'https://github.com/foo/bar' },
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(res.payload.reasonCode).toBe('AUTH_TOKEN_MISSING')
    expect(createScanJobMock).not.toHaveBeenCalled()
  })

  it('POST accepts scan when authenticated', async () => {
    const { default: handler } = await import('../../api/scan-jobs.js')
    authenticateRequestMock.mockResolvedValue({
      ok: true,
      uid: 'user-1',
      claims: { uid: 'user-1' },
    })
    buildTriggeredByProfileMock.mockResolvedValue({
      uid: 'user-1',
      email: 'a@b.com',
      displayName: 'Test',
    })
    createScanJobMock.mockResolvedValue({
      jobId: 'job-1',
      status: 'queued',
      dashboard: {},
      repository: { displayName: 'foo/bar' },
    })

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer fake' },
      body: { repositoryUrl: 'https://github.com/foo/bar' },
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(202)
    expect(createScanJobMock).toHaveBeenCalled()
    expect(res.payload.jobId).toBe('job-1')
  })

  it('GET returns 403 when job belongs to another user', async () => {
    const { default: handler } = await import('../../api/scan-jobs.js')
    authenticateRequestMock.mockResolvedValue({
      ok: true,
      uid: 'user-b',
      claims: {},
    })
    getScanJobResponseMock.mockReturnValue({
      jobId: 'job-1',
      status: 'running',
      triggeredBy: { uid: 'user-a', email: null, displayName: null },
    })

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      query: { jobId: 'job-1' },
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(403)
    expect(res.payload.reasonCode).toBe('RESOURCE_OWNER_MISMATCH')
  })

  it('GET returns job for owner', async () => {
    const { default: handler } = await import('../../api/scan-jobs.js')
    authenticateRequestMock.mockResolvedValue({
      ok: true,
      uid: 'user-a',
      claims: {},
    })
    getScanJobResponseMock.mockReturnValue({
      jobId: 'job-1',
      triggeredBy: { uid: 'user-a', email: null, displayName: null },
    })

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      query: { jobId: 'job-1' },
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.payload.jobId).toBe('job-1')
  })
})
