import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AdminRunsPage() {
  const { getIdToken } = useAuth()
  const [runs, setRuns] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadRuns() {
      setIsLoading(true)
      setError('')
      try {
        const token = await getIdToken()
        const response = await fetch('/api/admin/runs', {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error || `Failed to load runs (${response.status})`)
        }
        if (!cancelled) {
          setRuns(Array.isArray(data.runs) ? data.runs : [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load admin runs')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    loadRuns()
    return () => {
      cancelled = true
    }
  }, [getIdToken])

  return (
    <div className="seclens-bg min-h-screen p-6">
      <div className="seclens-panel mx-auto mt-10 max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">Admin Runs</h1>
        <p className="seclens-muted mt-2 text-sm">Most recent scan jobs (admin-only API).</p>
        {isLoading ? <p className="mt-4 text-sm">Loading...</p> : null}
        {error ? <p className="seclens-danger mt-4 rounded-md px-3 py-2 text-sm">{error}</p> : null}
        {!isLoading && !error ? (
          <div className="mt-4 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left">Job</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Repository</th>
                  <th className="px-2 py-2 text-left">Updated</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId || run.jobId}>
                    <td className="px-2 py-2 font-mono">
                      <Link className="underline" to={`/admin/runs/${run.runId || run.jobId}`}>
                        {run.runId || run.jobId}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{run.status}</td>
                    <td className="px-2 py-2">{run.repository?.displayName || '-'}</td>
                    <td className="px-2 py-2">{run.updatedAt || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
