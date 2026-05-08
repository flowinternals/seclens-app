import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * Parse JSON from a fetch Response without throwing on empty bodies (common when the API
 * server is down and the proxy returns an empty or non-JSON response).
 */
async function parseJsonBody(response) {
  const text = await response.text()
  const trimmed = text.trim()
  if (!trimmed) {
    if (!response.ok) {
      throw new Error(
        `Request failed (${response.status}). Empty response - start the API server (e.g. npm run dev:api on port 3001) or check the network.`
      )
    }
    return {}
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    const preview = trimmed.slice(0, 160)
    throw new Error(
      `Invalid response (${response.status}): expected JSON. ${preview}${trimmed.length > 160 ? '...' : ''}`
    )
  }
}

async function copyTextToClipboard(text) {
  const value = String(text ?? '')
  if (!value) return false
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to execCommand fallback.
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'absolute'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}

function formatTimestamp(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function asCell(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none'
  return String(value)
}

function normalizeRunStatus(status) {
  return String(status || '')
    .trim()
    .toUpperCase() || 'UNKNOWN'
}

/**
 * Color-coded run status; adds pulse + dot motion when status is RUNNING.
 */
function RunStatusBadge({ status, className = '' }) {
  const raw = status == null || status === '' ? '' : String(status)
  const s = normalizeRunStatus(raw)
  const isRunning = s === 'RUNNING'

  const styles = {
    SUCCESS:
      'border-emerald-600/35 bg-emerald-500/10 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-900/30 dark:text-emerald-200',
    FAILED:
      'border-red-600/40 bg-red-500/10 text-red-950 dark:border-red-500/45 dark:bg-red-950/45 dark:text-red-200',
    RUNNING:
      'border-sky-600/45 bg-sky-500/12 text-sky-950 dark:border-blue-500/40 dark:bg-sky-950/45 dark:text-sky-200',
    WARNING:
      'border-amber-600/40 bg-amber-500/10 text-amber-950 dark:border-amber-500/45 dark:bg-amber-950/40 dark:text-amber-100',
    SKIPPED: 'border-[var(--sl-border)] bg-[var(--sl-panel-muted)] text-[var(--sl-muted)]',
    UNKNOWN: 'border-[var(--sl-border-soft)] bg-black/[0.06] text-[var(--sl-muted)] dark:bg-black/15',
  }

  const palette = styles[s] || styles.UNKNOWN

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${palette} ${isRunning ? 'seclens-run-status-pulse' : ''} ${className}`}
    >
      <span className="min-w-0 truncate">{raw || '-'}</span>
      {isRunning ? (
        <span className="inline-flex shrink-0 gap-0.5 pl-0.5" aria-hidden>
          <span className="seclens-run-dot" />
          <span className="seclens-run-dot" />
          <span className="seclens-run-dot" />
        </span>
      ) : null}
    </span>
  )
}

function formatTriggeredBy(triggeredBy) {
  if (!triggeredBy || typeof triggeredBy !== 'object') return 'Unknown user'
  const email = typeof triggeredBy.email === 'string' ? triggeredBy.email.trim() : ''
  const displayName = typeof triggeredBy.displayName === 'string' ? triggeredBy.displayName.trim() : ''
  const uid = typeof triggeredBy.uid === 'string' ? triggeredBy.uid.trim() : ''
  if (email) return email
  if (displayName) return displayName
  if (uid) return `UID ${uid.slice(0, 8)}...`
  return 'Unknown user'
}

function formatDurationShortFromMs(elapsedMs) {
  if (elapsedMs == null || elapsedMs < 1000) return null
  const totalSec = Math.floor(elapsedMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s}s`
}

/**
 * Prefer persisted telemetryLogEntry; overlay modelUsageSummary / telemetry.tokenUsage when the row
 * was saved without merged usage (dashboard.telemetry omitted tokenUsage until mergeTelemetryForLogEntry).
 */
function buildDisplayTelemetryLogEntry(run) {
  const raw = run?.telemetryLogEntry
  const mus = run?.modelUsageSummary
  const tel = run?.telemetry

  const fallback = {
    timestampUtc: run?.updatedAt || run?.createdAt || null,
    repo: run?.repository?.displayName || null,
    profile: run?.telemetry?.profile || null,
    selectedOmitted:
      run?.fileSelectionSummary?.selectedFileCount != null && run?.fileSelectionSummary?.omittedFileCount != null
        ? `${run.fileSelectionSummary.selectedFileCount} / ${run.fileSelectionSummary.omittedFileCount}`
        : null,
    capHits: run?.fileSelectionSummary?.capHits || [],
    durationShort: null,
    validation: run?.status === 'FAILED' ? 'FAIL' : run?.status || null,
    totalTokens: mus?.totalTokens ?? null,
    estimatedCostUsd: mus?.estimatedCostUsd ?? null,
    qaVerdict: run?.status === 'FAILED' ? 'Operational failure' : 'Validator OK / QA concerns',
    analysisModel: run?.analysisModel || mus?.analysisModel || null,
  }

  const base = raw && typeof raw === 'object' ? { ...raw } : fallback

  if (base.totalTokens == null && typeof mus?.totalTokens === 'number') {
    base.totalTokens = mus.totalTokens
  }
  if (base.estimatedCostUsd == null && mus?.estimatedCostUsd != null) {
    base.estimatedCostUsd = mus.estimatedCostUsd
  }
  if (base.totalTokens == null && tel?.tokenUsage?.total?.total_tokens != null) {
    base.totalTokens = tel.tokenUsage.total.total_tokens
  }
  if (base.estimatedCostUsd == null && tel?.estimatedCostUsd != null) {
    base.estimatedCostUsd = tel.estimatedCostUsd
  }
  if (!base.durationShort && run?.startedAt && run?.completedAt) {
    const a = Date.parse(run.startedAt)
    const b = Date.parse(run.completedAt)
    if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) {
      const ds = formatDurationShortFromMs(b - a)
      if (ds) base.durationShort = ds
    }
  }

  return base
}

