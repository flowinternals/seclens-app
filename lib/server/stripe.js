import Stripe from 'stripe'

let stripeClient = null

export function getStripeClient() {
  if (stripeClient) return stripeClient
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim()
  if (!secretKey) return null
  stripeClient = new Stripe(secretKey)
  return stripeClient
}

export function getStripePriceIds() {
  return {
    proMonthly: String(process.env.STRIPE_PRICE_PRO_MONTHLY || '').trim(),
    proYearly: String(process.env.STRIPE_PRICE_PRO_YEARLY || '').trim(),
  }
}

export function getStripePublishableKey() {
  return String(process.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim()
}

