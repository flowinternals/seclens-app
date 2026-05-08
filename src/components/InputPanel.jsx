import { useEffect, useState } from 'react'
import { sanitizeGitHubUrl } from '../utils/sanitize'
import GlowingButton from './GlowingButton'

const STORAGE_KEY = 'seclens-scan-form'

const DOT_SLOTS = 3

function AnimatedLoadingLabel({ label }) {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    setDotCount(1)
    const timer = window.setInterval(() => {
      setDotCount((current) => (current >= DOT_SLOTS ? 1 : current + 1))
    }, 420)
    return () => window.clearInterval(timer)
  }, [label])

  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      className="inline-flex w-full min-w-0 max-w-full items-center justify-center gap-0 whitespace-nowrap"
    >
      <span>{label}</span>
      {/* Fixed 3x1ch grid so dot animation never changes layout width */}
      <span className="inline-flex w-[3ch] shrink-0 select-none justify-start font-mono leading-none" aria-hidden="true">
        {Array.from({ length: DOT_SLOTS }, (_, i) => (
          <span key={i} className="inline-block w-[1ch] text-left">
            {dotCount > i ? '.' : '\u00a0'}
          </span>
        ))}
      </span>
    </span>
  )
}

/** Same grid as AnimatedLoadingLabel so idle vs scanning keeps identical layout metrics */
function RunScanIdleLabel() {
  return (
    <span className="inline-flex w-full min-w-0 max-w-full items-center justify-center gap-0 whitespace-nowrap">
      <span>Run scan</span>
      <span
        className="inline-flex w-[3ch] shrink-0 select-none justify-start font-mono leading-none"
        style={{ visibility: 'hidden' }}
        aria-hidden="true"
      >
        ...
      </span>
    </span>
  )
}

function InputPanel({
  onScan,
  isLoading,
  compact = false,
  loadingLabel = 'Scan running',
  className = '',
}) {
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

  const runScanTitle = isLoading
    ? `${loadingLabel} - disabled until the current scan step completes`
    : 'Submit the repository URL and start a SecLens dimension review'

  return (
    <div className={`seclens-panel px-5 py-5${className ? ` ${className}` : ''}`}>
      <div className="seclens-border-soft border-b pb-4">
        <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Start a scan</p>
        {!compact ? (
          <>
            <h2 className="seclens-text mt-1 text-lg font-semibold tracking-tight">Repository intake</h2>
          </>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-5">
        <div className="min-w-0 w-full">
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
            title={
              isLoading
                ? 'Repository URL (locked while a scan is running)'
                : 'Public GitHub repository URL to scan, for example https://github.com/org/repo'
            }
            className="seclens-input h-12 w-full min-w-0 rounded-[12px] px-4 font-mono text-[15px] outline-none transition sm:text-[16px]"
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

        <label
          className="seclens-surface seclens-text inline-flex w-fit max-w-full cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm"
          title={
            isLoading
              ? 'Private repository (cannot change while a scan is running)'
              : 'Enable when the repo is private - you can supply a GitHub token below for clone access'
          }
        >
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
            disabled={isLoading}
            title={
              isLoading
                ? 'Private repository option is locked while a scan runs'
                : 'Toggle when scanning a private GitHub repository'
            }
            className="h-4 w-4 shrink-0"
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
              title={
                isLoading
                  ? 'GitHub token (locked while a scan is running)'
                  : 'Personal access token with repo read access - used only for this scan request'
              }
              className="seclens-input h-12 w-full min-w-0 rounded-[12px] px-4 font-mono text-[15px] outline-none transition sm:text-[16px]"
              disabled={isLoading}
            />
          </div>
        ) : null}

        <div className="flex w-full flex-wrap items-center justify-center gap-3">
          <GlowingButton
            type="submit"
            disabled={isLoading}
            loading={isLoading}
            borderVariant="rainbow"
            scanLockCh={32}
            aria-label="Run scan"
            title={runScanTitle}
          >
            {isLoading ? <AnimatedLoadingLabel label={loadingLabel} /> : <RunScanIdleLabel />}
          </GlowingButton>
        </div>
      </form>
    </div>
  )
}

export default InputPanel
