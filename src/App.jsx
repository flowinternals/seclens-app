import { useEffect, useRef, useState } from 'react'
import ResultsPanel from './components/ResultsPanel'
import InputPanel from './components/InputPanel'
import { TrafficLightReportSection } from './components/DashboardShell'
import HeaderToolbar from './components/HeaderToolbar'
import AdminTelemetrySidebar from './components/AdminTelemetrySidebar'
import BillingSidebar from './components/BillingSidebar'
import Footer from './components/Footer'
import Modal from './components/Modal'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsAndConditions from './components/TermsAndConditions'
import { getDimensionDefinition } from '../lib/shared/dimensions'
import { buildRepositoryDisplay, createQueuedDashboard } from '../lib/server/dimensionAnalysis.js'
import {
  DEFAULT_OPENAI_MODEL_ID,
  OPENAI_MODEL_CATALOG,
  getOpenAIModelById,
} from '../lib/shared/openaiModels'
import { useAuth } from './context/AuthContext'

const MODEL_STORAGE_KEY = 'seclens-analysis-model'

/** Neutral repo URL for first-load / idle dashboard (no prior scan results). */
const IDLE_REPO_URL = 'https://github.com/example/placeholder'

function createIdleDashboard() {
  const dash = createQueuedDashboard(buildRepositoryDisplay(IDLE_REPO_URL))
  return {
    ...dash,
    selectedDimensionId: null,
    summary: dash.summary ? { ...dash.summary, selectedDimensionId: null } : dash.summary,
  }
}

const IDLE_BOOTSTRAP = (() => {
  const dashboard = createIdleDashboard()
  return { dashboard, repository: dashboard.repository }
})()

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
  const { user, isAuthenticated, isAdmin, getIdToken, signOutUser } = useAuth()
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    const stored = window.localStorage.getItem('seclens-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [dashboard, setDashboard] = useState(() => IDLE_BOOTSTRAP.dashboard)
  const [report, setReport] = useState(null)
  const [repository, setRepository] = useState(() => IDLE_BOOTSTRAP.repository)
  const [error, setError] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false)
  const [isBillingOpen, setIsBillingOpen] = useState(false)
  const [activeView, setActiveView] = useState('dashboard')
  const [selectedDimensionId, setSelectedDimensionId] = useState(null)
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_OPENAI_MODEL_ID
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY)
    return getOpenAIModelById(stored)?.id || DEFAULT_OPENAI_MODEL_ID
  })

  const jobIdRef = useRef(null)
  const pollTimerRef = useRef(null)
  const selectedModelRef = useRef(selectedModel)
  /** True from scan click until the job finishes or fails to start - drives UI while waiting for POST / jobId. */
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
    selectedModelRef.current = selectedModel
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel)
    }
  }, [selectedModel])

  useEffect(() => {
    if (!selectedDimensionId && dashboard?.selectedDimensionId) {
      setSelectedDimensionId(dashboard.selectedDimensionId)
    }
  }, [dashboard, selectedDimensionId])

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      setIsAdminPanelOpen(false)
    }
  }, [isAuthenticated, isAdmin])

  useEffect(() => {
    if (!isAuthenticated) {
      setIsBillingOpen(false)
    }
  }, [isAuthenticated])

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
        const idToken = await getIdToken()
        const response = await fetch(`/api/scan-jobs?jobId=${encodeURIComponent(jobIdRef.current)}`, {
          headers: {
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
        })
        const data = await response.json()
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(
              'This advisory result is no longer available in the current session. Please run the scan again or export results immediately after completion.'
            )
          }
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
    if (!isAuthenticated) {
      setError('Sign in to run an advisory scan.')
      scanSessionActiveRef.current = false
      return
    }

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
      const idToken = await getIdToken()
      const response = await fetch('/api/scan-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          repositoryUrl: url,
          githubToken: tokenForThisScan?.trim() ? tokenForThisScan.trim() : undefined,
          // Use ref so a rapid "model change -> run scan" click does not send stale model state.
          analysisModel: selectedModelRef.current,
        }),
      })

      const contentType = response.headers.get('content-type')
      const raw = await response.text()
      let data = {}
      if (contentType && contentType.includes('application/json') && raw) {
        try {
          data = JSON.parse(raw)
        } catch {
          data = {}
        }
      }
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
      setDashboard(IDLE_BOOTSTRAP.dashboard)
      setRepository(IDLE_BOOTSTRAP.repository)
      setSelectedDimensionId(null)
    }
  }

  const handleDownload = async (format) => {
    if (!reportContent) return
    if (!isAuthenticated) {
      setError('Sign in to export reports.')
      return
    }

    setIsDownloading(true)

    try {
      const idToken = await getIdToken()
      const response = await fetch(`/api/download/${format}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
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
            selectedModel={selectedModel}
            modelOptions={OPENAI_MODEL_CATALOG}
            onModelChange={(nextModel) =>
              setSelectedModel(getOpenAIModelById(nextModel)?.id || DEFAULT_OPENAI_MODEL_ID)
            }
            user={user}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            isAdminPanelOpen={isAdminPanelOpen}
            isBillingOpen={isBillingOpen}
            onToggleAdminPanel={() => setIsAdminPanelOpen((current) => !current)}
            onOpenBilling={() => setIsBillingOpen(true)}
            onSignOut={signOutUser}
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

      <AdminTelemetrySidebar isOpen={isAdminPanelOpen && isAuthenticated && isAdmin} onClose={() => setIsAdminPanelOpen(false)} />
      <BillingSidebar isOpen={isBillingOpen && isAuthenticated} onClose={() => setIsBillingOpen(false)} />
    </div>
  )
}

export default App
