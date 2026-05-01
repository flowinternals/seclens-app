import { useEffect, useRef, useState } from 'react'
import ResultsPanel from './components/ResultsPanel'
import InputPanel from './components/InputPanel'
import { TrafficLightReportSection } from './components/DashboardShell'
import HeaderToolbar from './components/HeaderToolbar'
import Footer from './components/Footer'
import Modal from './components/Modal'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsAndConditions from './components/TermsAndConditions'
import { createMockDashboardPayload, getDimensionDefinition } from '../lib/shared/dimensions'
import { buildRepositoryDisplay, createQueuedDashboard } from '../lib/server/dimensionAnalysis.js'

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
  const [error, setError] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)
  const [activeView, setActiveView] = useState('dashboard')
  const [selectedDimensionId, setSelectedDimensionId] = useState(initialDashboard.selectedDimensionId)

  const jobIdRef = useRef(null)
  const pollTimerRef = useRef(null)
  /** True from scan click until the job finishes or fails to start — drives UI while waiting for POST / jobId. */
  const scanSessionActiveRef = useRef(false)

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
  const runStateLower = String(dashboard?.runState || '').toLowerCase()
  const isRunActive = Boolean(
    !error &&
      scanSessionActiveRef.current &&
      ['queued', 'fetching', 'running', 'synthesizing'].includes(runStateLower)
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
        if (data.dashboard?.selectedDimensionId && !selectedDimensionId) {
          setSelectedDimensionId(data.dashboard.selectedDimensionId)
        }

        if (data.status === 'failed') {
          stopPolling()
          jobIdRef.current = null
          scanSessionActiveRef.current = false
          setError(data.error || 'The scan job failed.')
          return
        }

        if (data.status === 'completed') {
          stopPolling()
          jobIdRef.current = null
          scanSessionActiveRef.current = false
          setActiveView('dashboard')
          return
        }

        schedulePoll(1500)
      } catch (pollError) {
        stopPolling()
        jobIdRef.current = null
        scanSessionActiveRef.current = false
        setError(pollError.message || 'Failed to poll scan status.')
      }
    }, delayMs)
  }

  const handleScan = async (input) => {
    stopPolling()
    jobIdRef.current = null
    setError(null)
    setReport(null)
    setActiveView('dashboard')
    scanSessionActiveRef.current = true

    const url = typeof input === 'string' ? input : input?.url
    const tokenForThisScan = typeof input === 'string' ? undefined : input?.githubToken
    const trimmedUrl = typeof url === 'string' ? url.trim() : ''
    if (trimmedUrl) {
      const repoDisplay = buildRepositoryDisplay(trimmedUrl)
      setDashboard(createQueuedDashboard(repoDisplay))
      setRepository(repoDisplay)
      setSelectedDimensionId(null)
    }

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
      setSelectedDimensionId(data.dashboard?.selectedDimensionId || null)
      schedulePoll(data.polling?.intervalMs || 1500)
    } catch (scanError) {
      scanSessionActiveRef.current = false
      setError(scanError.message || 'An error occurred while starting the scan.')
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

  const showIntakeTrafficRow = !error && (activeView === 'dashboard' || activeView === 'dimensions')

  return (
    <div className="seclens-bg min-h-screen seclens-text" data-theme={theme}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-4 lg:px-6">
        <header className="seclens-panel flex flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <img src="/logo.png" alt="SecLens Logo" className="h-14 w-auto shrink-0 rounded-[12px]" />
            <div className="min-w-0">
              <h1 className="seclens-text text-2xl font-semibold tracking-tight">SecLens</h1>
              <p className="seclens-muted mt-1 text-sm">Security posture dashboard</p>
            </div>
          </div>
          <HeaderToolbar
            activeView={activeView}
            onViewChange={setActiveView}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          />
        </header>

        <div
          className={
            showIntakeTrafficRow
              ? 'grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch lg:gap-5'
              : 'contents'
          }
        >
          <div className={showIntakeTrafficRow ? 'min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col' : 'contents'}>
            <InputPanel
              onScan={handleScan}
              isLoading={isRunActive && !error}
              loadingLabel={scanButtonLabel}
              onExport={() => handleDownload('markdown')}
              canExport={Boolean(reportContent && dashboard?.consolidatedReportAvailable)}
              isExporting={isDownloading}
              className={showIntakeTrafficRow ? 'h-full min-h-0 lg:flex lg:flex-col' : ''}
            />
          </div>
          {showIntakeTrafficRow ? (
            <div className="min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
              <TrafficLightReportSection dashboard={dashboard} className="h-full min-h-0 flex-1" />
            </div>
          ) : null}
        </div>

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
          onExport={() => handleDownload('markdown')}
          canExport={Boolean(reportContent && dashboard?.consolidatedReportAvailable)}
          isScanning={isRunActive && !error}
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