const POST_MORTEM_SECTION_LABELS = [
  ['executiveRunVerdict', '1. Executive Run Verdict'],
  ['whatWorkedWell', '2. What Worked Well'],
  ['whatDidNotWorkWell', '3. What Did Not Work Well'],
  ['failures', '4. Failures'],
  ['warnings', '5. Warnings'],
  ['skippedWork', '6. Skipped Work'],
  ['fileCoverageReview', '7. File Coverage Review'],
  ['dimensionReview', '8. Dimension Review'],
  ['advisoryOutputQualityReview', '9. Advisory Output Quality Review'],
  ['telemetryCompletenessReview', '10. Telemetry Completeness Review'],
  ['contractComplianceReview', '11. Contract Compliance Review'],
  ['recommendedNextAction', '12. Recommended Next Action'],
  ['developerDiagnosticNotes', '13. Developer Diagnostic Notes'],
]

export default function AdminTelemetrySidebar({ isOpen, onClose }) {
  const { getIdToken } = useAuth()
  const [runs, setRuns] = useState([])
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [selectedRun, setSelectedRun] = useState(null)
  const [isLoadingRuns, setIsLoadingRuns] = useState(false)
  const [isLoadingRun, setIsLoadingRun] = useState(false)
  const [error, setError] = useState('')
  const [postMortemResult, setPostMortemResult] = useState(null)
  const [postMortemLoading, setPostMortemLoading] = useState(false)
  const [postMortemError, setPostMortemError] = useState('')
  const [postMortemCopyFeedback, setPostMortemCopyFeedback] = useState('')
  const [deleteBusyId, setDeleteBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function loadRuns() {
      if (!isOpen) return
      setIsLoadingRuns(true)
      setError('')
      try {
        const token = await getIdToken()
        const response = await fetch('/api/admin/runs', {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        })
        const data = await parseJsonBody(response)
        if (!response.ok) {
          throw new Error(data?.error || `Failed to load runs (${response.status})`)
        }
        if (!cancelled) {
          const nextRuns = Array.isArray(data?.runs) ? data.runs : []
          setRuns(nextRuns)
          const firstRunId = nextRuns[0]?.runId || nextRuns[0]?.jobId || null
          setSelectedRunId((current) => {
            const exists = nextRuns.some((run) => (run.runId || run.jobId) === current)
            return exists ? current : firstRunId
          })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load admin runs')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRuns(false)
        }
      }
    }
    loadRuns()
    return () => {
      cancelled = true
    }
  }, [getIdToken, isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    let cancelled = false
    async function refreshRuns() {
      try {
        const token = await getIdToken()
        const response = await fetch('/api/admin/runs', {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        })
        let data
        try {
          data = await parseJsonBody(response)
        } catch {
          return
        }
        if (!response.ok) return
        if (!cancelled) {
          const nextRuns = Array.isArray(data?.runs) ? data.runs : []
          setRuns(nextRuns)
          const firstRunId = nextRuns[0]?.runId || nextRuns[0]?.jobId || null
          setSelectedRunId((current) => {
            const exists = nextRuns.some((run) => (run.runId || run.jobId) === current)
            return exists ? current : firstRunId
          })
        }
      } catch {
        // best-effort background refresh
      }
    }
    const interval = setInterval(refreshRuns, 4000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [getIdToken, isOpen])

  useEffect(() => {
    let cancelled = false
    async function loadRunDetail() {
      if (!isOpen || !selectedRunId) {
        setSelectedRun(null)
        return
      }
      setIsLoadingRun(true)
      setError('')
      try {
        const token = await getIdToken()
        const response = await fetch(`/api/admin/runs/${encodeURIComponent(selectedRunId)}`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        })
        const data = await parseJsonBody(response)
        if (!response.ok) {
          throw new Error(data?.error || `Failed to load run (${response.status})`)
        }
        if (!cancelled) {
          setSelectedRun(data?.run || null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load run detail')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRun(false)
        }
      }
    }
    loadRunDetail()
    return () => {
      cancelled = true
    }
  }, [getIdToken, isOpen, selectedRunId])

  useEffect(() => {
    setPostMortemResult(null)
    setPostMortemError('')
    setPostMortemCopyFeedback('')
  }, [selectedRunId])

  async function confirmDeleteRun(runId) {
    if (!runId) return
    const ok = window.confirm(
      `Delete run ${runId}? This removes the persisted record and/or in-memory job. This cannot be undone.`
    )
    if (!ok) return
    setDeleteBusyId(runId)
    setError('')
    try {
      const token = await getIdToken()
      const response = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      })
      const data = await parseJsonBody(response)
      if (!response.ok) {
        throw new Error(data?.error || `Delete failed (${response.status})`)
      }
      setRuns((prev) => {
        const next = prev.filter((r) => (r.runId || r.jobId) !== runId)
        setSelectedRunId((sid) => {
          if (sid !== runId) return sid
          return next[0]?.runId || next[0]?.jobId || null
        })
        return next
      })
      setPostMortemResult(null)
      setPostMortemError('')
      setPostMortemCopyFeedback('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete run')
    } finally {
      setDeleteBusyId(null)
    }
  }

  async function runPostMortemAssessment() {
    if (!selectedRunId) return
    setPostMortemLoading(true)
    setPostMortemError('')
    setPostMortemCopyFeedback('')
    try {
      const token = await getIdToken()
      const response = await fetch(
        `/api/admin/runs/${encodeURIComponent(selectedRunId)}/post-mortem`,
        {
          method: 'POST',
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
            'Content-Type': 'application/json',
          },
        }
      )
      const data = await parseJsonBody(response)
      if (!response.ok) {
        throw new Error(data?.error || `Post-mortem failed (${response.status})`)
      }
      setPostMortemResult(data.postMortem || null)
    } catch (err) {
      setPostMortemError(err instanceof Error ? err.message : 'Post-mortem request failed')
      setPostMortemResult(null)
    } finally {
      setPostMortemLoading(false)
    }
  }

  async function copyPostMortemAssessment() {
    if (!postMortemResult) return
    const text = JSON.stringify(postMortemResult, null, 2)
    const ok = await copyTextToClipboard(text)
    setPostMortemCopyFeedback(ok ? 'Copied' : 'Copy failed')
    window.setTimeout(() => setPostMortemCopyFeedback(''), 2000)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close admin telemetry panel"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[760px] p-2 sm:p-3">
        <div className="seclens-panel seclens-accent-blue h-full overflow-hidden border border-[var(--sl-border)] shadow-[0_18px_46px_rgba(0,0,0,0.28)]">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[var(--sl-border-soft)] px-4 py-3">
              <div>
                <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.1em]">Admin Zone</p>
                <h2 className="mt-0.5 text-base font-semibold">Telemetry Console</h2>
                <p className="seclens-muted text-xs">Run diagnostics and telemetry details</p>
              </div>
              <button type="button" onClick={onClose} className="seclens-button-secondary h-9 px-3 text-sm">
                Close
              </button>
            </div>

            {error ? <p className="seclens-danger mx-4 mt-3 rounded-md px-3 py-2 text-sm">{error}</p> : null}

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
              <div className="min-h-0 overflow-auto border-b border-[var(--sl-border-soft)] p-3 md:border-b-0 md:border-r">
                <div className="mb-2 flex items-center justify-between">
                  <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.1em]">Runs</p>
                  <p className="seclens-muted text-xs">{isLoadingRuns ? 'Loading...' : `${runs.length}`}</p>
                </div>
                <div className="space-y-2">
                  {runs.map((run) => {
                    const runId = run.runId || run.jobId
                    const isActive = selectedRunId === runId
                    return (
                      <div
                        key={runId}
                        className={`flex gap-1 rounded-xl border p-1 transition ${
                          isActive
                            ? 'seclens-accent-blue border-[var(--sl-info-text)]'
                            : 'seclens-surface border-[var(--sl-border-soft)] hover:border-[var(--sl-info-text)]/50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedRunId(runId)}
                          className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left"
                        >
                          <p className="truncate font-mono text-xs">{runId}</p>
                          <div className="mt-1.5">
                            <RunStatusBadge status={run.status} className="w-full justify-start" />
                          </div>
                          <p className="seclens-muted mt-1 truncate text-[11px]">
                            {formatTriggeredBy(run?.triggeredBy)}
                          </p>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete run ${runId}`}
                          disabled={deleteBusyId !== null}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            void confirmDeleteRun(runId)
                          }}
                          className="seclens-danger shrink-0 self-start rounded-lg px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-90 hover:opacity-100 disabled:opacity-40"
                        >
                          {deleteBusyId === runId ? '...' : 'Delete'}
                        </button>
                      </div>
                    )
                  })}
                  {!isLoadingRuns && runs.length === 0 ? (
                    <p className="seclens-muted seclens-surface rounded-md px-3 py-2 text-xs">No runs found.</p>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 overflow-auto p-3">
                {isLoadingRun ? <p className="seclens-muted text-sm">Loading run detail...</p> : null}
                {!isLoadingRun && selectedRun ? (
                  <>
                  {(() => {
                    const logEntry = buildDisplayTelemetryLogEntry(selectedRun)
                    return (
                    <div className="seclens-surface mb-3 overflow-auto rounded-xl border border-[var(--sl-border-soft)] p-3">
                      <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.1em]">
                        Telemetry Log View
                      </p>
                      <table className="mt-2 min-w-[980px] text-xs">
                        <thead>
                          <tr className="seclens-muted text-[10px] uppercase tracking-[0.08em]">
                            <th className="px-2 py-1 text-left">Timestamp</th>
                            <th className="px-2 py-1 text-left">Repo</th>
                            <th className="px-2 py-1 text-left">Profile</th>
                            <th className="px-2 py-1 text-left">Selected/Omitted</th>
                            <th className="px-2 py-1 text-left">Cap Hits</th>
                            <th className="px-2 py-1 text-left">Duration</th>
                            <th className="px-2 py-1 text-left">Validation</th>
                            <th className="px-2 py-1 text-left">Tokens</th>
                            <th className="px-2 py-1 text-left">Cost</th>
                            <th className="px-2 py-1 text-left">QA Verdict</th>
                            <th className="px-2 py-1 text-left">Model</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-[var(--sl-border-soft)]">
                            <td className="px-2 py-1 font-mono">{asCell(logEntry?.timestampUtc)}</td>
                            <td className="px-2 py-1 font-mono">{asCell(logEntry?.repo)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.profile)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.selectedOmitted)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.capHits)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.durationShort)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.validation)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.totalTokens)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.estimatedCostUsd)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.qaVerdict)}</td>
                            <td className="px-2 py-1">{asCell(logEntry?.analysisModel)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    )
                  })()}
                    <div className="seclens-surface mb-3 rounded-xl border border-[var(--sl-border-soft)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.1em]">Summary</p>
                        <button
                          type="button"
                          disabled={deleteBusyId !== null || !selectedRunId}
                          onClick={() => void confirmDeleteRun(selectedRunId)}
                          className="seclens-danger rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40"
                        >
                          {deleteBusyId === selectedRunId ? 'Deleting...' : 'Delete run'}
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="seclens-muted shrink-0">Status:</span>
                          <RunStatusBadge status={selectedRun.status} />
                        </p>
                        <p>Reason: {selectedRun.reasonCode || '-'}</p>
                        <p>Updated: {formatTimestamp(selectedRun.updatedAt)}</p>
                        <p>Completed: {formatTimestamp(selectedRun.completedAt)}</p>
                        <p>Triggered by: {formatTriggeredBy(selectedRun?.triggeredBy)}</p>
                        <p>User UID: {selectedRun?.triggeredBy?.uid || '-'}</p>
                      </div>
                    </div>

                    <div className="seclens-surface mb-3 rounded-xl border border-[var(--sl-border-soft)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.1em]">
                            Post-mortem assessment
                          </p>
                          <p className="seclens-muted mt-0.5 text-[11px]">
                            On-demand CR-008 diagnostic - results below stay in this console.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={postMortemLoading || !selectedRunId}
                          onClick={runPostMortemAssessment}
                          className="seclens-button-secondary h-9 shrink-0 px-3 text-sm disabled:opacity-50"
                        >
                          {postMortemLoading ? 'Running...' : 'Run post-mortem'}
                        </button>
                      </div>
                      {postMortemError ? (
                        <p className="seclens-danger mt-2 rounded-md px-2 py-1.5 text-xs">{postMortemError}</p>
                      ) : null}
                      {postMortemResult ? (
                        <div className="mt-3 space-y-3 border-t border-[var(--sl-border-soft)] pt-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`rounded-md px-2 py-0.5 font-semibold ${
                                  postMortemResult.recommendedNextAction === 'TRUST'
                                    ? 'bg-emerald-900/40 text-emerald-200'
                                    : postMortemResult.recommendedNextAction === 'REJECT'
                                      ? 'bg-red-900/40 text-red-200'
                                      : postMortemResult.recommendedNextAction === 'INSUFFICIENT_QUALITY_EVIDENCE'
                                        ? 'bg-orange-950/55 text-orange-100'
                                        : 'bg-amber-900/40 text-amber-100'
                                }`}
                              >
                                Next: {postMortemResult.recommendedNextAction}
                              </span>
                              {postMortemResult.assertionSummary ? (
                                <>
                                  <span className="text-emerald-300/90">
                                    pass {postMortemResult.assertionSummary.pass ?? 0}
                                  </span>
                                  <span className="text-amber-200/90">
                                    warn {postMortemResult.assertionSummary.warn ?? 0}
                                  </span>
                                  <span className="text-red-300/90">
                                    fail {postMortemResult.assertionSummary.fail ?? 0}
                                  </span>
                                </>
                              ) : null}
                              <span className="seclens-muted font-mono text-[10px]">
                                {postMortemResult.assessedAtIso}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void copyPostMortemAssessment()}
                              className="seclens-button-secondary h-8 shrink-0 px-2.5 py-1 text-[11px] font-semibold"
                            >
                              {postMortemCopyFeedback || 'Copy assessment'}
                            </button>
                          </div>
                          {postMortemResult.executiveVerdict?.headline ? (
                            <p className="text-sm font-medium leading-snug">
                              {postMortemResult.executiveVerdict.headline}
                            </p>
                          ) : null}
                          <div className="max-h-[min(420px,50vh)] space-y-3 overflow-auto pr-1">
                            {POST_MORTEM_SECTION_LABELS.map(([key, label]) => {
                              const block = postMortemResult.sections?.[key]
                              const lines = Array.isArray(block) ? block : []
                              if (!lines.length) return null
                              return (
                                <div
                                  key={key}
                                  className="rounded-lg border border-[var(--sl-border-soft)] bg-black/20 p-2.5"
                                >
                                  <p className="seclens-muted text-[10px] font-semibold uppercase tracking-[0.08em]">
                                    {label}
                                  </p>
                                  <ul className="mt-1.5 list-inside list-disc space-y-1 text-[11px] leading-relaxed">
                                    {lines.map((line, idx) => (
                                      <li key={idx} className="font-mono">
                                        {line}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )
                            })}
                          </div>
                          <details className="text-xs">
                            <summary className="cursor-pointer seclens-muted">Raw assertions (JSON)</summary>
                            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-black/50 p-2 text-[10px]">
                              {JSON.stringify(postMortemResult.assertions, null, 2)}
                            </pre>
                          </details>
                        </div>
                      ) : null}
                    </div>

                    <pre className="seclens-surface overflow-auto rounded-xl border border-[var(--sl-border-soft)] p-3 text-xs">
                      {JSON.stringify(selectedRun, null, 2)}
                    </pre>
                  </>
                ) : null}
                {!isLoadingRun && !selectedRun ? (
                  <p className="seclens-muted text-sm">Select a run to view detail.</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
