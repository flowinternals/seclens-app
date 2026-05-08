import { Link } from 'react-router-dom'

export default function AdminPage() {
  return (
    <div className="seclens-bg min-h-screen p-6">
      <div className="seclens-panel mx-auto mt-10 max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="seclens-muted mt-2 text-sm">
          Admin-only area for SecLens operational views.
        </p>
        <div className="mt-5">
          <Link to="/admin/runs" className="seclens-button-secondary h-10">
            View run summaries
          </Link>
        </div>
      </div>
    </div>
  )
}
