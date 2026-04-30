import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useMemo, useState } from 'react'
import { DIMENSION_CATALOG } from '../../lib/shared/dimensions'
import InputPanel from './InputPanel'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'dimensions', label: 'Dimensions' },
  { id: 'report', label: 'Report' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'exports', label: 'Exports' },
]

const STATUS_LABELS = {
  healthy: 'Healthy',
  attention: 'Attention',
  review_needed: 'Review Needed',
  unknown: 'Needs Additional Review',
}

const STATUS_CHIP_LABELS = {
  healthy: 'Healthy',
  attention: 'Attention',
  review_needed: 'Review',
  unknown: 'Coverage',
}

const PROGRESS_CHIP_LABELS = {
  queued: 'Queued',
  reviewing: 'Reviewing',
  synthesizing: 'Synth',
  ready: 'Ready',
  partial: 'Partial',
  failed: 'Failed',
}

const DIMENSION_ESTIMATE_SECONDS = 18
const MAX_RUNNING_ESTIMATE = 96

function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}

function dimensionIconTone(icon) {
  if (icon === 'shield-lock') return 'bg-[rgba(10,114,239,0.14)] text-[#56ccf2]'
  if (icon === 'ticket') return 'bg-[rgba(222,139,29,0.16)] text-[#ffb347]'
  if (icon === 'scan-search') return 'bg-[rgba(222,29,141,0.14)] text-[#ff74c8]'
  if (icon === 'gauge') return 'bg-[rgba(255,91,79,0.14)] text-[#ff8f86]'
  if (icon === 'workflow') return 'bg-[rgba(80,200,120,0.14)] text-[#6ee7a8]'
  if (icon === 'sliders') return 'bg-[rgba(124,108,242,0.16)] text-[#9d8cff]'
  if (icon === 'database') return 'bg-[rgba(31,122,63,0.16)] text-[#63d48d]'
  if (icon === 'monitor-check') return 'bg-[rgba(0,196,204,0.15)] text-[#69f0f5]'
  return 'bg-[var(--sl-panel-muted)] seclens-text'
}

function DimensionGlyph({ icon }) {
  const shared = {
    className: 'h-[18px] w-[18px]',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }

  if (icon === 'shield-lock') {
    return (
      <svg {...shared}>
        <path d="M12 3l7 3v5c0 4.5-2.9 8.3-7 10-4.1-1.7-7-5.5-7-10V6l7-3z" />
        <rect x="9" y="10.5" width="6" height="5" rx="1.2" />
        <path d="M10.5 10.5V9.4a1.5 1.5 0 013 0v1.1" />
      </svg>
    )
  }
  if (icon === 'ticket') {
    return (
      <svg {...shared}>
        <path d="M4 8.5A2.5 2.5 0 016.5 6H17a3 3 0 003 3v1a3 3 0 00-3 3H6.5A2.5 2.5 0 014 10.5v-2z" />
        <path d="M8 6v11" />
        <path d="M12 8.5h4" />
        <path d="M12 12h4" />
      </svg>
    )
  }
  if (icon === 'scan-search') {
    return (
      <svg {...shared}>
        <path d="M4.5 9V5.5h3.5" />
        <path d="M19.5 9V5.5H16" />
        <path d="M4.5 15v3.5h3.5" />
        <path d="M19.5 15v3.5H16" />
        <circle cx="11" cy="11" r="3.5" />
        <path d="M13.7 13.7L18 18" />
      </svg>
    )
  }
  if (icon === 'gauge') {
    return (
      <svg {...shared}>
        <path d="M5 16a7 7 0 1114 0" />
        <path d="M12 12l3.5-2.5" />
        <path d="M12 12l-1.2 4.2" />
      </svg>
    )
  }
  if (icon === 'workflow') {
    return (
      <svg {...shared}>
        <rect x="3.5" y="4" width="5" height="5" rx="1.2" />
        <rect x="15.5" y="4" width="5" height="5" rx="1.2" />
        <rect x="9.5" y="15" width="5" height="5" rx="1.2" />
        <path d="M8.5 6.5h7" />
        <path d="M12 9.5V15" />
      </svg>
    )
  }
  if (icon === 'sliders') {
    return (
      <svg {...shared}>
        <path d="M4 6h6" />
        <path d="M14 6h6" />
        <circle cx="12" cy="6" r="2" />
        <path d="M4 12h10" />
        <path d="M18 12h2" />
        <circle cx="16" cy="12" r="2" />
        <path d="M4 18h3" />
        <path d="M11 18h9" />
        <circle cx="9" cy="18" r="2" />
      </svg>
    )
  }
  if (icon === 'database') {
    return (
      <svg {...shared}>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v8c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
        <path d="M5 10c0 1.7 3.1 3 7 3s7-1.3 7-3" />
      </svg>
    )
  }
  if (icon === 'monitor-check') {
    return (
      <svg {...shared}>
        <rect x="3.5" y="5" width="17" height="11" rx="1.8" />
        <path d="M9 19h6" />
        <path d="M10 11l1.7 1.7L15 9.5" />
      </svg>
    )
  }

  return (
    <svg {...shared}>
      <circle cx="12" cy="12" r="7" />
    </svg>
  )
}

