import { IconBookOpen, IconDashboard, IconMoonNight, IconReportDoc, IconSunBright } from './SecLensIcons'

/** Demo-only signed-in state for header layout (not wired to auth). */
const MOCK_SIGNED_IN_USER = {
  email: 'alex.morgan@flowinternals.example',
  displayName: 'Alex Morgan',
}

function initialsFromUser({ email, displayName }) {
  const parts = String(displayName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase()
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  const local = String(email || '').split('@')[0] || '?'
  return local.slice(0, 2).toUpperCase()
}

function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}

function toolbarIconButton(tone, { active = false, disabled = false } = {}) {
  const base =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sl-info-text)]'
  const tones = {
    dashboard:
      'border-emerald-400/40 bg-gradient-to-br from-[rgba(34,197,94,0.36)] to-[rgba(110,231,183,0.14)] text-[#bbf7d0] hover:border-emerald-300/55 hover:from-[rgba(34,197,94,0.48)] hover:to-[rgba(110,231,183,0.22)]',
    report:
      'border-violet-400/40 bg-gradient-to-br from-[rgba(124,108,242,0.38)] to-[rgba(186,170,255,0.14)] text-[#ddd4ff] hover:border-violet-300/50 hover:from-[rgba(124,108,242,0.48)] hover:to-[rgba(186,170,255,0.22)]',
    docs:
      'border-amber-400/45 bg-gradient-to-br from-[rgba(222,139,29,0.36)] to-[rgba(255,193,111,0.14)] text-[#ffe3bc] hover:border-amber-300/60 hover:from-[rgba(222,139,29,0.46)] hover:to-[rgba(255,193,111,0.24)]',
    themeSun:
      'border-amber-200/45 bg-gradient-to-br from-[rgba(255,200,112,0.38)] to-[rgba(255,236,200,0.14)] text-[#fff8e7] hover:border-amber-100/55 hover:from-[rgba(255,200,112,0.5)] hover:to-[rgba(255,236,200,0.22)]',
    themeMoon:
      'border-indigo-400/40 bg-gradient-to-br from-[rgba(99,102,241,0.38)] to-[rgba(167,139,250,0.16)] text-[#e8e4ff] hover:border-indigo-300/50 hover:from-[rgba(99,102,241,0.48)] hover:to-[rgba(167,139,250,0.24)]',
  }
  return cn(
    base,
    tones[tone],
    active && 'ring-2 ring-white/30 ring-offset-2 ring-offset-[var(--sl-panel)]',
    disabled && 'pointer-events-none cursor-not-allowed opacity-40 saturate-[0.65]'
  )
}

export default function HeaderToolbar({ activeView, onViewChange, theme, onToggleTheme }) {
  const mockUser = MOCK_SIGNED_IN_USER
  const avatarInitials = initialsFromUser(mockUser)

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={() => onViewChange('dashboard')}
        className={toolbarIconButton('dashboard', {
          active: activeView === 'dashboard' || activeView === 'dimensions',
        })}
        aria-label="Open launch readiness dashboard"
        title="Open launch readiness dashboard — posture, dimensions, and coverage"
      >
        <IconDashboard className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => onViewChange('report')}
        className={toolbarIconButton('report', { active: activeView === 'report' })}
        aria-label="Open consolidated report"
        title="Open consolidated launch-readiness report"
      >
        <IconReportDoc className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => onViewChange('docs')}
        className={toolbarIconButton('docs', { active: activeView === 'docs' })}
        aria-label="Open documentation"
        title="Open SecLens product documentation"
      >
        <IconBookOpen className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onToggleTheme}
        className={toolbarIconButton(theme === 'dark' ? 'themeSun' : 'themeMoon')}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light color theme' : 'Switch to dark color theme'}
      >
        {theme === 'dark' ? <IconSunBright className="h-5 w-5" /> : <IconMoonNight className="h-5 w-5" />}
      </button>

      <div
        className="ml-1 flex min-w-0 max-w-full items-center gap-2.5 border-l border-[var(--sl-border-soft)] pl-3 sm:ml-2 sm:gap-3 sm:pl-4"
        title="Demo account (not signed in to a live session)"
        aria-label={`Demo signed-in user, ${mockUser.email}`}
      >
        <div className="min-w-0 text-right">
          <p className="seclens-muted truncate text-[10px] font-medium uppercase tracking-[0.08em]">Signed in</p>
          <p className="seclens-text truncate text-sm font-medium leading-tight">{mockUser.email}</p>
        </div>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-400/35 bg-gradient-to-br from-[rgba(10,114,239,0.55)] to-[rgba(86,204,242,0.28)] text-[11px] font-semibold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
          aria-hidden="true"
        >
          {avatarInitials}
        </span>
      </div>
    </div>
  )
}
