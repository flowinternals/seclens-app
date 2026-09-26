import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

function formatTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function repoLabel(repository) {
  if (!repository || typeof repository !== 'object') return 'Unknown repository'
  if (repository.displayName) return repository.displayName
  if (repository.owner && repository.name) return `${repository.owner}/${repository.name}`
  return repository.name || repository.url || 'Unknown repository'
}

export default function PastRunsSidebar({ isOpen, onClose, onOpenRun }) {
  const { getIdToken } = useAuth()
  const [runs, setRuns] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [openingRunId, setOpeningRunId] = useState(null)

  const fetchRuns = useCallback(async () => {
    if (!isOpen) return
    setIsLoading(true)
    setError('')
    try {
      const token = await getIdToken()
      const response = await fetch('/api/history', {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || `Failed to load past runs (${response.status})`)
      }
      setRuns(Array.isArray(data.runs) ? data.runs : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load past runs')
      setRuns([])
    } finally {
      setIsLoading(false)
    }
  }, [getIdToken, isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    fetchRuns()
    return undefined
  }, [fetchRuns, isOpen])

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

  async function handleOpen(runId) {
    if (!runId || typeof onOpenRun !== 'function') return
    setOpeningRunId(runId)
    setError('')
    try {
      await onOpenRun(runId)
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open saved run')
    } finally {
      setOpeningRunId(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close past runs drawer"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="absolute left-0 top-0 h-full w-full max-w-[440px] p-2 sm:p-3">
        <div className="seclens-panel seclens-accent-cyan h-full overflow-hidden border border-[var(--sl-border)] shadow-[0_18px_46px_rgba(0,0,0,0.28)]">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[var(--sl-border-soft)] px-4 py-3">
              <div>
                <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.1em]">Your runs</p>
                <h2 className="mt-0.5 text-base font-semibold">Past runs</h2>
                <p className="seclens-muted text-xs">Open a saved successful scan without rescanning</p>
              </div>
              <button type="button" onClick={onClose} className="seclens-button-secondary h-9 px-3 text-sm">
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {error ? <p className="seclens-danger mb-3 rounded-md px-3 py-2 text-sm">{error}</p> : null}
              {isLoading ? <p className="seclens-muted text-sm">Loading past runs…</p> : null}

              {!isLoading && !error && runs.length === 0 ? (
                <p className="seclens-muted text-sm">
                  No saved successful runs yet. Completed scans that pass report readiness are archived
                  automatically.
                </p>
              ) : null}

              {!isLoading && runs.length > 0 ? (
                <ul className="space-y-2">
                  {runs.map((run) => {
                    const unavailable = run.archiveStatus && run.archiveStatus !== 'ready'
                    return (
                      <li
                        key={run.runId}
                        className="seclens-surface rounded-xl border border-[var(--sl-border-soft)] p-3"
                      >
                        <p className="seclens-text text-sm font-semibold leading-snug">{repoLabel(run.repository)}</p>
                        <p className="seclens-muted mt-1 text-xs">
                          {formatTimestamp(run.completedAt || run.createdAt)}
                          {run.repository?.ref ? ` · ${run.repository.ref}` : ''}
                        </p>
                        <p className="seclens-muted mt-0.5 text-xs">
                          {run.model?.resolved || run.model?.requested || 'Model unknown'}
                        </p>
                        {unavailable ? (
                          <p className="seclens-danger mt-2 text-xs">Saved artifact unavailable</p>
                        ) : null}
                        <button
                          type="button"
                          className="seclens-button-secondary mt-3 h-9 w-full text-sm"
                          disabled={Boolean(openingRunId) || unavailable}
                          onClick={() => handleOpen(run.runId)}
                        >
                          {openingRunId === run.runId ? 'Opening…' : 'Open run'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>

            <div className="border-t border-[var(--sl-border-soft)] px-4 py-3">
              <button
                type="button"
                className="seclens-button-secondary h-9 w-full text-sm"
                onClick={fetchRuns}
                disabled={isLoading || Boolean(openingRunId)}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
