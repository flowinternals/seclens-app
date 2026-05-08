import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AdminRunDetailPage() {
  const { runId } = useParams()
  const { getIdToken } = useAuth()
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadRun() {
      setIsLoading(true)
      setError('')
      try {
        const token = await getIdToken()
        const response = await fetch(`/api/admin/runs/${runId}`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error || `Failed to load run (${response.status})`)
        }
        if (!cancelled) {
          setRun(data.run || null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load run')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    if (runId) {
      loadRun()
    }
    return () => {
      cancelled = true
    }
  }, [getIdToken, runId])

  return (
    <div className="seclens-bg min-h-screen p-6">
      <div className="seclens-panel mx-auto mt-10 max-w-5xl p-6">
        <div className="mb-4">
          <Link to="/admin/runs" className="text-sm underline">
            Back to run list
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Run Detail</h1>
        <p className="seclens-muted mt-2 text-sm font-mono">{runId}</p>
        {isLoading ? <p className="mt-4 text-sm">Loading...</p> : null}
        {error ? <p className="seclens-danger mt-4 rounded-md px-3 py-2 text-sm">{error}</p> : null}
        {!isLoading && !error && run ? (
          <pre className="mt-4 overflow-auto rounded-md bg-black/70 p-4 text-xs text-white">
            {JSON.stringify(run, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
