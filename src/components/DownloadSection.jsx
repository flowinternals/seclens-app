import { sanitizeText } from '../utils/sanitize'
import GlowingButton from './GlowingButton'

function DownloadButton({ format, onDownload, disabled }) {
  const formats = {
    markdown: { label: 'Markdown', ext: 'md' },
    text: { label: 'Text', ext: 'txt' },
    pdf: { label: 'PDF', ext: 'pdf' }
  }

  const formatInfo = formats[format]

  return (
    <GlowingButton
      onClick={() => onDownload(format)}
      disabled={disabled}
      aria-label={`Download as ${formatInfo.label}`}
    >
      <span>{formatInfo.label}</span>
    </GlowingButton>
  )
}

function DownloadSection({ report, onDownload, isDownloading }) {
  if (!report) return null

  return (
    <div className="border-t border-gray-700/50 pt-4 mt-4 text-center">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Download Report</h3>
      <div className="flex flex-wrap gap-3 justify-center">
        <DownloadButton
          format="markdown"
          onDownload={onDownload}
          disabled={isDownloading}
        />
        <DownloadButton
          format="text"
          onDownload={onDownload}
          disabled={isDownloading}
        />
        <DownloadButton
          format="pdf"
          onDownload={onDownload}
          disabled={isDownloading}
        />
      </div>
      {isDownloading && (
        <p className="text-sm text-gray-400 mt-2">Preparing download...</p>
      )}
    </div>
  )
}

export default DownloadSection

