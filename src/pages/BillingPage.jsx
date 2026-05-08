import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function isPortalEligible(subscription) {
  return Boolean(subscription?.stripeCustomerId)
}

export default function BillingPage() {
  const { getIdToken } = useAuth()
  const [searchParams] = useSearchParams()
  const [subscription, setSubscription] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const checkoutState = searchParams.get('checkout')
  const checkoutMessage = useMemo(() => {
    if (checkoutState === 'success') return 'Checkout completed. Your subscription status will refresh shortly.'
    if (checkoutState === 'cancelled') return 'Checkout was cancelled.'
    return ''
  }, [checkoutState])

  const fetchSubscription = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const token = await getIdToken()
      const response = await fetch('/api/billing/subscription', {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || `Failed to load billing status (${response.status})`)
      }
      setSubscription(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing status')
    } finally {
      setIsLoading(false)
    }
  }, [getIdToken])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  async function withAuthorizedPost(path) {
    const token = await getIdToken()
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ appOrigin: window.location.origin }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
  }

  async function handleUpgrade() {
    setIsSubmitting(true)
    setError('')
    try {
      const data = await withAuthorizedPost('/api/billing/checkout-session')
      if (data?.checkoutUrl) {
        window.location.assign(data.checkoutUrl)
        return
      }
      throw new Error('Checkout URL was not returned by the server.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create checkout session')
      setIsSubmitting(false)
    }
  }

  async function handleManageSubscription() {
    setIsSubmitting(true)
    setError('')
    try {
      const data = await withAuthorizedPost('/api/billing/portal-session')
      if (data?.url) {
        window.location.assign(data.url)
        return
      }
      throw new Error('Customer portal URL was not returned by the server.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open customer portal')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="seclens-bg min-h-screen p-6">
      <div className="seclens-panel mx-auto mt-10 max-w-3xl p-6">
        <div className="mb-4">
          <Link to="/" className="text-sm underline">
            Back to dashboard
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="seclens-muted mt-2 text-sm">Manage plan status and Stripe checkout for Pro access.</p>

        {checkoutMessage ? <p className="mt-4 rounded-md bg-blue-500/10 px-3 py-2 text-sm">{checkoutMessage}</p> : null}
        {error ? <p className="seclens-danger mt-4 rounded-md px-3 py-2 text-sm">{error}</p> : null}

        {isLoading ? (
          <p className="mt-4 text-sm">Loading billing status...</p>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-md border border-white/10 p-4">
              <p className="text-sm">
                <span className="seclens-muted">Current plan:</span>{' '}
                <strong>{String(subscription?.plan || 'free').toUpperCase()}</strong>
              </p>
              <p className="mt-1 text-sm">
                <span className="seclens-muted">Subscription status:</span>{' '}
                <strong>{String(subscription?.status || 'none').toLowerCase()}</strong>
              </p>
              <p className="mt-1 text-sm">
                <span className="seclens-muted">Cancel at period end:</span>{' '}
                <strong>{subscription?.cancelAtPeriodEnd ? 'Yes' : 'No'}</strong>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {String(subscription?.plan || 'free') !== 'pro' ? (
                <button
                  type="button"
                  className="seclens-button-primary"
                  onClick={handleUpgrade}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Preparing checkout...' : 'Upgrade to Pro'}
                </button>
              ) : null}
              {isPortalEligible(subscription) ? (
                <button
                  type="button"
                  className="seclens-button-secondary"
                  onClick={handleManageSubscription}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Opening portal...' : 'Manage subscription'}
                </button>
              ) : null}
              <button type="button" className="seclens-button-secondary" onClick={fetchSubscription} disabled={isSubmitting}>
                Refresh status
              </button>
            </div>

            <div className="rounded-md border border-white/10 p-4 text-sm">
              <p className="font-medium">Plan entitlements</p>
              <ul className="seclens-muted mt-2 list-disc pl-5">
                <li>Free: 10 advisory runs / 30 days, 3 MB file cap, Markdown/Text exports</li>
                <li>Pro: 200 advisory runs / 30 days, 25 MB file cap, Markdown/Text/PDF exports</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

