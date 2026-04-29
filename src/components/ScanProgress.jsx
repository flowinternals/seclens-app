import { useEffect, useMemo, useState } from 'react'

export const SCAN_PHASES = [
  { id: 'resolve', label: 'Resolving repository and branch', durationSec: 8 },
  { id: 'inventory', label: 'Building repository inventory', durationSec: 17 },
  { id: 'select', label: 'Selecting security-relevant files', durationSec: 17 },
  { id: 'evidence', label: 'Reading line-addressable evidence', durationSec: 25 },
  { id: 'assess', label: 'Assessing security posture', durationSec: 20 },
  { id: 'report', label: 'Generating and validating report', durationSec: 13 },
]

const TOTAL_ESTIMATED_SEC = SCAN_PHASES.reduce((acc, phase) => acc + phase.durationSec, 0)
const MAX_ESTIMATED_PROGRESS = 95

function getCurrentPhaseIndex(elapsedSeconds) {
  let acc = 0
  for (let i = 0; i < SCAN_PHASES.length; i += 1) {
    acc += SCAN_PHASES[i].durationSec
    if (elapsedSeconds < acc) return i
  }
  return SCAN_PHASES.length - 1
}

export function formatElapsedTime(elapsedSeconds) {
  const safe = Math.max(0, Math.floor(elapsedSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function getEstimatedProgress(elapsedSeconds, prefersReducedMotion = false) {
  const safeElapsed = Math.max(0, elapsedSeconds)
  if (prefersReducedMotion) {
    const phaseIndex = getCurrentPhaseIndex(safeElapsed)
    return Math.min(
      MAX_ESTIMATED_PROGRESS,
      Math.round(((phaseIndex + 1) / SCAN_PHASES.length) * MAX_ESTIMATED_PROGRESS)
    )
  }

  const normalized = Math.min(safeElapsed / TOTAL_ESTIMATED_SEC, 1)
  const eased = 1 - Math.pow(1 - normalized, 2.1)
  return Math.min(MAX_ESTIMATED_PROGRESS, Math.round(eased * MAX_ESTIMATED_PROGRESS))
}

function ScanProgress() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const phaseIndex = useMemo(() => getCurrentPhaseIndex(elapsedSeconds), [elapsedSeconds])
  const estimatedProgress = useMemo(
    () => getEstimatedProgress(elapsedSeconds, prefersReducedMotion),
    [elapsedSeconds, prefersReducedMotion]
  )

  return (
    <div className="w-full max-w-2xl mx-auto">
      <p className="sr-only" role="status" aria-live="polite">
        Repository scan in progress. Estimated scan steps are shown while SecLens analyzes evidence.
      </p>
      <div className="text-center mb-6">
        <p className="text-lg font-semibold text-gray-100">Building an evidence-bound security assessment</p>
        <p className="text-sm text-gray-400 mt-2">
          Larger repositories may take a little longer while SecLens inventories files,
          selects security-relevant evidence, and validates the report.
        </p>
        <p className="text-xs text-gray-500 mt-2">These are estimated scan steps, not exact backend milestones.</p>
      </div>

      <div className="rounded-xl border border-gray-700/50 bg-black/20 p-4 sm:p-5 min-h-[320px]">
        <div className="mb-4" aria-hidden="true">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
            <span>Estimated scan progress</span>
            <span>Elapsed {formatElapsedTime(elapsedSeconds)}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400/80 via-sky-400/80 to-blue-400/90 motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
              style={{ width: `${estimatedProgress}%` }}
            />
          </div>
        </div>

        <ul className="space-y-2.5 mt-4" aria-label="Estimated scan phases">
          {SCAN_PHASES.map((phase, index) => {
            const isCurrent = index === phaseIndex
            const isComplete = index < phaseIndex
            return (
              <li
                key={phase.id}
                className={`rounded-md border px-3 py-2 flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'border-cyan-400/60 bg-cyan-500/10'
                    : 'border-gray-700/60 bg-gray-900/30'
                }`}
              >
                <span
                  className={`text-sm ${
                    isComplete ? 'text-gray-200' : isCurrent ? 'text-cyan-200' : 'text-gray-400'
                  }`}
                >
                  {phase.label}
                </span>
                <span
                  className={`text-[11px] uppercase tracking-wide ${
                    isComplete ? 'text-emerald-300' : isCurrent ? 'text-cyan-300' : 'text-gray-500'
                  }`}
                >
                  {isComplete ? 'Estimated' : isCurrent ? 'In progress' : 'Up next'}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default ScanProgress
