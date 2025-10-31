import { useState } from 'react'
import InputPanel from './components/InputPanel'
import ResultsPanel from './components/ResultsPanel'
import Footer from './components/Footer'
import Modal from './components/Modal'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsAndConditions from './components/TermsAndConditions'

function App() {
  const [report, setReport] = useState(null)
  const [repository, setRepository] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)
  

  const handleScan = async (input) => {
    setIsLoading(true)
    setError(null)
    setReport(null)
    setRepository(null)

    const url = typeof input === 'string' ? input : input?.url
    const tokenForThisScan = typeof input === 'string' ? undefined : input?.githubToken

    try {
      // Call the API endpoint - always use /api for local dev (proxied by Vite)
      const endpoint = '/api/analyze'
      console.log('Making request to:', endpoint)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repositoryUrl: url, githubToken: tokenForThisScan?.trim() ? tokenForThisScan.trim() : undefined }),
      })

      // Handle 404 specifically (API endpoint not found in dev mode)
      if (response.status === 404) {
        const isDev = import.meta.env.MODE === 'development'
        throw new Error(
          isDev
            ? [
                'API endpoint not found. The local API server is likely not running.',
                '',
                'To start both frontend and API on Windows (CMD):',
                '1) set OPENAI_API_KEY=your_api_key_here',
                '2) npm run dev:full',
                '',
                'Or start separately:',
                '1) npm run dev:api',
                '2) npm run dev',
              ].join('\n')
            : 'Service unavailable. Please try again later.'
        )
      }

      // Always try to parse response as JSON, even if content-type is wrong
      let data
      const text = await response.text()
      
      console.log('Response status:', response.status, 'Response text length:', text?.length, 'First 500 chars:', text?.substring(0, 500))
      
      if (text && text.trim()) {
        try {
          data = JSON.parse(text)
          console.log('Parsed JSON data:', data)
        } catch (parseError) {
          // If parsing fails, log the raw response for debugging
          console.error('JSON parse error:', parseError, 'Response text:', text)
          // If it's an error response, throw with the raw text
          if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}\n\nResponse: ${text}`)
          }
          throw new Error(`Invalid JSON response from server: ${text}`)
        }
      } else {
        // Empty response
        console.error('Empty response from server. Status:', response.status, 'StatusText:', response.statusText)
        if (!response.ok) {
          throw new Error(`Server error: ${response.status} ${response.statusText} (empty response)`)
        }
        throw new Error('Empty response from server')
      }

      if (!response.ok) {
        // Handle error responses - include detailed error info in dev mode
        const errorMessage = data?.error || `Server error: ${response.status}`
        const detailedError = data?.details || data?.message || data?.stack
        console.error('Error response data:', data)
        throw new Error(errorMessage + (detailedError ? `\n\nDetails: ${detailedError}` : ''))
      }

      // Set the report and repository info from API response
      setReport(data.report)
      setRepository(data.repository)
    } catch (err) {
      // Handle network errors or API errors
      const message = (err && err.message) ? err.message : 'An error occurred while analyzing the repository. Please try again later.'
      // Friendlier guidance for common network/offline cases and private repos
      const lower = message.toLowerCase()
      const isNetworkFailure = lower.includes('failed to fetch') || lower.includes('network')
      const isPrivateRepoCase = lower.includes('private') || lower.includes('access to repository denied') || lower.includes('ensure the token') || (lower.includes('not found') && lower.includes('repository'))
      const enhanced = isNetworkFailure
        ? [
            'Cannot reach local API server.',
            '',
            'Quick fix (Windows CMD):',
            '1) set OPENAI_API_KEY=your_api_key_here',
            '2) npm run dev:full',
            '',
            'If scanning a private repo, tick "Private Repo?" and include a token.',
          ].join('\n')
        : isPrivateRepoCase
        ? [
            'Private repository access required. Tick "Private Repo?" and include a GitHub token with read access.',
          ].join('\n')
        : message
      setError(enhanced)
      console.error('Analysis error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = async (format) => {
    if (!report) return

    setIsDownloading(true)

    try {
      // Call the API endpoint - always use /api for local dev (proxied by Vite)
      const endpoint = `/api/download/${format}`
      console.log('Making download request to:', endpoint)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          report,
          repository 
        }),
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Download endpoint not found. Please start the API server with "npm run dev:api" or use "npm run dev:full" to start both frontend and API servers.')
        }
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to download file')
        } else {
          throw new Error(`Server error: ${response.status} ${response.statusText}`)
        }
      }

      // Get filename from Content-Disposition header or generate default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `SecLens_Report.${format}`
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      // Get blob and trigger download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Download error:', err)
      alert(`Failed to download ${format.toUpperCase()} file: ${err.message}`)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="min-h-screen text-gray-100 flex flex-col" style={{ backgroundColor: '#000000' }}>
      {/* Header */}
      <header className="backdrop-blur-md shadow-lg border-b border-gray-700/50" style={{ backgroundColor: '#101012' }}>
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="SecLens Logo" className="h-24 w-auto" />
            <div>
              <h1 className="text-3xl font-bold text-gray-100">
                SecLens
              </h1>
              <p className="text-gray-300 mt-1">
                GitHub Repository Security Analysis
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6" style={{ backgroundColor: '#000000' }}>
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 h-[calc(100vh-280px)] min-h-[600px] min-h-0">
          {/* Input Panel - Left side on desktop, top on mobile */}
          <div className="lg:col-span-3 h-full min-h-0">
            <InputPanel onScan={handleScan} isLoading={isLoading} />
          </div>

          {/* Results Panel - Right side on desktop, bottom on mobile */}
          <div className="lg:col-span-7 h-full min-h-0">
            <ResultsPanel 
              report={report} 
              isLoading={isLoading} 
              error={error}
              onDownload={handleDownload}
              isDownloading={isDownloading}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer 
        onOpenPrivacy={() => setShowPrivacyModal(true)}
        onOpenTerms={() => setShowTermsModal(true)}
      />

      {/* Modals */}
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
