import { corsHeaders } from '../../lib/server/cors.js'
import { enforceProductionAccessGuard } from '../../lib/server/productionAccessGuard.js'
import { logProtectedEndpointRejection } from '../../lib/server/apiAuth.js'
import { getStripeClient } from '../../lib/server/stripe.js'
import { getFirebaseAdminDb } from '../../lib/server/firebaseAdmin.js'
import { setUserSubscription } from '../../lib/server/billing.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

function toIsoFromStripeUnix(value) {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null
}

function resolvePlanFromPriceId(priceId) {
  const proMonthly = String(process.env.STRIPE_PRICE_PRO_MONTHLY || '').trim()
  const proYearly = String(process.env.STRIPE_PRICE_PRO_YEARLY || '').trim()
  if (priceId && (priceId === proMonthly || priceId === proYearly)) return 'pro'
  return 'free'
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body)
  if (req.rawBody) {
    return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody))
  }
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function applySubscriptionEvent(db, payload) {
  const firebaseUid = payload?.metadata?.firebaseUid || null
  if (!firebaseUid) return
  const firstItem = payload?.items?.data?.[0] || null
  const priceId = firstItem?.price?.id || null
  await setUserSubscription(db, firebaseUid, {
    stripeCustomerId: payload?.customer || null,
    stripeSubscriptionId: payload?.id || null,
    plan: resolvePlanFromPriceId(priceId),
    status: String(payload?.status || 'none').toLowerCase(),
    currentPeriodEnd: toIsoFromStripeUnix(payload?.current_period_end),
    cancelAtPeriodEnd: Boolean(payload?.cancel_at_period_end),
  })
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
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
  if (!stripe || !webhookSecret) {
    return res.status(503).json({ error: 'Stripe webhook is not configured.' })
  }
  const db = getFirebaseAdminDb()
  if (!db) {
    return res.status(503).json({ error: 'Firebase Admin Firestore is unavailable.' })
  }

  const signature = req.headers['stripe-signature']
  if (!signature) {
    logProtectedEndpointRejection({
      req,
      endpoint: '/api/billing/webhook',
      statusCode: 400,
      reasonCode: 'WEBHOOK_SIGNATURE_INVALID',
    })
    return res.status(400).json({ error: 'Missing Stripe signature.', reasonCode: 'WEBHOOK_SIGNATURE_INVALID' })
  }

  let event
  try {
    const rawBody = await readRawBody(req)
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (error) {
    logProtectedEndpointRejection({
      req,
      endpoint: '/api/billing/webhook',
      statusCode: 401,
      reasonCode: 'WEBHOOK_SIGNATURE_INVALID',
    })
    return res.status(401).json({
      error: 'Invalid Stripe webhook signature.',
      reasonCode: 'WEBHOOK_SIGNATURE_INVALID',
      ...(process.env.NODE_ENV === 'development' && { details: String(error?.message || error) }),
    })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const firebaseUid = session?.metadata?.firebaseUid || null
      if (firebaseUid) {
        await setUserSubscription(db, firebaseUid, {
          stripeCustomerId: session?.customer || null,
          stripeSubscriptionId: session?.subscription || null,
          plan: 'pro',
          status: 'active',
          cancelAtPeriodEnd: false,
        })
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await applySubscriptionEvent(db, event.data.object)
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object
      const firebaseUid = invoice?.subscription_details?.metadata?.firebaseUid || invoice?.metadata?.firebaseUid || null
      if (firebaseUid) {
        await setUserSubscription(db, firebaseUid, {
          status: 'past_due',
          stripeCustomerId: invoice?.customer || null,
          stripeSubscriptionId: invoice?.subscription || null,
        })
      }
    }
  } catch (error) {
    return res.status(500).json({
      error: 'Failed processing Stripe webhook event.',
      ...(process.env.NODE_ENV === 'development' && { details: String(error?.message || error) }),
    })
  }

  return res.status(200).json({ received: true })
}

