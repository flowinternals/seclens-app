import { corsHeaders } from '../../lib/server/cors.js'
import { enforceProductionAccessGuard } from '../../lib/server/productionAccessGuard.js'
import { getStripeClient } from '../../lib/server/stripe.js'
import { requireAuthWithBilling } from '../../lib/server/billing.js'

function resolveAppOrigin(req) {
  const bodyOrigin = typeof req.body?.appOrigin === 'string' ? req.body.appOrigin.trim() : ''
  if (bodyOrigin) return bodyOrigin
  const originHeader = req.headers?.origin || req.headers?.['origin']
  return typeof originHeader === 'string' ? originHeader : ''
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || req.headers?.['origin']
  const headers = corsHeaders(origin)
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== 'Access-Control-Allow-Origin' || value) {
      res.setHeader(key, value)
    }
  })
  const isOriginAllowed = Boolean(headers['Access-Control-Allow-Origin'])

  if (!enforceProductionAccessGuard({ req, res, origin, isOriginAllowed })) {
    return
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripe = getStripeClient()
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured.' })
  }

  const authContext = await requireAuthWithBilling(req, res)
  if (!authContext) return

  const customerId = authContext.subscription.stripeCustomerId
  if (!customerId) {
    return res.status(400).json({ error: 'No Stripe customer is linked for this account.' })
  }

  const appOrigin = resolveAppOrigin(req)
  if (!appOrigin) {
    return res.status(400).json({ error: 'Unable to resolve app origin for customer portal redirect.' })
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin}/account/billing`,
    })
    return res.status(200).json({ url: session.url })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create Stripe customer portal session.',
      ...(process.env.NODE_ENV === 'development' && { details: String(error?.message || error) }),
    })
  }
}

