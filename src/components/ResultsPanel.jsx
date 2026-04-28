import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import DownloadSection from './DownloadSection'
import ScanProgress from './ScanProgress'

function ResultsPanel({ report, isLoading, error, onDownload, isDownloading }) {
  // Normalize model output: if the entire report is wrapped in a single
  // top-level fenced code block (```), unwrap it so Markdown renders.
  const normalizeReportMarkdown = (input) => {
    if (!input) return input
    const trimmed = String(input).trim()
    const fenceMatch = trimmed.match(/^```(?:[a-zA-Z]*)\n([\s\S]*)\n```$/)
    if (fenceMatch && fenceMatch[1]) {
      return fenceMatch[1].trim()
    }
    return trimmed
  }
  if (isLoading) {
    return (
      <div className="backdrop-blur-md rounded-lg shadow-xl border border-gray-700/30 p-6 h-full flex items-center justify-center" style={{ backgroundColor: '#101012' }}>
        <ScanProgress />
      </div>
    )
  }

  if (error) {
    return (
      <div className="backdrop-blur-md rounded-lg shadow-xl border border-gray-700/30 p-6 h-full flex items-center justify-center" style={{ backgroundColor: '#101012' }}>
        <div className="text-center max-w-md">
          <div className="text-red-500 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-gray-100 mb-2">Analysis Failed</h3>
          <p className="text-gray-300" role="alert">{error}</p>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="backdrop-blur-md rounded-lg shadow-xl border border-gray-700/30 p-6 h-full flex items-center justify-center" style={{ backgroundColor: '#101012' }}>
        <div className="text-center text-gray-400">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-lg font-medium">No report yet</p>
          <p className="text-sm mt-2">Enter a GitHub repository URL to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="backdrop-blur-md rounded-lg shadow-xl border border-gray-700/30 p-6 h-full min-h-0 flex flex-col" style={{ backgroundColor: '#101012' }}>
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-700/50">
        <h2 className="text-xl font-semibold text-gray-100">Security Report</h2>
      </div>
      <div className="flex-1 overflow-y-auto mb-4">
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {normalizeReportMarkdown(report)}
          </ReactMarkdown>
        </div>
      </div>
      <DownloadSection 
        report={report} 
        onDownload={onDownload}
        isDownloading={isDownloading}
      />
    </div>
  )
}

export default ResultsPanel
