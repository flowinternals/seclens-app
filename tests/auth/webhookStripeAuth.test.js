import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/server/productionAccessGuard.js', () => ({
  enforceProductionAccessGuard: () => true,
}))

vi.mock('../../lib/server/cors.js', () => ({
  corsHeaders: () => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
  }),
}))

vi.mock('../../lib/server/firebaseAdmin.js', () => ({
  getFirebaseAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ set: vi.fn(), get: vi.fn() }),
        }),
      }),
    }),
  }),
}))

const constructEventMock = vi.fn()

vi.mock('../../lib/server/stripe.js', () => ({
  getStripeClient: () => ({
    webhooks: {
      constructEvent: constructEventMock,
    },
  }),
}))

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
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

describe('POST /api/billing/webhook', () => {
  beforeEach(() => {
    constructEventMock.mockReset()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_secret')
  })

  it('returns 401 when Stripe signature is invalid', async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error('bad sig')
    })

    const { default: handler } = await import('../../api/billing/webhook.js')
    const req = {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=bad' },
      body: Buffer.from('{}'),
    }
    const res = createMockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(res.payload.reasonCode).toBe('WEBHOOK_SIGNATURE_INVALID')
  })
})
