function Footer({ onOpenPrivacy, onOpenTerms }) {
  return (
    <footer className="seclens-panel mt-auto px-4 py-4">
      <div className="seclens-muted flex flex-wrap items-center justify-center gap-4 text-sm">
          <span className="seclens-subtle">© 2025 Sagesilver Pty Ltd</span>
          <span className="seclens-subtle">|</span>
          <button
            type="button"
            onClick={onOpenPrivacy}
            className="rounded px-2 py-1 transition-colors hover:text-[var(--sl-text)]"
            aria-label="Open Privacy Policy"
            title="Open Privacy Policy in a dialog"
          >
            Privacy Policy
          </button>
          <span className="seclens-subtle">|</span>
          <button
            type="button"
            onClick={onOpenTerms}
            className="rounded px-2 py-1 transition-colors hover:text-[var(--sl-text)]"
            aria-label="Open Terms and Conditions"
            title="Open Terms & Conditions in a dialog"
          >
            Terms & Conditions
          </button>
        </div>
    </footer>
  )
}

export default Footer

