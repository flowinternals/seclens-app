import DashboardShell from './DashboardShell'

function ErrorState({ error }) {
  return (
    <div className="seclens-panel flex min-h-[420px] items-center justify-center px-6 py-10">
      <div className="max-w-xl text-center">
        <div className="seclens-danger mx-auto flex h-14 w-14 items-center justify-center rounded-full">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M12 9v3.75m0 3.75h.01M10.29 3.86l-7.5 13A1 1 0 003.66 18h16.68a1 1 0 00.87-1.14l-7.5-13a1 1 0 00-1.74 0z"
            />
          </svg>
        </div>
        <h3 className="seclens-text mt-5 text-2xl font-semibold tracking-tight">Scan failed</h3>
        <p className="seclens-muted mt-3 whitespace-pre-wrap text-sm leading-6" role="alert">
          {error}
        </p>
      </div>
    </div>
  )
}

function ResultsPanel(props) {
  if (props.error) {
    return <ErrorState error={props.error} />
  }

  return <DashboardShell {...props} />
}

export default ResultsPanel
