import { corsHeaders } from '../../lib/server/cors.js'
import { enforceProductionAccessGuard } from '../../lib/server/productionAccessGuard.js'
import { getStripeClient, getStripePriceIds } from '../../lib/server/stripe.js'
import { requireAuthWithBilling, setUserSubscription } from '../../lib/server/billing.js'
import { getFirebaseAdminAuth } from '../../lib/server/firebaseAdmin.js'

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
  const { proMonthly } = getStripePriceIds()
  if (!proMonthly) {
    return res.status(503).json({ error: 'Stripe price IDs are not configured.' })
  }

  const authContext = await requireAuthWithBilling(req, res)
  if (!authContext) return

  try {
    const adminAuth = getFirebaseAdminAuth()
    const userRecord = adminAuth ? await adminAuth.getUser(authContext.uid) : null
    const customerEmail = userRecord?.email || null

    let stripeCustomerId = authContext.subscription.stripeCustomerId || null
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: customerEmail || undefined,
        metadata: { firebaseUid: authContext.uid },
      })
      stripeCustomerId = customer.id
    }

    const appOrigin = resolveAppOrigin(req)
    if (!appOrigin) {
      return res.status(400).json({ error: 'Unable to resolve app origin for checkout redirect.' })
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{ price: proMonthly, quantity: 1 }],
      success_url: `${appOrigin}/account/billing?checkout=success`,
      cancel_url: `${appOrigin}/account/billing?checkout=cancelled`,
      metadata: { firebaseUid: authContext.uid },
    })

    await setUserSubscription(authContext.db, authContext.uid, {
      ...authContext.subscription,
      stripeCustomerId,
      plan: authContext.subscription.plan || 'free',
      status: authContext.subscription.status || 'none',
    })

    return res.status(200).json({
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create Stripe checkout session.',
      ...(process.env.NODE_ENV === 'development' && { details: String(error?.message || error) }),
    })
  }
}

