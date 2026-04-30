import { useEffect, useState } from 'react'
import { sanitizeGitHubUrl } from '../utils/sanitize'
import GlowingButton from './GlowingButton'

const STORAGE_KEY = 'seclens-scan-form'

function AnimatedLoadingLabel({ label }) {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    setDotCount(1)
    const timer = window.setInterval(() => {
      setDotCount((current) => (current >= 3 ? 1 : current + 1))
    }, 420)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span aria-live="polite" aria-atomic="true">
      {label}
      <span className="inline-block w-[1.2em] text-left">{'.'.repeat(dotCount)}</span>
    </span>
  )
}

function InputPanel({ onScan, isLoading, compact = false, loadingLabel = 'Scan running' }) {
  const [url, setUrl] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
      return typeof saved.url === 'string' ? saved.url : ''
    } catch {
      return ''
    }
  })
  const [error, setError] = useState('')
  const [isPrivate, setIsPrivate] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
      return Boolean(saved.isPrivate)
    } catch {
      return false
    }
  })
  const [token, setToken] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
      return typeof saved.token === 'string' ? saved.token : ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        url,
        isPrivate,
        token,
      })
    )
  }, [url, isPrivate, token])

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!url.trim()) {
      setError('Enter a GitHub repository URL to start the scan.')
      return
    }

    const sanitized = sanitizeGitHubUrl(url)
    if (!sanitized) {
      setError('Use a valid GitHub repository URL, for example https://github.com/user/repo.')
      return
    }

    setError('')
    onScan({
      url: sanitized,
      githubToken: isPrivate && token.trim() ? token.trim() : undefined,
    })
  }

  return (
    <div className="seclens-panel px-5 py-5">
      <div className="seclens-border-soft border-b pb-4">
        <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Start a scan</p>
        {!compact ? (
          <>
            <h2 className="seclens-text mt-1 text-lg font-semibold tracking-tight">Repository intake</h2>
            <p className="seclens-muted mt-2 text-sm leading-6">
              Launch a new dimension review and watch the dashboard populate as each security domain completes.
            </p>
          </>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="repo-url" className="seclens-text mb-2 block text-sm font-medium">
            Repository URL
          </label>
          <input
            id="repo-url"
            type="text"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              setError('')
            }}
            placeholder="https://github.com/user/repo"
            className="seclens-input h-12 w-full rounded-[12px] px-4 text-[16px] outline-none transition"
            disabled={isLoading}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? 'repo-url-error' : undefined}
          />
          {error ? (
            <p id="repo-url-error" className="mt-2 text-sm text-[var(--sl-danger-text)]" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <label className="seclens-surface seclens-text flex items-center gap-3 rounded-[12px] px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
            disabled={isLoading}
            className="h-4 w-4"
          />
          Private repository
        </label>

        {isPrivate ? (
          <div>
            <label htmlFor="gh-token" className="seclens-text mb-2 block text-sm font-medium">
              GitHub token
            </label>
            <input
              id="gh-token"
              type="text"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ghp_... or github_pat_..."
              className="seclens-input h-12 w-full rounded-[12px] px-4 text-[16px] outline-none transition"
              disabled={isLoading}
            />
          </div>
        ) : null}

        <GlowingButton type="submit" disabled={isLoading} fullWidth borderVariant="rainbow" aria-label="Run scan">
          {isLoading ? <AnimatedLoadingLabel label={loadingLabel} /> : 'Run scan'}
        </GlowingButton>
      </form>
    </div>
  )
}

export default InputPanel
