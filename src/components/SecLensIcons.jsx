/** Shared stroke icons for consistent weight and sizing across chrome and intake. */

const stroke = {
  default: 1.85,
  md: 2,
}

export function IconDownload({ className = 'h-[18px] w-[18px]', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke.md} aria-hidden={ariaHidden}>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="M8 11l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 21h16" strokeLinecap="round" />
    </svg>
  )
}

/** Dashboard — four-tile grid. */
export function IconDashboard({ className = 'h-5 w-5', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden={ariaHidden}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.75" fill="currentColor" fillOpacity="0.12" stroke="currentColor" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.75" fill="currentColor" fillOpacity="0.08" stroke="currentColor" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.75" fill="currentColor" fillOpacity="0.08" stroke="currentColor" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.75" fill="currentColor" fillOpacity="0.12" stroke="currentColor" />
    </svg>
  )
}

/** Export — arrow into tray. */
export function IconExportTray({ className = 'h-5 w-5', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden={ariaHidden}>
      <path d="M12 3v9" strokeLinecap="round" />
      <path d="m8 11 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3.5" y="16.5" width="17" height="4.5" rx="1.25" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.85" />
    </svg>
  )
}

/** Consolidated report — document with fold and emphasis lines. */
export function IconReportDoc({ className = 'h-5 w-5', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden={ariaHidden}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinejoin="round" />
      <path d="M8 12.5h8M8 16h6" strokeLinecap="round" />
      <path d="M8 9h4" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  )
}

/** Documentation — closed book spread (two boards + spine). */
export function IconBookOpen({ className = 'h-5 w-5', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" aria-hidden={ariaHidden}>
      <path d="M2 7a2 2 0 012-2h7v15H4a2 2 0 01-2-2V7z" fill="currentColor" fillOpacity="0.1" stroke="currentColor" />
      <path d="M22 7a2 2 0 00-2-2h-7v15h7a2 2 0 002-2V7z" fill="currentColor" fillOpacity="0.1" stroke="currentColor" />
      <path d="M12 5v14" strokeLinecap="round" />
      <path d="M6 10h3M6 13h4" strokeLinecap="round" strokeWidth="1.65" opacity="0.5" />
      <path d="M15 10h3M14 13h4" strokeLinecap="round" strokeWidth="1.65" opacity="0.5" />
    </svg>
  )
}

export function IconSunBright({ className = 'h-5 w-5', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden={ariaHidden}>
      <circle cx="12" cy="12" r="3.75" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="1.85" />
      <path strokeLinecap="round" d="M12 2v2.25M12 19.75V22M4.22 4.22l1.59 1.59M18.19 18.19l1.59 1.59M2 12h2.25M19.75 12H22M4.22 19.78l1.59-1.59M18.19 5.81l1.59-1.59" />
    </svg>
  )
}

export function IconMoonNight({ className = 'h-5 w-5', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" aria-hidden={ariaHidden}>
      <path
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function IconGithubRepo({ className = 'h-[18px] w-[18px]', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke.default} aria-hidden={ariaHidden}>
      <path
        d="M9 19c-4 1.5-4-2.5-6-3m12 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconPlayScan({ className = 'h-[18px] w-[18px]', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden={ariaHidden}>
      <path d="M9 6.5v11l9.5-5.5L9 6.5z" />
    </svg>
  )
}

export function IconScanRadar({ className = 'h-5 w-5', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke.default} aria-hidden={ariaHidden}>
      <circle cx="11" cy="11" r="7" />
      <path d="M11 4v3.5M11 14.5V18M4 11h3.5M14.5 11H18" strokeLinecap="round" opacity="0.45" />
      <path d="M20 20l-3.2-3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 11l4-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconLock({ className = 'h-4 w-4', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke.default} aria-hidden={ariaHidden}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconFiles({ className = 'h-4 w-4', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke.default} aria-hidden={ariaHidden}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinejoin="round" />
      <path d="M14 2v6h6M8 13h8M8 17h5" strokeLinecap="round" />
    </svg>
  )
}

export function IconChartConfidence({ className = 'h-4 w-4', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke.default} aria-hidden={ariaHidden}>
      <path d="M4 19h16" strokeLinecap="round" />
      <path d="M7 16V10M12 16V6M17 16v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
