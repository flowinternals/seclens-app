import { describe, expect, it, vi } from 'vitest'

const authenticateRequestMock = vi.fn()

vi.mock('../../lib/server/adminAuth.js', () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock('../../lib/server/productionAccessGuard.js', () => ({
  enforceProductionAccessGuard: () => true,
}))

vi.mock('../../lib/server/rateLimit.js', () => ({
  rateLimit: () => ({ allowed: true, remaining: 4, resetTime: Date.now() + 3600000 }),
}))

vi.mock('../../lib/server/cors.js', () => ({
  corsHeaders: () => ({ 'Access-Control-Allow-Origin': '*' }),
}))

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    headersSent: false,
    setHeader() {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.payload = data
      return this
    },
  }
}

describe('POST /api/analyze auth', () => {
  it('returns 401 before repository fetch when token is missing', async () => {
    authenticateRequestMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Missing bearer token.',
      reasonCode: 'AUTH_TOKEN_MISSING',
    })

    const { default: handler } = await import('../../api/analyze.js')
    const req = {
      method: 'POST',
      headers: { origin: 'http://localhost:5173' },
      body: { repositoryUrl: 'https://github.com/foo/bar' },
      url: '/api/analyze',
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(res.payload.reasonCode).toBe('AUTH_TOKEN_MISSING')
  })
})