function formatTimestamp(value) {
  if (!value) return 'No scan yet'
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function normalizeReportMarkdown(input) {
  if (!input) return input
  const trimmed = String(input).trim()
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z]*)\n([\s\S]*)\n```$/)
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim()
  return trimmed
}

function statusTone(status) {
  if (status === 'review_needed') return 'text-[var(--sl-danger-text)] bg-[color:rgba(255,91,79,0.12)]'
  if (status === 'attention') return 'text-[var(--sl-warn-text)] bg-[color:rgba(222,139,29,0.14)]'
  if (status === 'healthy') return 'text-[var(--sl-success-text)] bg-[color:rgba(31,122,63,0.14)]'
  return 'seclens-muted bg-[var(--sl-panel-muted)]'
}

function progressTone(progress) {
  if (progress === 'reviewing' || progress === 'synthesizing') {
    return 'text-[var(--sl-info-text)] bg-[color:rgba(10,114,239,0.12)]'
  }
  if (progress === 'failed') return 'text-[var(--sl-danger-text)] bg-[var(--sl-danger-bg)]'
  return 'seclens-muted bg-[var(--sl-panel-muted)]'
}

function confidenceTone(confidence) {
  if (confidence === 'high') return 'text-[var(--sl-success-text)]'
  if (confidence === 'medium') return 'text-[var(--sl-warn-text)]'
  return 'seclens-muted'
}

function overallStatusCopy(status) {
  if (status === 'review_needed') {
    return 'We found issues or gaps that should be addressed before you treat this repository as release-ready.'
  }
  if (status === 'attention') {
    return 'The scan finished with a few areas that still need a closer look before you can feel fully confident.'
  }
  if (status === 'healthy') {
    return 'The reviewed areas showed useful protections, and this scan did not surface a confirmed issue in those paths.'
  }
  return 'Additional review is required in selected areas before launch sign-off.'
}

function summaryCards(summary) {
  const totals = summary?.totals || {}
  return [
    { label: 'Dimensions Reviewed', value: `${totals.dimensionsReviewed || 0}/${totals.totalDimensions || 0}`, accent: 'blue' },
    { label: 'Findings', value: totals.findingsAdmitted || 0, accent: 'red' },
    { label: 'Controls', value: totals.observedControls || 0, accent: 'green' },
    { label: 'Unverified', value: totals.unverifiedControls || 0, accent: 'amber' },
    { label: 'Files Reviewed', value: totals.totalFilesExamined || 0, accent: 'violet' },
    { label: 'High Confidence', value: totals.highConfidenceDimensions || 0, accent: 'pink' },
  ]
}

function accentClass(accent) {
  if (accent === 'red') return 'from-[#ff5b4f]/18 to-transparent text-[var(--sl-danger-text)]'
  if (accent === 'green') return 'from-[#4dbd74]/18 to-transparent text-[var(--sl-success-text)]'
  if (accent === 'amber') return 'from-[#de8b1d]/18 to-transparent text-[var(--sl-warn-text)]'
  if (accent === 'violet') return 'from-[#7c6cf2]/18 to-transparent text-[#7c6cf2]'
  if (accent === 'pink') return 'from-[#de1d8d]/18 to-transparent text-[#de1d8d]'
  return 'from-[#0a72ef]/18 to-transparent text-[var(--sl-info-text)]'
}

function stateBar(summary) {
  const totals = summary?.totals?.statusDistribution || {}
  const total = Object.values(totals).reduce((sum, count) => sum + count, 0) || 1
  return [
    { id: 'review_needed', label: 'Review Needed', count: totals.review_needed || 0, color: '#ff5b4f' },
    { id: 'attention', label: 'Attention', count: totals.attention || 0, color: '#de8b1d' },
    { id: 'healthy', label: 'Healthy', count: totals.healthy || 0, color: '#1f7a3f' },
    { id: 'unknown', label: 'Needs Additional Review', count: totals.unknown || 0, color: '#8b8b8f' },
  ].map((item) => ({
    ...item,
    width: `${(item.count / total) * 100}%`,
  }))
}

function confidenceBars(summary) {
  const totals = summary?.totals || {}
  const max = Math.max(1, totals.highConfidenceDimensions || 0, totals.mediumConfidenceDimensions || 0, totals.lowConfidenceDimensions || 0)
  return [
    { label: 'High', count: totals.highConfidenceDimensions || 0, color: '#4dbd74' },
    { label: 'Medium', count: totals.mediumConfidenceDimensions || 0, color: '#de8b1d' },
    { label: 'Low', count: totals.lowConfidenceDimensions || 0, color: '#de1d8d' },
  ].map((item) => ({
    ...item,
    width: `${(item.count / max) * 100}%`,
  }))
}

function Rail({
  activeView,
  onViewChange,
  status,
  timestamp,
  reportReady,
  onScan,
  isScanning,
  scanButtonLabel,
  theme,
  onToggleTheme,
  onRefresh,
  canRefresh,
  onExport,
  canExport,
}) {
  return (
    <aside className="w-full shrink-0 xl:w-[320px] xl:min-w-[320px]">
      <div className="seclens-panel sticky top-4 overflow-hidden">
        <div className="seclens-accent-blue px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">SecLens</p>
              <h2 className="seclens-text mt-2 text-[24px] font-semibold tracking-tight">Launch Dashboard</h2>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="seclens-button-secondary h-10 px-3"
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>

        <div className="px-3 py-3">
          <div className="space-y-3">
            <InputPanel onScan={onScan} isLoading={isScanning} loadingLabel={scanButtonLabel} compact />

            <div className="seclens-panel px-4 py-4">
              <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Actions</p>
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={onRefresh} disabled={!canRefresh} className="seclens-button-secondary h-11 justify-center">
                    Refresh
                  </button>
                  <button type="button" onClick={onExport} disabled={!canExport} className="seclens-button-secondary h-11 justify-center">
                    Export
                  </button>
                </div>
              </div>
            </div>

            <nav className="seclens-panel p-2">
              <ul className="space-y-1">
                {NAV_ITEMS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onViewChange(item.id)}
                      className={cn(
                        'w-full rounded-[12px] px-3 py-3 text-left text-sm transition-colors',
                        activeView === item.id ? 'bg-[var(--sl-text)] text-[var(--sl-panel)]' : 'seclens-muted hover:bg-[var(--sl-panel-muted)]'
                      )}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div className="seclens-panel px-4 py-4">
                <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Scan Status</p>
                <p className="seclens-text mt-2 text-sm font-medium">{status}</p>
                <p className="seclens-muted mt-1 text-sm">{formatTimestamp(timestamp)}</p>
              </div>
              <div className="seclens-panel px-4 py-4">
                <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Report Gate</p>
                <p className="seclens-text mt-2 text-sm">{reportReady ? 'Ready to export' : 'Waiting on review completion'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function RunningPostureEstimate({ dashboard }) {
  const dimensions = dashboard?.dimensions || []
  const dimensionRuntime = dashboard?.dimensionRuntime || {}
  const runState = String(dashboard?.runState || '').toLowerCase()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const reviewedCount = dimensions.filter(
    (dimension) => dimension.progress === 'ready' || dimension.progress === 'partial' || dimension.progress === 'failed'
  ).length

  const estimateFromRuntime = (dimension) => {
    const progress = String(dimension.progress || '').toLowerCase()
    if (progress === 'ready' || progress === 'partial' || progress === 'failed') return 100
    if (runState === 'synthesizing') return 100
    if (progress !== 'reviewing') return 0

    const runtime = dimensionRuntime?.[dimension.dimensionId] || null
    if (runtime?.startedAt) {
      const startedMs = Date.parse(runtime.startedAt)
      if (!Number.isNaN(startedMs)) {
        const passElapsed = Math.max(0, Math.floor((nowMs - startedMs) / 1000))
        return Math.round(Math.max(1, Math.min((passElapsed / DIMENSION_ESTIMATE_SECONDS) * 100, MAX_RUNNING_ESTIMATE)))
      }
    }
    return 1
  }

  return (
    <section className="mb-5 space-y-4">
      <div className="seclens-panel px-4 py-4">
        <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Posture</p>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h2 className="seclens-text text-[20px] font-semibold tracking-tight">Dimension Review In Progress</h2>
          <p className="seclens-muted text-xs tabular-nums">
            Reviewed dimensions: {reviewedCount}/{dimensions.length || 0}
          </p>
        </div>
        <p className="seclens-muted mt-0.5 text-[11px]">
          Estimates are replaced by final posture cards when scan completes.
        </p>

        <div className="mt-3 space-y-1.5">
          {dimensions.map((dimension) => {
            const definition = DIMENSION_CATALOG.find((item) => item.id === dimension.dimensionId)
            const isDone = dimension.progress === 'ready' || dimension.progress === 'partial' || dimension.progress === 'failed'
            const estimate = isDone ? 100 : estimateFromRuntime(dimension)
            return (
              <div key={dimension.dimensionId} className="rounded-[11px] border border-[var(--sl-border-soft)] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-[var(--sl-panel-muted)] seclens-text">
                      <DimensionGlyph icon={definition?.icon} />
                    </span>
                    <div className="min-w-0">
                      <p className="seclens-text truncate text-[12px] font-medium">{dimension.label}</p>
                    </div>
                  </div>
                  <span className="seclens-text shrink-0 text-[12px] tabular-nums">{estimate}%</span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-[var(--sl-panel-muted)]">
                  <div
                    className={cn(
                      'h-1 rounded-full transition-[width] duration-700 ease-out',
                      isDone ? 'bg-gradient-to-r from-[#1f7a3f] to-[#4dbd74]' : 'bg-gradient-to-r from-[#0a72ef] via-[#56ccf2] to-[#de1d8d]'
                    )}
                    style={{ width: `${estimate}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function PostureHero({ dashboard, isScanning }) {
  const summary = dashboard?.summary
  if (isScanning) {
    return <RunningPostureEstimate dashboard={dashboard} />
  }

  const ingestion = dashboard?.telemetry?.ingestion || null
  const states = stateBar(summary)
  const confidences = confidenceBars(summary)
  const totalFilesExamined = ingestion?.selectedFileCount ?? summary?.totals?.totalFilesExamined ?? 0
  const excludedNonGermane = ingestion?.nonGermaneExcludedCount ?? 0
  const eligibleFiles = ingestion?.totalEligibleFiles ?? totalFilesExamined
  const filesWithNoIssue = summary?.totals?.filesExaminedWithoutIssue ?? 0
  const repoProfile = dashboard?.repoProfile || null
  const profileList = Array.isArray(repoProfile?.profiles) ? repoProfile.profiles : []
  const applicabilityRows = (dashboard?.dimensions || [])
    .map((dimension) => ({
      id: dimension.dimensionId,
      label: dimension.shortLabel || dimension.label,
      weightPct: Math.round((dimension?.applicability?.weight || 0) * 100),
      status: dimension?.applicability?.status || 'applicable',
    }))
    .sort((left, right) => right.weightPct - left.weightPct)

  return (
    <section className="mb-5 space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px] xl:items-stretch">
        <article className="seclens-panel px-6 py-6">
          <div>
            <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Posture</p>
            <h2 className="seclens-text mt-2 text-[40px] font-semibold tracking-tight">
              {STATUS_LABELS[summary?.overallStatus || 'unknown']}
            </h2>
            <p className="seclens-muted mt-4 text-[15px] leading-8">
              {overallStatusCopy(summary?.overallStatus || 'unknown')}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-3">
            {summaryCards(summary).map((card) => (
              <div key={card.label} className={cn('rounded-[16px] bg-gradient-to-br p-[1px]', accentClass(card.accent))}>
                <div className="seclens-panel flex h-[124px] flex-col justify-between rounded-[15px] px-4 py-4">
                  <p className="seclens-subtle text-[10px] font-medium uppercase leading-4 tracking-[0.1em]">
                    {card.label}
                  </p>
                  <p className="seclens-text text-[30px] font-semibold tracking-tight tabular-nums">{card.value}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="seclens-panel flex h-full flex-col px-6 py-6">
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Coverage & Confidence</p>
          <div className="mt-5 flex flex-1 flex-col justify-between gap-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="seclens-muted">Security-relevant files examined</span>
                <span className="seclens-text tabular-nums">{totalFilesExamined}</span>
              </div>
              <div className="h-3 rounded-full bg-[var(--sl-panel-muted)]">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-[#0a72ef] via-[#56ccf2] to-[#de1d8d]"
                  style={{
                    width: `${Math.min(
                      100,
                      ((totalFilesExamined / Math.max(1, eligibleFiles + (summary?.totals?.omittedFilesRelevant || 0))) * 100)
                    )}%`,
                  }}
                />
              </div>
              <p className="seclens-muted mt-2 text-sm">
                {filesWithNoIssue} reviewed files did not surface a confirmed issue in this run.
              </p>
              {excludedNonGermane > 0 ? (
                <p className="seclens-muted mt-2 text-sm">
                  {excludedNonGermane} non-relevant files were left out of the security review counts.
                </p>
              ) : null}
            </div>

            <div className="space-y-3">
              {confidences.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="seclens-muted">{item.label} confidence</span>
                    <span className="seclens-text tabular-nums">{item.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--sl-panel-muted)]">
                    <div className="h-2 rounded-full" style={{ width: item.width, background: item.color }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="seclens-accent-pink rounded-[14px] px-4 py-4">
              <p className="seclens-text text-sm leading-6">
                {(summary?.totals?.findingsAdmitted || 0) > 0
                  ? 'Confirmed issues are backed by cited evidence and paired with concrete remediation guidance.'
                  : 'No confirmed launch-impacting issues were admitted in this run across the reviewed dimensions.'}
              </p>
            </div>
          </div>
        </article>
      </div>

      <article className="seclens-panel px-6 py-6">
        {profileList.length ? (
          <div className="seclens-surface mb-4 rounded-[16px] px-4 py-4">
            <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Repository Profile</p>
            <p className="seclens-text mt-2 text-sm">
              {profileList.join(', ')} ({repoProfile?.confidence || 'unknown'} confidence)
            </p>
            <p className="seclens-muted mt-2 text-sm">{repoProfile?.rationale || 'Profile rationale unavailable.'}</p>
          </div>
        ) : null}

        <div className="mb-3 flex items-center justify-between">
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Traffic Light Panel</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {states.map((item) => (
            <div
              key={item.id}
              className="rounded-[18px] border border-[var(--sl-border-soft)] bg-[var(--sl-panel-muted)] px-4 py-5"
            >
              <div className="mx-auto flex w-[84px] flex-col items-center gap-3 rounded-[999px] bg-[rgba(8,10,14,0.92)] px-3 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 text-[25px] font-semibold leading-none text-white tabular-nums shadow-[0_0_24px_rgba(0,0,0,0.35)]"
                  style={{
                    background: item.color,
                    boxShadow: `0 0 20px ${item.color}55, inset 0 1px 2px rgba(255,255,255,0.24)`,
                  }}
                >
                  {item.count}
                </span>
              </div>
              <div className="mt-4 text-center">
                <p className="seclens-text text-[15px] font-medium leading-6">{item.label}</p>
                <div className="mx-auto mt-2 h-1.5 w-14 rounded-full" style={{ background: item.color }} />
              </div>
            </div>
          ))}
        </div>
      </article>

      {applicabilityRows.length ? (
        <article className="seclens-panel px-6 py-6">
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Dimension Applicability</p>
          <div className="mt-4 space-y-3">
            {applicabilityRows.map((row) => (
              <div key={row.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="seclens-muted">{row.label}</span>
                  <span className="seclens-text tabular-nums">{row.weightPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--sl-panel-muted)]">
                  <div
                    className={cn(
                      'h-2 rounded-full',
                      row.status === 'not_applicable' ? 'bg-[#8b8b8f]' : 'bg-gradient-to-r from-[#0a72ef] to-[#56ccf2]'
                    )}
                    style={{ width: `${row.weightPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  )
}

function DimensionTable({ dimensions, selectedDimensionId, onSelectDimension }) {
  return (
    <div className="seclens-panel overflow-hidden">
      <div className="seclens-border-soft flex items-center justify-between border-b px-5 py-4">
        <div>
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Dimensions</p>
          <h3 className="seclens-text mt-1 text-[24px] font-semibold tracking-tight">Dimension review list</h3>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="seclens-surface">
            <tr className="text-left">
              <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">Dimension</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">Status</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">Progress</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">Findings</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">Controls</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">Reviewed Paths</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {dimensions.map((dimension) => {
              const definition = DIMENSION_CATALOG.find((item) => item.id === dimension.dimensionId)
              const isSelected = selectedDimensionId === dimension.dimensionId
              return (
                <tr
                  key={dimension.dimensionId}
                  className={cn(
                    'cursor-pointer border-b border-[var(--sl-border-soft)] transition-colors hover:bg-[var(--sl-panel-muted)]',
                    isSelected ? 'bg-[var(--sl-panel-muted)]' : ''
                  )}
                  onClick={() => onSelectDimension(dimension.dimensionId)}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <span className={cn('mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-[12px]', dimensionIconTone(definition?.icon))}>
                        <DimensionGlyph icon={definition?.icon} />
                      </span>
                      <div>
                        <p className="seclens-text text-sm font-medium">{dimension.label}</p>
                        <p className="seclens-muted mt-1 max-w-[32ch] text-sm line-clamp-2">
                          {dimension.summary.whatRemainsUnclear || dimension.summary.whatLooksStrong}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium', statusTone(dimension.status))}>
                      {STATUS_CHIP_LABELS[dimension.status]}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium', progressTone(dimension.progress))}>
                      {PROGRESS_CHIP_LABELS[dimension.progress]}
                    </span>
                  </td>
                  <td className="px-4 py-4 seclens-text tabular-nums">{dimension.findings.length}</td>
                  <td className="px-4 py-4 seclens-text tabular-nums">
                    {dimension.observedControls.length}/{dimension.unverifiedControls.length}
                  </td>
                  <td className="px-4 py-4 seclens-text tabular-nums">{dimension.evidence.reviewedPaths.length}</td>
                  <td className={cn('px-4 py-4 text-sm font-medium uppercase tracking-[0.08em]', confidenceTone(dimension.coverage.confidence))}>
                    {dimension.coverage.confidence}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DetailPanel({ dimension }) {
  if (!dimension) {
    return (
      <div className="seclens-panel px-6 py-6">
        <p className="seclens-muted text-sm">Select a dimension to inspect its evidence, uncertainty, and next actions.</p>
      </div>
    )
  }

  const sections = [
    { title: 'Confirmed', body: dimension.summary.whatLooksStrong },
    { title: 'Launch Action', body: dimension.summary.whatRemainsUnclear },
    {
      title: 'Attention First',
      body:
        dimension.findings[0]?.claim ||
        dimension.unverifiedControls[0]?.claim ||
        'No admitted issue outranked the current recommendation queue for this dimension.',
    },
    { title: 'Next Check', body: dimension.summary.whatToCheckNext },
  ]
  const evidenceEntries = Array.from(
    new Set([...(dimension.evidence.topCitations || []), ...(dimension.evidence.reviewedPaths || [])])
  )

  return (
    <div className="seclens-panel px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Selected Dimension</p>
          <h3 className="seclens-text mt-2 text-[28px] font-semibold tracking-tight">{dimension.label}</h3>
          <p className="seclens-muted mt-3 max-w-[60ch] text-sm leading-6">{dimension.coverage.coverageSummary}</p>
        </div>
        <div className="flex gap-2">
          <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium', statusTone(dimension.status))}>
            {STATUS_CHIP_LABELS[dimension.status]}
          </span>
          <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium', progressTone(dimension.progress))}>
            {PROGRESS_CHIP_LABELS[dimension.progress]}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="seclens-surface rounded-[16px] p-4">
            <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">{section.title}</p>
            <p className="seclens-text mt-3 text-sm leading-7">{section.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="seclens-surface rounded-[16px] p-4">
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Evidence Paths & Citations</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {evidenceEntries.length ? (
              evidenceEntries.map((entry) => (
                <code key={entry} className="rounded-[10px] bg-[var(--sl-panel)] px-3 py-2 text-[13px] seclens-text shadow-[inset_0_0_0_1px_var(--sl-border)]">
                  {entry}
                </code>
              ))
            ) : (
              <p className="seclens-muted text-sm">No evidence paths or citations were retained for this dimension yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RecommendationQueue({ items }) {
  return (
    <div className="seclens-panel px-6 py-6">
      <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Recommendation Queue</p>
      <h3 className="seclens-text mt-2 text-[22px] font-semibold tracking-tight">Prioritized next actions</h3>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.slice(0, 6).map((item) => (
            <div key={item.id} className="seclens-surface rounded-[16px] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[color:rgba(10,114,239,0.12)] px-2.5 py-1 text-[11px] font-medium text-[var(--sl-info-text)]">
                  {item.priority}
                </span>
                <span className="seclens-subtle text-xs uppercase tracking-[0.12em]">{item.dimensionLabel}</span>
              </div>
              <p className="seclens-text mt-3 text-sm leading-6">{item.text}</p>
              <p className="seclens-muted mt-2 text-[13px]">{item.evidenceTarget}</p>
            </div>
          ))
        ) : (
          <p className="seclens-muted text-sm">No synthesized recommendations are available yet.</p>
        )}
      </div>
    </div>
  )
}

function ReportSurface({ report, canExport, onExport, onDownload, isDownloading, readinessReasons }) {
  return (
    <div className="seclens-panel px-6 py-6">
      <div className="seclens-border-soft flex flex-col gap-4 border-b pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Consolidated Report</p>
          <h3 className="seclens-text mt-2 text-[24px] font-semibold tracking-tight">Premium export artifact</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onExport} disabled={!canExport || isDownloading} className="seclens-button-primary whitespace-nowrap">
            {isDownloading ? 'Preparing export...' : 'Export markdown'}
          </button>
          <button type="button" onClick={() => onDownload('text')} disabled={!canExport || isDownloading} className="seclens-button-secondary whitespace-nowrap">
            Text
          </button>
          <button type="button" onClick={() => onDownload('pdf')} disabled={!canExport || isDownloading} className="seclens-button-secondary whitespace-nowrap">
            PDF
          </button>
        </div>
      </div>
      {!canExport && readinessReasons?.length ? (
        <div className="seclens-surface seclens-muted mt-5 rounded-[12px] p-4 text-sm leading-6">
          {readinessReasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      ) : null}
      <div className="prose seclens-report mt-6 max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {normalizeReportMarkdown(report || 'The consolidated report will appear here once all required dimensions are ready.')}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function EvidenceIndex({ dimensions }) {
  const rows = dimensions.flatMap((dimension) =>
    dimension.evidence.topCitations.map((citation) => ({
      dimension: dimension.label,
      citation,
    }))
  )

  return (
    <div className="seclens-panel px-6 py-6">
      <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Evidence Index</p>
      <h3 className="seclens-text mt-2 text-[24px] font-semibold tracking-tight">Retained citations</h3>
      <div className="mt-5 space-y-2">
        {rows.length ? (
          rows.map((row) => (
            <div key={`${row.dimension}:${row.citation}`} className="seclens-surface flex flex-col gap-2 rounded-[12px] px-4 py-3 md:flex-row md:items-center md:justify-between">
              <span className="seclens-text text-sm">{row.dimension}</span>
              <code className="seclens-muted text-[13px]">{row.citation}</code>
            </div>
          ))
        ) : (
          <p className="seclens-muted text-sm">No evidence index entries are available yet.</p>
        )}
      </div>
    </div>
  )
}

function ExportHistory({ report, timestamp }) {
  return (
    <div className="seclens-panel px-6 py-6">
      <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Export History</p>
      <h3 className="seclens-text mt-2 text-[24px] font-semibold tracking-tight">Recent generated artifacts</h3>
      <div className="mt-5 space-y-3">
        {report ? (
          <div className="seclens-surface rounded-[12px] px-4 py-4">
            <p className="seclens-text text-sm font-medium">Latest consolidated report</p>
            <p className="seclens-muted mt-1 text-sm">Generated {formatTimestamp(timestamp)}</p>
          </div>
        ) : (
          <p className="seclens-muted text-sm">Exports from this session will appear here after the first generated report.</p>
        )}
      </div>
    </div>
  )
}

export default function DashboardShell({
  dashboard,
  activeView,
  onViewChange,
  selectedDimensionId,
  onSelectDimension,
  onRefresh,
  canRefresh,
  onExport,
  canExport,
  report,
  isDownloading,
  status,
  timestamp,
  onDownload,
  onScan,
  isScanning,
  scanButtonLabel,
  theme,
  onToggleTheme,
}) {
  const dimensions = dashboard?.dimensions || []
  const filteredDimensions = useMemo(() => dimensions, [dimensions])

  const selectedDimension =
    filteredDimensions.find((dimension) => dimension.dimensionId === selectedDimensionId) ||
    dimensions.find((dimension) => dimension.dimensionId === selectedDimensionId) ||
    filteredDimensions[0] ||
    dimensions[0] ||
    null

  return (
    <div className="flex min-h-[760px] flex-col gap-5 xl:flex-row">
      <Rail
        activeView={activeView}
        onViewChange={onViewChange}
        status={status}
        timestamp={timestamp}
        reportReady={dashboard?.consolidatedReportAvailable}
        onScan={onScan}
        isScanning={isScanning}
        scanButtonLabel={scanButtonLabel}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onRefresh={onRefresh}
        canRefresh={canRefresh}
        onExport={onExport}
        canExport={canExport}
      />

      <div className="min-w-0 flex-1">
        {(activeView === 'dashboard' || activeView === 'dimensions') && (
          <>
            <PostureHero dashboard={dashboard} isScanning={isScanning} />
            <section className="space-y-5">
              <DimensionTable
                dimensions={filteredDimensions}
                selectedDimensionId={selectedDimension?.dimensionId}
                onSelectDimension={onSelectDimension}
              />
              <DetailPanel dimension={selectedDimension} />
              <RecommendationQueue items={dashboard?.recommendationQueue || []} />
            </section>
          </>
        )}

        {activeView === 'report' && (
          <ReportSurface
            report={report}
            canExport={canExport}
            onExport={onExport}
            onDownload={onDownload}
            isDownloading={isDownloading}
            readinessReasons={dashboard?.reportReadinessReasons}
          />
        )}

        {activeView === 'evidence' && <EvidenceIndex dimensions={dimensions} />}
        {activeView === 'exports' && <ExportHistory report={report} timestamp={timestamp} />}
      </div>
    </div>
  )
}
