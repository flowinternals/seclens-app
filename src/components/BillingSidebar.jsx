import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'

function isPortalEligible(subscription) {
  return Boolean(subscription?.stripeCustomerId)
}

export default function BillingSidebar({ isOpen, onClose }) {
  const { getIdToken } = useAuth()
  const [subscription, setSubscription] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const planLabel = useMemo(
    () => String(subscription?.plan || 'free').toUpperCase(),
    [subscription?.plan]
  )
  const statusLabel = useMemo(
    () => String(subscription?.status || 'none').toLowerCase(),
    [subscription?.status]
  )

  const fetchSubscription = useCallback(async () => {
    if (!isOpen) return
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
  }, [getIdToken, isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    fetchSubscription()
    return undefined
  }, [fetchSubscription, isOpen])

  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close billing drawer"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="absolute left-0 top-0 h-full w-full max-w-[440px] p-2 sm:p-3">
        <div className="seclens-panel seclens-accent-pink h-full overflow-hidden border border-[var(--sl-border)] shadow-[0_18px_46px_rgba(0,0,0,0.28)]">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[var(--sl-border-soft)] px-4 py-3">
              <div>
                <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.1em]">Account Zone</p>
                <h2 className="mt-0.5 text-base font-semibold">Billing</h2>
                <p className="seclens-muted text-xs">Plan status and Stripe subscription controls</p>
              </div>
              <button type="button" onClick={onClose} className="seclens-button-secondary h-9 px-3 text-sm">
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {error ? <p className="seclens-danger mb-3 rounded-md px-3 py-2 text-sm">{error}</p> : null}
              {isLoading ? <p className="seclens-muted text-sm">Loading billing status...</p> : null}

              {!isLoading ? (
                <div className="space-y-3">
                  <div className="seclens-surface rounded-xl border border-[var(--sl-border-soft)] p-3">
                    <p className="seclens-muted text-[10px] uppercase tracking-[0.1em]">Current plan</p>
                    <p className="seclens-text mt-1 text-xl font-semibold">{planLabel}</p>
                  </div>

                  <div className="seclens-surface rounded-xl border border-[var(--sl-border-soft)] p-3">
                    <p className="seclens-muted text-[10px] uppercase tracking-[0.1em]">Subscription status</p>
                    <p className="seclens-text mt-1 text-base font-medium">{statusLabel}</p>
                    <p className="seclens-muted mt-1 text-xs">
                      Cancel at period end: {subscription?.cancelAtPeriodEnd ? 'Yes' : 'No'}
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
                    <button
                      type="button"
                      className="seclens-button-secondary"
                      onClick={fetchSubscription}
                      disabled={isSubmitting}
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="seclens-surface rounded-xl border border-[var(--sl-border-soft)] p-3 text-sm">
                    <p className="seclens-text font-medium">Plan entitlements</p>
                    <ul className="seclens-muted mt-2 list-disc pl-5">
                      <li>Free: 10 advisory runs / 30 days, 3 MB file cap, Markdown/Text exports</li>
                      <li>Pro: 200 advisory runs / 30 days, 25 MB file cap, Markdown/Text/PDF exports</li>
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

