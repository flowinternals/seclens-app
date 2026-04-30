import { useEffect, useRef, useState } from 'react'
import ResultsPanel from './components/ResultsPanel'
import Footer from './components/Footer'
import Modal from './components/Modal'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsAndConditions from './components/TermsAndConditions'
import { createMockDashboardPayload, getDimensionDefinition } from '../lib/shared/dimensions'

const initialDashboard = createMockDashboardPayload()

function buildScanButtonLabel(dashboard) {
  const runState = String(dashboard?.runState || '').toLowerCase()
  const dimensions = Array.isArray(dashboard?.dimensions) ? dashboard.dimensions : []
  const activeDimension =
    dimensions.find((dimension) => dimension.progress === 'reviewing') ||
    dimensions.find((dimension) => dimension.progress === 'synthesizing') ||
    null

  if (runState === 'fetching') return 'Fetching repo'
  if (runState === 'synthesizing') return 'Finalizing report'
  if (runState === 'queued') return 'Queueing scan'

  if (activeDimension?.dimensionId) {
    const definition = getDimensionDefinition(activeDimension.dimensionId)
    const shortLabel = String(definition?.shortLabel || activeDimension.label || 'scan')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
    return `Reviewing ${shortLabel}`
  }

  if (runState === 'running') return 'Reviewing code'
  return 'Run scan'
}

function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    const stored = window.localStorage.getItem('seclens-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [dashboard, setDashboard] = useState(initialDashboard)
  const [report, setReport] = useState(null)
  const [repository, setRepository] = useState(initialDashboard.repository)
  const [status, setStatus] = useState('Previewing sample dashboard')
  const [timestamp, setTimestamp] = useState(null)
  const [error, setError] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)
  const [activeView, setActiveView] = useState('dashboard')
  const [selectedDimensionId, setSelectedDimensionId] = useState(initialDashboard.selectedDimensionId)

  const jobIdRef = useRef(null)
  const pollTimerRef = useRef(null)

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  useEffect(() => stopPolling, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('seclens-theme', theme)
    }
  }, [theme])

  useEffect(() => {
    if (!selectedDimensionId && dashboard?.selectedDimensionId) {
      setSelectedDimensionId(dashboard.selectedDimensionId)
    }
  }, [dashboard, selectedDimensionId])

  const reportContent = report || dashboard?.report || null
  const isRunActive = Boolean(
    jobIdRef.current &&
      ['queued', 'fetching', 'running', 'synthesizing'].includes(String(dashboard?.runState || '').toLowerCase())
  )
  const scanButtonLabel = isRunActive ? buildScanButtonLabel(dashboard) : 'Run scan'

  const schedulePoll = (delayMs = 1500) => {
    stopPolling()
    pollTimerRef.current = setTimeout(async () => {
      if (!jobIdRef.current) return
      try {
        const response = await fetch(`/api/scan-jobs?jobId=${encodeURIComponent(jobIdRef.current)}`)
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error || `Polling failed with ${response.status}`)
        }

        setDashboard(data.dashboard || dashboard)
        setReport(data.report || null)
        setRepository(data.repository || repository)
        setTimestamp(data.updatedAt || new Date().toISOString())
        setStatus(
          data.status === 'completed'
            ? 'Scan complete'
            : data.status === 'synthesizing'
              ? 'Synthesizing consolidated report'
              : data.status === 'fetching'
                ? 'Fetching repository'
                : data.status === 'failed'
                  ? 'Scan failed'
                  : 'Scanning dimensions'
        )
        if (data.dashboard?.selectedDimensionId && !selectedDimensionId) {
          setSelectedDimensionId(data.dashboard.selectedDimensionId)
        }

        if (data.status === 'failed') {
          stopPolling()
          jobIdRef.current = null
          setError(data.error || 'The scan job failed.')
          return
        }

        if (data.status === 'completed') {
          stopPolling()
          jobIdRef.current = null
          setActiveView('dashboard')
          return
        }

        schedulePoll(1500)
      } catch (pollError) {
        stopPolling()
        setError(pollError.message || 'Failed to poll scan status.')
      }
    }, delayMs)
  }

  const handleScan = async (input) => {
    stopPolling()
    setError(null)
    setReport(null)
    setActiveView('dashboard')
    const url = typeof input === 'string' ? input : input?.url
    const tokenForThisScan = typeof input === 'string' ? undefined : input?.githubToken

    try {
      const response = await fetch('/api/scan-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositoryUrl: url,
          githubToken: tokenForThisScan?.trim() ? tokenForThisScan.trim() : undefined,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || `Could not start scan (${response.status})`)
      }

      jobIdRef.current = data.jobId
      setDashboard(data.dashboard)
      setRepository(data.repository)
      setStatus('Scan queued')
      setTimestamp(data.updatedAt || new Date().toISOString())
      setSelectedDimensionId(data.dashboard?.selectedDimensionId || null)
      schedulePoll(data.polling?.intervalMs || 1500)
    } catch (scanError) {
      setError(scanError.message || 'An error occurred while starting the scan.')
    }
  }

  const handleRefresh = () => {
    if (isRunActive) {
      schedulePoll(10)
    }
  }

  const handleDownload = async (format) => {
    if (!reportContent) return

    setIsDownloading(true)

    try {
      const response = await fetch(`/api/download/${format}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          report: reportContent,
          repository,
        }),
      })

      if (!response.ok) {
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to download file')
        }
        throw new Error(`Server error: ${response.status} ${response.statusText}`)
      }

      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `SecLens_Report.${format}`
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) filename = filenameMatch[1]
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(anchor)
    } catch (downloadError) {
      setError(downloadError.message || `Failed to download ${format.toUpperCase()} file.`)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="seclens-bg min-h-screen seclens-text" data-theme={theme}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-4 lg:px-6">
        <header className="seclens-panel flex items-center gap-4 px-5 py-5">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="SecLens Logo" className="h-14 w-auto rounded-[12px]" />
            <div>
              <p className="seclens-subtle text-[11px] font-medium uppercase tracking-[0.12em]">Launch Readiness</p>
              <h1 className="seclens-text text-2xl font-semibold tracking-tight">SecLens</h1>
              <p className="seclens-muted mt-1 text-sm">Security posture dashboard</p>
            </div>
          </div>
        </header>

        <ResultsPanel
          dashboard={dashboard}
          repository={repository}
          report={report}
          error={error}
          onDownload={handleDownload}
          isDownloading={isDownloading}
          activeView={activeView}
          onViewChange={setActiveView}
          selectedDimensionId={selectedDimensionId}
          onSelectDimension={setSelectedDimensionId}
          onRefresh={handleRefresh}
          canRefresh={isRunActive}
          onExport={() => handleDownload('markdown')}
          canExport={Boolean(reportContent && dashboard?.consolidatedReportAvailable)}
          status={status}
          timestamp={timestamp}
          onScan={handleScan}
          isScanning={isRunActive && !error}
          scanButtonLabel={scanButtonLabel}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        />

        <Footer
          onOpenPrivacy={() => setShowPrivacyModal(true)}
          onOpenTerms={() => setShowTermsModal(true)}
        />
      </div>

      <Modal
        isOpen={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        title="Privacy Policy"
      >
        <PrivacyPolicy />
      </Modal>

      <Modal
        isOpen={showTermsModal}
        onClose={() => setShowTermsModal(false)}
        title="Terms & Conditions"
      >
        <TermsAndConditions />
      </Modal>
    </div>
  )
}

export default App
