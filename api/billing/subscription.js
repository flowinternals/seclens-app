import { corsHeaders } from '../../lib/server/cors.js'
import { enforceProductionAccessGuard } from '../../lib/server/productionAccessGuard.js'
import { requireAuthWithBilling } from '../../lib/server/billing.js'
import { getStripePublishableKey } from '../../lib/server/stripe.js'

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authContext = await requireAuthWithBilling(req, res)
  if (!authContext) return

  return res.status(200).json({
    plan: authContext.subscription.plan,
    status: authContext.subscription.status,
    cancelAtPeriodEnd: authContext.subscription.cancelAtPeriodEnd,
    currentPeriodEnd: authContext.subscription.currentPeriodEnd || null,
    stripeCustomerId: authContext.subscription.stripeCustomerId || null,
    publishableKeyConfigured: Boolean(getStripePublishableKey()),
  })
}

