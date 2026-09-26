import DashboardShell from './DashboardShell'

function normalizePanelError(error) {
  if (!error) return null
  if (typeof error === 'string') {
    return { kind: 'scan', message: error }
  }
  const message = typeof error.message === 'string' ? error.message : String(error)
  const kind = error.kind === 'export' ? 'export' : 'scan'
  return { kind, message }
}

function ErrorState({ title, error, testId = 'scan-error' }) {
  return (
    <div
      className="seclens-panel flex min-h-[420px] items-center justify-center px-6 py-10"
      data-testid={testId}
    >
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
        <h3 className="seclens-text mt-5 text-2xl font-semibold tracking-tight">{title}</h3>
        <p
          className="seclens-muted mt-3 whitespace-pre-wrap text-sm leading-6"
          role="alert"
          data-testid={`${testId}-message`}
        >
          {error}
        </p>
      </div>
    </div>
  )
}

function ExportErrorBanner({ message, onDismiss }) {
  return (
    <div
      className="seclens-panel mb-4 flex flex-wrap items-start justify-between gap-3 border border-[color-mix(in_srgb,var(--sl-danger)_35%,transparent)] px-4 py-3"
      data-testid="export-error"
      role="alert"
    >
      <div className="min-w-0 flex-1">
        <p className="seclens-text text-sm font-semibold">Export failed</p>
        <p className="seclens-muted mt-1 whitespace-pre-wrap text-sm leading-6" data-testid="export-error-message">
          {message}
        </p>
      </div>
      {typeof onDismiss === 'function' ? (
        <button type="button" className="seclens-button-secondary shrink-0 text-sm" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  )
}

function ResultsPanel(props) {
  const panelError = normalizePanelError(props.error)

  if (panelError?.kind === 'scan') {
    return <ErrorState title="Scan failed" error={panelError.message} testId="scan-error" />
  }

  return (
    <>
      {panelError?.kind === 'export' ? (
        <ExportErrorBanner message={panelError.message} onDismiss={props.onDismissExportError} />
      ) : null}
      <DashboardShell {...props} />
    </>
  )
}

export default ResultsPanel
