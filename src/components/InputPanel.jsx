import { useState } from 'react'
import { sanitizeGitHubUrl } from '../utils/sanitize'
import GlowingButton from './GlowingButton'

function InputPanel({ onScan, isLoading }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [token, setToken] = useState('')

  const handleChange = (e) => {
    const value = e.target.value
    setUrl(value)
    setError('')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    
    if (!url.trim()) {
      setError('Please enter a GitHub repository URL')
      return
    }

    const sanitized = sanitizeGitHubUrl(url)
    if (!sanitized) {
      setError('Please enter a valid GitHub repository URL (e.g., https://github.com/user/repo)')
      return
    }

    onScan({ url: sanitized, githubToken: isPrivate && token.trim() ? token.trim() : undefined })
  }

  return (
    <div className="backdrop-blur-md rounded-lg shadow-xl border border-gray-700/30 p-6 h-full flex flex-col" style={{ backgroundColor: '#101012' }}>
      <h2 className="text-xl font-semibold text-gray-100 mb-4">
        Analyze Repository
      </h2>
      
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        <div className="mb-4">
          <label htmlFor="repo-url" className="block text-sm font-medium text-gray-300 mb-2">
            Repository URL
          </label>
          <input
            id="repo-url"
            type="text"
            value={url}
            onChange={handleChange}
            placeholder="https://github.com/user/repo"
            className={`w-full px-4 py-2 border rounded-lg backdrop-blur-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent ${
              error ? 'border-red-500' : 'border-gray-600'
            }`}
            style={{ backgroundColor: '#333333' }}
            disabled={isLoading}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? 'url-error' : undefined}
          />
          {error && (
            <p
              id="url-error"
              className="mt-2 text-sm text-red-500"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <GlowingButton
          type="submit"
          disabled={isLoading}
          className="w-full"
          fullWidth
          borderVariant="rainbow"
          aria-label={isLoading ? 'Analyzing repository' : 'Scan Repository'}
        >
          {isLoading ? (
            <>
              <svg
                className="h-5 w-5 text-cyan-200"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="inline-flex items-center gap-2">
                <span>Scanning...</span>
                <span
                  className="h-2 w-2 rounded-full bg-cyan-300 motion-safe:animate-pulse"
                  aria-hidden="true"
                />
              </span>
            </>
          ) : (
            'Scan Repository'
          )}
        </GlowingButton>

        {/* Private repo opt-in */}
        <div className="mt-4 space-y-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-300">
            <input
              aria-label="Private Repository"
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              disabled={isLoading}
              className="h-4 w-4"
            />
            Private Repo?
          </label>

          {isPrivate && (
            <div>
              <label htmlFor="gh-token" className="block text-sm font-medium text-gray-300 mb-2">
                GitHub Token (Read access)
              </label>
              <input
                id="gh-token"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_... or github_pat_..."
                className="w-full px-4 py-2 border rounded-lg backdrop-blur-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent border-gray-600"
                style={{ backgroundColor: '#333333' }}
                disabled={isLoading}
              />
            </div>
          )}
        </div>
      </form>
    </div>
  )
}

export default InputPanel

