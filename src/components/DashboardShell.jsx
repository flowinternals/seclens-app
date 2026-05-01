import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useMemo, useState } from 'react'
import { DIMENSION_CATALOG } from '../../lib/shared/dimensions'
import { getDefaultDocsSlug, getSeclensDocsEntries } from '../seclensDocsManifest.js'
import { IconChartConfidence, IconFiles, IconGithubRepo } from './SecLensIcons'
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
  progressing: 'Progressing',
  completed: 'Completed',
  failed: 'Failed',
}

const DIMENSION_ESTIMATE_SECONDS = 18
const MAX_RUNNING_ESTIMATE = 96

function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}

function formatElapsedHms(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function catalogOrderForDimensionId(dimensionId) {
  const definition = DIMENSION_CATALOG.find((item) => item.id === dimensionId)
  return definition?.order ?? Number.MAX_SAFE_INTEGER
}

function isTerminalDimensionProgress(progress) {
  const normalized = String(progress || '').toLowerCase()
  return normalized === 'completed' || normalized === 'ready' || normalized === 'failed'
}

function normalizeProgress(progress) {
  const normalized = String(progress || '').toLowerCase()
  if (normalized === 'failed') return 'failed'
  if (normalized === 'partial') return 'failed'
  if (normalized === 'completed' || normalized === 'ready') return 'completed'
  return 'progressing'
}

function isCompletedDimensionProgress(progress) {
  return normalizeProgress(progress) === 'completed'
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
  if (progress === 'progressing') {
    return 'text-[var(--sl-info-text)] bg-[color:rgba(10,114,239,0.12)]'
  }
  if (progress === 'failed') return 'text-[var(--sl-danger-text)] bg-[var(--sl-danger-bg)]'
  return 'text-[var(--sl-success-text)] bg-[color:rgba(31,122,63,0.14)]'
}

function ProgressStatusGlyph({ progress }) {
  const p = normalizeProgress(progress)
  const shared = {
    className: 'h-[14px] w-[14px] shrink-0',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.1,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  if (p === 'completed') {
    return (
      <svg {...shared}>
        <path d="M20 6L9 17l-5-5" />
      </svg>
    )
  }
  if (p === 'failed') {
    return (
      <svg {...shared}>
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    )
  }
  if (p === 'progressing') {
    return (
      <svg {...shared}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" opacity="0.45" />
      </svg>
    )
  }
  return (
    <svg {...shared}>
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function confidenceTone(confidence) {
  if (confidence === 'high') return 'text-[var(--sl-success-text)]'
  if (confidence === 'medium') return 'text-[var(--sl-warn-text)]'
  return 'seclens-muted'
}

function toSentenceCase(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  return `${text[0].toUpperCase()}${text.slice(1)}`
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
    {
      label: 'Dimensions Reviewed',
      value: `${totals.dimensionsReviewed || 0}/${totals.totalDimensions || 0}`,
      accent: 'blue',
      tooltip: 'How many planned security dimensions finished review in this run.',
    },
    {
      label: 'Findings',
      value: totals.findingsAdmitted || 0,
      accent: 'red',
      tooltip: 'Confirmed security issues admitted with evidence citations.',
    },
    {
      label: 'Controls',
      value: totals.observedControls || 0,
      accent: 'green',
      tooltip: 'Security controls observed as present in reviewed code.',
    },
    {
      label: 'Unverified',
      value: totals.unverifiedControls || 0,
      accent: 'amber',
      tooltip: 'Potential controls that were seen but not proven strongly enough.',
    },
    {
      label: 'Files Reviewed',
      value: totals.totalFilesExamined || 0,
      accent: 'violet',
      tooltip: 'Unique security-relevant files examined in this run.',
    },
    {
      label: 'High Confidence',
      value: totals.highConfidenceDimensions || 0,
      accent: 'pink',
      tooltip: 'Dimensions with high confidence based on retained evidence quality and coverage.',
    },
  ]
}

/** Visual treatment for idle-state posture metric tiles (six-up grid). */
function postureSummaryMetricSkin(accent) {
  if (accent === 'red') {
    return {
      outer:
        'bg-gradient-to-br from-[#ff5b4f]/75 via-[#ff5b4f]/28 to-[#5c1f24]/35 shadow-[0_6px_28px_-6px_rgba(255,91,79,0.35)]',
      inner: 'bg-gradient-to-br from-[rgba(255,91,79,0.14)] via-[var(--sl-panel-muted)] to-[var(--sl-panel)]',
      bar: 'bg-[#ff5b4f] shadow-[0_0_12px_rgba(255,91,79,0.45)]',
      value: 'text-[var(--sl-danger-text)]',
    }
  }
  if (accent === 'green') {
    return {
      outer:
        'bg-gradient-to-br from-[#4dbd74]/70 via-[#4dbd74]/25 to-[#143d24]/35 shadow-[0_6px_28px_-6px_rgba(77,189,116,0.28)]',
      inner: 'bg-gradient-to-br from-[rgba(77,189,116,0.12)] via-[var(--sl-panel-muted)] to-[var(--sl-panel)]',
      bar: 'bg-[#4dbd74] shadow-[0_0_12px_rgba(77,189,116,0.35)]',
      value: 'text-[var(--sl-success-text)]',
    }
  }
  if (accent === 'amber') {
    return {
      outer:
        'bg-gradient-to-br from-[#f0a020]/75 via-[#de8b1d]/22 to-[#4a3208]/40 shadow-[0_6px_28px_-6px_rgba(222,139,29,0.28)]',
      inner: 'bg-gradient-to-br from-[rgba(222,139,29,0.12)] via-[var(--sl-panel-muted)] to-[var(--sl-panel)]',
      bar: 'bg-[#de8b1d] shadow-[0_0_12px_rgba(222,139,29,0.35)]',
      value: 'text-[var(--sl-warn-text)]',
    }
  }
  if (accent === 'violet') {
    return {
      outer:
        'bg-gradient-to-br from-[#9d8cff]/65 via-[#7c6cf2]/28 to-[#2a2454]/45 shadow-[0_6px_28px_-6px_rgba(124,108,242,0.3)]',
      inner: 'bg-gradient-to-br from-[rgba(124,108,242,0.12)] via-[var(--sl-panel-muted)] to-[var(--sl-panel)]',
      bar: 'bg-[#9d8cff] shadow-[0_0_12px_rgba(157,140,255,0.35)]',
      value: 'seclens-text',
    }
  }
  if (accent === 'pink') {
    return {
      outer:
        'bg-gradient-to-br from-[#ff5f9a]/65 via-[#de1d8d]/25 to-[#4a1535]/42 shadow-[0_6px_28px_-6px_rgba(222,29,141,0.28)]',
      inner: 'bg-gradient-to-br from-[rgba(222,29,141,0.11)] via-[var(--sl-panel-muted)] to-[var(--sl-panel)]',
      bar: 'bg-[#ff74c8] shadow-[0_0_12px_rgba(255,116,200,0.35)]',
      value: 'seclens-text',
    }
  }
  return {
    outer:
      'bg-gradient-to-br from-[#56ccf2]/65 via-[#0a72ef]/32 to-[#0c2248]/45 shadow-[0_6px_28px_-6px_rgba(10,114,239,0.32)]',
    inner: 'bg-gradient-to-br from-[rgba(86,204,242,0.1)] via-[var(--sl-panel-muted)] to-[var(--sl-panel)]',
    bar: 'bg-[#56ccf2] shadow-[0_0_14px_rgba(86,204,242,0.4)]',
    value: 'text-[var(--sl-info-text)]',
  }
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

/** Traffic-light status counts; rendered directly under Start a scan on the dashboard. */
export function TrafficLightReportSection({ dashboard, className }) {
  const summary = dashboard?.summary
  const states = stateBar(summary)
  return (
    <article className={cn('seclens-panel flex min-h-0 flex-col px-6 py-6', className)} aria-label="Traffic light report">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Traffic Light Panel</p>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 content-start">
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
  )
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

function ScanProgressReportColumn({ dashboard }) {
  const dimensions = useMemo(() => {
    const list = [...(dashboard?.dimensions || [])]
    list.sort((left, right) => catalogOrderForDimensionId(left.dimensionId) - catalogOrderForDimensionId(right.dimensionId))
    return list
  }, [dashboard?.dimensions])
  const dimensionRuntime = dashboard?.dimensionRuntime || {}
  const [nowMs, setNowMs] = useState(() => Date.now())
  const scanStartedMs = useMemo(() => {
    const parsed = Date.parse(dashboard?.startedAt || '')
    return Number.isNaN(parsed) ? null : parsed
  }, [dashboard?.startedAt])
  const scanCompletedMs = useMemo(() => {
    const parsed = Date.parse(dashboard?.completedAt || '')
    return Number.isNaN(parsed) ? null : parsed
  }, [dashboard?.completedAt])
  const runStateLower = String(dashboard?.runState || '').toLowerCase()
  const runFinished = runStateLower === 'completed' || runStateLower === 'failed'

  useEffect(() => {
    if (runFinished && scanCompletedMs != null) return
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [runFinished, scanCompletedMs])

  const completedCount = dimensions.filter((dimension) => isCompletedDimensionProgress(dimension.progress)).length
  const elapsedEndMs = runFinished && scanCompletedMs != null ? scanCompletedMs : nowMs
  const elapsedHms =
    scanStartedMs != null ? formatElapsedHms(Math.max(0, elapsedEndMs - scanStartedMs)) : formatElapsedHms(0)
  const firstPendingIndex = dimensions.findIndex((dimension) => normalizeProgress(dimension.progress) === 'progressing')

  const estimateFromRuntime = (dimension) => {
    const progress = String(dimension.progress || '').toLowerCase()
    if (progress === 'completed' || progress === 'failed') return 100
    if (progress !== 'progressing') return 0

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
    <article className="seclens-panel flex min-h-[240px] flex-1 flex-col overflow-hidden">
      <div className="seclens-border-soft shrink-0 border-b px-6 py-5">
        <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Progress report</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h2 className="seclens-text text-[18px] font-semibold tracking-tight sm:text-[20px]">Dimension review in progress</h2>
          <p className="seclens-muted text-xs tabular-nums">
            <span>
              Completed: {completedCount}/{dimensions.length || 0}
            </span>
            <span className="mx-1.5" aria-hidden>
              ·
            </span>
            <span title={runFinished ? 'Total run duration for this scan' : 'Elapsed since this scan started'}>{elapsedHms}</span>
          </p>
        </div>
        <p className="seclens-muted mt-1 text-[11px] leading-relaxed">
          Progress is shown as progressing, completed, or failed.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-1.5">
          {dimensions.map((dimension) => {
            const definition = DIMENSION_CATALOG.find((item) => item.id === dimension.dimensionId)
            const progress = normalizeProgress(dimension.progress)
            const isDone = progress === 'completed'
            const isFailed = progress === 'failed'
            const rowIndex = dimensions.findIndex((item) => item.dimensionId === dimension.dimensionId)
            const estimate =
              isDone || isFailed
                ? 100
                : rowIndex === firstPendingIndex
                  ? estimateFromRuntime({ ...dimension, progress })
                  : 0
            return (
              <div key={dimension.dimensionId} className="rounded-[11px] border border-[var(--sl-border-soft)] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]',
                        dimensionIconTone(definition?.icon)
                      )}
                    >
                      <DimensionGlyph icon={definition?.icon} />
                    </span>
                    <div className="min-w-0">
                      <p className="seclens-text truncate text-[12px] font-medium">{dimension.label}</p>
                    </div>
                  </div>
                  <span className="seclens-text shrink-0 text-[12px] tabular-nums">{estimate}%</span>
                </div>
                <div className="mt-1.5 h-1 w-full min-w-0 rounded-full bg-[var(--sl-panel-muted)]">
                  <div
                    className={cn(
                      'h-1 max-w-full rounded-full transition-[width] duration-700 ease-out',
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
    </article>
  )
}

function IdleProgressReportColumn({ dashboard, dimensions }) {
  const ordered = useMemo(() => {
    const list = [...(dimensions || [])]
    list.sort((left, right) => catalogOrderForDimensionId(left.dimensionId) - catalogOrderForDimensionId(right.dimensionId))
    return list
  }, [dimensions])

  const scanStartedMs = useMemo(() => {
    const parsed = Date.parse(dashboard?.startedAt || '')
    return Number.isNaN(parsed) ? null : parsed
  }, [dashboard?.startedAt])
  const scanCompletedMs = useMemo(() => {
    const parsed = Date.parse(dashboard?.completedAt || '')
    return Number.isNaN(parsed) ? null : parsed
  }, [dashboard?.completedAt])
  const persistedRunDuration =
    scanStartedMs != null && scanCompletedMs != null ? formatElapsedHms(Math.max(0, scanCompletedMs - scanStartedMs)) : null

  const completedCount = useMemo(() => ordered.filter((dimension) => isCompletedDimensionProgress(dimension.progress)).length, [ordered])

  return (
    <article className="seclens-panel flex min-h-[240px] flex-1 flex-col overflow-hidden">
      <div className="seclens-border-soft shrink-0 border-b px-6 py-5">
        <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Progress report</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h2 className="seclens-text text-[18px] font-semibold tracking-tight sm:text-[20px]">Dimension status</h2>
          {persistedRunDuration ? (
            <p className="seclens-muted text-xs tabular-nums">
              <span>
                Completed: {completedCount}/{ordered.length || 0}
              </span>
              <span className="mx-1.5" aria-hidden>
                ·
              </span>
              <span title="Total run duration for the latest scan">{persistedRunDuration}</span>
            </p>
          ) : null}
        </div>
        <p className="seclens-muted mt-1 text-sm leading-relaxed">Per-dimension progress from the latest run.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-2">
          {ordered.map((dimension) => {
            const definition = DIMENSION_CATALOG.find((item) => item.id === dimension.dimensionId)
            const progress = normalizeProgress(dimension.progress)
            return (
              <div
                key={dimension.dimensionId}
                className="flex items-center justify-between gap-3 rounded-[11px] border border-[var(--sl-border-soft)] px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]',
                      dimensionIconTone(definition?.icon)
                    )}
                  >
                    <DimensionGlyph icon={definition?.icon} />
                  </span>
                  <p className="seclens-text truncate text-[13px] font-medium">{dimension.label}</p>
                </div>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium',
                    progressTone(progress)
                  )}
                >
                  <ProgressStatusGlyph progress={progress} />
                  {PROGRESS_CHIP_LABELS[progress]}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function CoverageConfidenceColumn({ dashboard, summary }) {
  const ingestion = dashboard?.telemetry?.ingestion || null
  const runStateLower = String(dashboard?.runState || '').toLowerCase()
  const confidenceReady = runStateLower === 'completed'
  const confidences = confidenceReady
    ? confidenceBars(summary)
    : [
        { label: 'High', count: 0, color: '#4dbd74', width: '0%' },
        { label: 'Medium', count: 0, color: '#de8b1d', width: '0%' },
        { label: 'Low', count: 0, color: '#de1d8d', width: '0%' },
      ]
  const totalFilesExamined = ingestion?.selectedFileCount ?? summary?.totals?.totalFilesExamined ?? 0
  const excludedNonGermane = ingestion?.nonGermaneExcludedCount ?? 0
  const eligibleFiles = ingestion?.totalEligibleFiles ?? totalFilesExamined
  const filesWithNoIssue = summary?.totals?.filesExaminedWithoutIssue ?? 0

  return (
    <article className="seclens-panel flex h-full min-h-[260px] flex-col px-6 py-6">
      <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Coverage & Confidence</p>
      <div className="mt-5 flex min-h-0 flex-1 flex-col justify-between gap-5">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span className="seclens-muted inline-flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[color:rgba(10,114,239,0.12)] text-[var(--sl-info-text)]">
                <IconFiles className="h-4 w-4" />
              </span>
              <span className="min-w-0 leading-snug">Security-relevant files examined</span>
            </span>
            <span className="seclens-text shrink-0 tabular-nums">{totalFilesExamined}</span>
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
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em] seclens-subtle">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[color:rgba(222,29,141,0.12)] text-[#de1d8d]">
              <IconChartConfidence className="h-4 w-4" />
            </span>
            Confidence mix
          </div>
          {confidences.map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="seclens-muted inline-flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full ring-2 ring-[var(--sl-border-soft)]" style={{ background: item.color }} aria-hidden />
                  {item.label} confidence
                </span>
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
  )
}

function PostureHero({ dashboard, isScanning }) {
  const summary = dashboard?.summary
  const rawDimensions = dashboard?.dimensions || []
  const orderedForScan = useMemo(() => {
    const list = [...(dashboard?.dimensions || [])]
    list.sort((left, right) => catalogOrderForDimensionId(left.dimensionId) - catalogOrderForDimensionId(right.dimensionId))
    return list
  }, [dashboard?.dimensions])

  const repo = dashboard?.repository
  const repoLabel =
    (repo && typeof repo === 'object' && (repo.displayName || repo.url || [repo.owner, repo.name].filter(Boolean).join('/'))) ||
    'Repository'

  const repoProfile = dashboard?.repoProfile || null
  const profileList = Array.isArray(repoProfile?.profiles) ? repoProfile.profiles : []
  const runStateLower = String(dashboard?.runState || '').toLowerCase()
  const applicabilityReadyToRate = runStateLower === 'completed'
  const applicabilityUnavailable = runStateLower === 'failed'
  const applicabilityRows = rawDimensions
    .map((dimension) => {
      const serverWeightPct = Math.round((dimension?.applicability?.weight || 0) * 100)
      const serverStatus = dimension?.applicability?.status || 'applicable'
      return {
        id: dimension.dimensionId,
        label: dimension.shortLabel || dimension.label,
        weightPct: applicabilityReadyToRate ? serverWeightPct : 0,
        status: applicabilityReadyToRate ? serverStatus : applicabilityUnavailable ? 'retry_needed' : 'still_working',
        displayText: applicabilityReadyToRate ? `${serverWeightPct}%` : applicabilityUnavailable ? 'Unavailable' : 'Pending',
      }
    })
    .sort((left, right) => right.weightPct - left.weightPct)

  const completedCount = orderedForScan.filter((dimension) => isCompletedDimensionProgress(dimension.progress)).length

  return (
    <section className="mb-5 space-y-4">
      <div className="grid gap-4 xl:grid-cols-2 xl:items-stretch">
        <article className="seclens-panel flex min-h-[280px] flex-col px-6 py-6 xl:h-full xl:min-h-0">
          {isScanning ? (
            <>
              <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Posture</p>
              <h2 className="seclens-text mt-2 text-[22px] font-semibold tracking-tight sm:text-[26px]">Review in flight</h2>
              <p className="seclens-muted mt-3 text-[15px] leading-7">
                Launch posture finalizes as dimensions complete. Per-dimension progress stays on the right; coverage and applicability
                sit together in the row under posture.
              </p>
              <div className="seclens-surface mt-5 rounded-[14px] px-4 py-3">
                <p className="seclens-subtle flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.1em]">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-[8px] bg-[var(--sl-panel-muted)] seclens-text">
                    <IconGithubRepo className="h-3.5 w-3.5" />
                  </span>
                  Target repository
                </p>
                <p className="seclens-text mt-2 break-all font-mono text-[13px] leading-snug">{repoLabel}</p>
              </div>
              <p className="seclens-muted mt-4 text-sm tabular-nums">
                Dimensions completed: {completedCount}/{orderedForScan.length || 0}
              </p>
            </>
          ) : (
            <>
              <div>
                <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Posture</p>
                <h2 className="seclens-text mt-2 text-[28px] font-semibold tracking-tight xl:text-[36px]">
                  {STATUS_LABELS[summary?.overallStatus || 'unknown']}
                </h2>
                <p className="seclens-muted mt-4 text-[15px] leading-8">{overallStatusCopy(summary?.overallStatus || 'unknown')}</p>
              </div>
              <div className="mt-8 grid flex-1 grid-cols-2 content-start gap-3 sm:gap-4">
                {summaryCards(summary).map((card) => {
                  const skin = postureSummaryMetricSkin(card.accent)
                  return (
                    <div
                      key={card.label}
                      title={card.tooltip}
                      className={cn('rounded-[18px] p-px transition-transform duration-200 hover:-translate-y-0.5', skin.outer)}
                    >
                      <div
                        className={cn(
                          'flex min-h-[118px] gap-3 rounded-[17px] border border-[var(--sl-border-soft)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_2px_12px_rgba(0,0,0,0.2)]',
                          skin.inner
                        )}
                      >
                        <div className={cn('mt-0.5 w-1 shrink-0 self-stretch rounded-full', skin.bar)} aria-hidden />
                        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
                          <p className="seclens-subtle text-[10px] font-medium uppercase leading-4 tracking-[0.12em]">{card.label}</p>
                          <p className={cn('text-[24px] font-semibold tracking-tight tabular-nums xl:text-[28px]', skin.value)}>{card.value}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </article>

        <div className="flex min-h-0 flex-col gap-4 xl:h-full">
          {isScanning ? (
            <ScanProgressReportColumn dashboard={dashboard} />
          ) : (
            <IdleProgressReportColumn dashboard={dashboard} dimensions={rawDimensions} />
          )}
        </div>
      </div>

      {profileList.length ? (
        <article className="seclens-panel px-6 py-6">
          <div className="seclens-surface rounded-[16px] px-4 py-4">
            <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Repository Profile</p>
            <p className="seclens-text mt-2 text-sm">
              {profileList.join(', ')} ({repoProfile?.confidence || 'unknown'} confidence)
            </p>
            <p className="seclens-muted mt-2 text-sm">{repoProfile?.rationale || 'Profile rationale unavailable.'}</p>
          </div>
        </article>
      ) : null}

      <div className={cn('grid gap-4', applicabilityRows.length > 0 ? 'xl:grid-cols-2 xl:items-stretch' : '')}>
        {applicabilityRows.length > 0 ? (
          <article className="seclens-panel flex h-full min-h-[260px] flex-col px-6 py-6">
            <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Dimension Applicability</p>
            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
              {applicabilityRows.map((row) => (
                <div key={row.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="seclens-muted">{row.label}</span>
                    <span className="seclens-text tabular-nums">{row.displayText}</span>
                  </div>
                  <div className="h-2 w-full min-w-0 overflow-hidden rounded-full bg-[var(--sl-panel-muted)]">
                    <div
                      className={cn(
                        'h-2 max-w-full rounded-full',
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
        <div className="min-w-0 xl:h-full">
          <CoverageConfidenceColumn dashboard={dashboard} summary={summary} />
        </div>
      </div>
    </section>
  )
}

function DimensionTable({ dimensions, selectedDimensionId, onSelectDimension }) {
  return (
    <div className="seclens-panel flex min-h-0 flex-col overflow-hidden xl:h-full">
      <div className="seclens-border-soft flex shrink-0 items-center justify-between border-b px-5 py-4">
        <div>
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Dimensions</p>
          <h3 className="seclens-text mt-1 text-[24px] font-semibold tracking-tight">Dimension review list</h3>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="seclens-surface grid grid-cols-[minmax(0,1fr)_90px_70px_90px_110px_100px] gap-x-2 border-b border-[var(--sl-border-soft)] px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] seclens-subtle">
          <div>Dimension</div>
          <div>Status</div>
          <div>Findings</div>
          <div>Controls</div>
          <div>Reviewed Paths</div>
          <div>Confidence</div>
        </div>
        {dimensions.map((dimension) => {
          const definition = DIMENSION_CATALOG.find((item) => item.id === dimension.dimensionId)
          const isSelected = selectedDimensionId === dimension.dimensionId
          return (
            <div
              key={dimension.dimensionId}
              className={cn(
                'grid cursor-pointer grid-cols-[minmax(0,1fr)_90px_70px_90px_110px_100px] gap-x-2 border-b border-[var(--sl-border-soft)] px-5 py-4 transition-colors hover:bg-[var(--sl-panel-muted)]',
                isSelected ? 'bg-[var(--sl-panel-muted)]' : ''
              )}
              title={`Show ${dimension.label} in the detail panel`}
              onClick={() => onSelectDimension(dimension.dimensionId)}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn('mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]', dimensionIconTone(definition?.icon))}>
                    <DimensionGlyph icon={definition?.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="seclens-text text-sm font-medium leading-snug">{dimension.label}</p>
                    <p className="seclens-muted mt-1 line-clamp-3 text-sm leading-relaxed break-words">
                      {dimension.summary.whatRemainsUnclear || dimension.summary.whatLooksStrong}
                    </p>
                  </div>
                </div>
              </div>
              <div className="pt-1 text-sm">
                <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-medium', statusTone(dimension.status))}>
                  {STATUS_CHIP_LABELS[dimension.status]}
                </span>
              </div>
              <div className="seclens-text pt-1 text-sm tabular-nums">{dimension.findings.length}</div>
              <div className="seclens-text pt-1 text-sm tabular-nums">
                {dimension.observedControls.length}/{dimension.unverifiedControls.length}
              </div>
              <div className="seclens-text pt-1 text-sm tabular-nums">{dimension.evidence.reviewedPaths.length}</div>
              <div className={cn('pt-1 text-sm font-medium tracking-[0.08em]', confidenceTone(dimension.coverage.confidence))}>
                {toSentenceCase(dimension.coverage.confidence)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DetailPanel({ dimension }) {
  if (!dimension) {
    return (
      <div className="seclens-panel flex min-h-0 flex-col justify-center px-6 py-6 xl:h-full">
        <p className="seclens-muted text-sm">Select a dimension to inspect its evidence, uncertainty, and next actions.</p>
      </div>
    )
  }

  const sections = [
    { id: 'looks-good', title: 'What looks good', body: dimension.summary.whatLooksStrong },
    { id: 'launch-action', title: 'Launch Action', body: dimension.summary.whatRemainsUnclear },
    {
      id: 'attention-first',
      title: 'Attention First',
      body:
        dimension.findings[0]?.claim ||
        dimension.unverifiedControls[0]?.claim ||
        'No admitted issue outranked the current recommendation queue for this dimension.',
    },
    { id: 'next-check', title: 'Next Check', body: dimension.summary.whatToCheckNext },
  ]
  const evidenceEntries = Array.from(
    new Set([...(dimension.evidence.topCitations || []), ...(dimension.evidence.reviewedPaths || [])])
  )
  const detailProgress = normalizeProgress(dimension.progress)

  return (
    <div className="seclens-panel flex min-h-0 flex-col px-6 py-6 xl:h-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Selected dimension</p>
          <h3 className="seclens-text mt-2 text-[28px] font-semibold tracking-tight">{dimension.label}</h3>
          <p className="seclens-muted mt-3 text-sm leading-6 xl:max-w-none">{dimension.coverage.coverageSummary}</p>
        </div>
        <div className="flex gap-2">
          <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium', statusTone(dimension.status))}>
            {STATUS_CHIP_LABELS[dimension.status]}
          </span>
          <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium', progressTone(detailProgress))}>
            {PROGRESS_CHIP_LABELS[detailProgress]}
          </span>
        </div>
      </div>

      <div className="mt-6 grid shrink-0 grid-cols-1 gap-4">
        {sections.map((section) => (
          <div key={section.id} className="seclens-surface rounded-[16px] p-4">
            <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">{section.title}</p>
            <p className="seclens-text mt-3 text-sm leading-7">{section.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 shrink-0">
        <div className="seclens-surface rounded-[16px] p-4">
          <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Evidence paths & citations</p>
          <div className="mt-3 flex flex-col gap-2">
            {evidenceEntries.length ? (
              evidenceEntries.map((entry) => (
                <code
                  key={entry}
                  className="block w-full min-w-0 break-words rounded-[10px] bg-[var(--sl-panel)] px-3 py-2 text-[13px] leading-normal seclens-text shadow-[inset_0_0_0_1px_var(--sl-border)]"
                >
                  {entry}
                </code>
              ))
            ) : (
              <p className="seclens-muted text-sm">No evidence paths or citations were retained for this dimension yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1" aria-hidden />
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

function DocsSurface({ title, markdown, docsEntries, activeSlug, onSelectSlug }) {
  return (
    <div className="seclens-panel px-6 py-6">
      <div className="seclens-border-soft border-b pb-4">
        <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Documentation</p>
        {docsEntries?.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {docsEntries.map((doc) => (
              <button
                key={doc.slug}
                type="button"
                onClick={() => onSelectSlug(doc.slug)}
                title={`Open documentation: ${doc.label}`}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  activeSlug === doc.slug
                    ? 'bg-[var(--sl-text)] text-[var(--sl-panel)]'
                    : 'seclens-muted bg-[var(--sl-panel-muted)] hover:seclens-text'
                )}
              >
                {doc.label}
              </button>
            ))}
          </div>
        ) : null}
        <h3 className={cn('seclens-text text-[24px] font-semibold tracking-tight', docsEntries?.length > 1 ? 'mt-4' : 'mt-2')}>
          {title}
        </h3>
      </div>
      <div className="prose seclens-report mt-6 max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  )
}

function ReportSurface({ report, canExport, onExport, onDownload, isDownloading, readinessReasons }) {
  const actionsLocked = !canExport || isDownloading
  const lockHint = isDownloading
    ? 'Wait for the current download or export to finish'
    : 'Export and downloads stay disabled until the consolidated report is launch-ready'
  const exportMarkdownTitle = actionsLocked ? lockHint : 'Export consolidated report as Markdown (.md)'
  const downloadTextTitle = actionsLocked ? lockHint : 'Download consolidated report as plain text (.txt)'
  const downloadPdfTitle = actionsLocked ? lockHint : 'Download consolidated report as PDF (.pdf)'

  return (
    <div className="seclens-panel px-6 py-6">
      <div className="seclens-border-soft flex flex-col gap-4 border-b pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h3 className="seclens-text text-[24px] font-semibold tracking-tight">Consolidated report</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex" title={exportMarkdownTitle}>
            <button
              type="button"
              onClick={onExport}
              disabled={!canExport || isDownloading}
              className="seclens-button-primary whitespace-nowrap"
            >
              {isDownloading ? 'Preparing export...' : 'Export markdown'}
            </button>
          </span>
          <span className="inline-flex" title={downloadTextTitle}>
            <button
              type="button"
              onClick={() => onDownload('text')}
              disabled={!canExport || isDownloading}
              className="seclens-button-secondary whitespace-nowrap"
            >
              Text
            </button>
          </span>
          <span className="inline-flex" title={downloadPdfTitle}>
            <button
              type="button"
              onClick={() => onDownload('pdf')}
              disabled={!canExport || isDownloading}
              className="seclens-button-secondary whitespace-nowrap"
            >
              PDF
            </button>
          </span>
        </div>
      </div>
      {!canExport && readinessReasons?.length ? (
        <div className="seclens-surface seclens-muted mt-5 rounded-[12px] p-4 text-sm leading-6">
          <p className="seclens-text mb-2 font-medium">Export is disabled for this run</p>
          {readinessReasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      ) : !canExport && report?.trim() ? (
        <div className="seclens-surface seclens-muted mt-5 rounded-[12px] p-4 text-sm leading-6">
          <p className="seclens-text font-medium">Export is disabled</p>
          <p className="mt-2">
            The consolidated report is not marked launch-ready yet. Finish or resolve all dimensions, then try again.
          </p>
        </div>
      ) : null}
      <div className="prose seclens-report mt-6 max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {normalizeReportMarkdown(report || 'The consolidated report will appear here once all required dimensions are completed.')}
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

export default function DashboardShell({
  dashboard,
  activeView,
  onViewChange,
  selectedDimensionId,
  onSelectDimension,
  onExport,
  canExport,
  report,
  isDownloading,
  onDownload,
  isScanning,
}) {
  const dimensions = dashboard?.dimensions || []
  const filteredDimensions = useMemo(() => dimensions, [dimensions])

  const selectedDimension =
    filteredDimensions.find((dimension) => dimension.dimensionId === selectedDimensionId) ||
    dimensions.find((dimension) => dimension.dimensionId === selectedDimensionId) ||
    filteredDimensions[0] ||
    dimensions[0] ||
    null

  const reportMarkdown = report || dashboard?.report || null

  const docsEntries = useMemo(() => getSeclensDocsEntries(), [])
  const [docsSlug, setDocsSlug] = useState(() => getDefaultDocsSlug())

  const activeDoc = useMemo(() => {
    if (!docsEntries.length) return null
    return docsEntries.find((d) => d.slug === docsSlug) || docsEntries[0]
  }, [docsEntries, docsSlug])

  useEffect(() => {
    if (activeView !== 'docs' || !docsEntries.length) return
    if (!docsSlug || !docsEntries.some((d) => d.slug === docsSlug)) {
      setDocsSlug(docsEntries[0].slug)
    }
  }, [activeView, docsEntries, docsSlug])

  return (
    <div className="min-h-[760px]">
      <div>
        {(activeView === 'dashboard' || activeView === 'dimensions') && (
          <>
            <PostureHero dashboard={dashboard} isScanning={isScanning} />
            <section className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-3 xl:items-stretch">
                <div className="min-w-0 xl:col-span-2 xl:flex xl:min-h-0 xl:flex-col">
                  <DimensionTable
                    dimensions={filteredDimensions}
                    selectedDimensionId={selectedDimension?.dimensionId}
                    onSelectDimension={onSelectDimension}
                  />
                </div>
                <div className="min-w-0 xl:col-span-1 xl:flex xl:min-h-0 xl:flex-col">
                  <DetailPanel dimension={selectedDimension} />
                </div>
              </div>
              <RecommendationQueue items={dashboard?.recommendationQueue || []} />
            </section>
          </>
        )}

        {activeView === 'report' && (
          <ReportSurface
            report={reportMarkdown}
            canExport={canExport}
            onExport={onExport}
            onDownload={onDownload}
            isDownloading={isDownloading}
            readinessReasons={dashboard?.reportReadinessReasons}
          />
        )}

        {activeView === 'evidence' && <EvidenceIndex dimensions={dimensions} />}

        {activeView === 'docs' && activeDoc ? (
          <DocsSurface
            title={activeDoc.label}
            markdown={activeDoc.content || '_No content._'}
            docsEntries={docsEntries}
            activeSlug={docsSlug}
            onSelectSlug={setDocsSlug}
          />
        ) : null}
      </div>
    </div>
  )
}
