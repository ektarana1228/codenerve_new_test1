import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ThemeToggle } from '@platform/web-shared'
import { useSessionStore, type Language } from '../store/session'

// ─── Language definitions ─────────────────────────────────────────────────────

type LanguageOption = {
  id: Language
  label: string
  runtime: string
  icon: React.ReactNode
}

function PythonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden="true">
      <path
        fill="#3776AB"
        d="M11.914.002c-5.33 0-5 2.372-5 2.372l.006 2.459h5.084v.738H4.923S2 5.257 2 10.64c0 5.382 2.978 5.191 2.978 5.191h1.779v-2.498s-.096-2.979 2.929-2.979h5.049s2.832.046 2.832-2.737V2.78S18.028.003 11.914.003zM9.07 1.637a.909.909 0 1 1 0 1.818.909.909 0 0 1 0-1.818z"
      />
      <path
        fill="#FFD43B"
        d="M12.086 23.998c5.33 0 5-2.372 5-2.372l-.006-2.459h-5.084v-.738h7.081S22 18.743 22 13.36c0-5.382-2.978-5.191-2.978-5.191h-1.779v2.498s.096 2.979-2.929 2.979H9.265s-2.832-.046-2.832 2.737v4.836s-.46 2.778 5.654 2.778zm2.844-1.635a.909.909 0 1 1 0-1.818.909.909 0 0 1 0 1.818z"
      />
    </svg>
  )
}

function JavaScriptIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden="true">
      <rect width="24" height="24" rx="2" fill="#F7DF1E" />
      <path
        fill="#323330"
        d="M6.672 19.07 8.1 18.2c.27.48.517.886.914.886.38 0 .624-.15.624-.732v-3.966h1.68v3.984c0 1.206-.709 1.757-1.742 1.757-1.033 0-1.551-.535-1.904-1.079zm5.04-.218 1.428-.87c.37.624.85 1.08 1.696 1.08.71 0 1.166-.357 1.166-.85 0-.588-.466-.798-1.25-1.14l-.43-.185c-1.238-.527-2.06-1.19-2.06-2.59 0-1.29.983-2.272 2.516-2.272 1.094 0 1.88.38 2.444 1.378l-1.376.883c-.296-.528-.614-.736-1.068-.736-.487 0-.797.31-.797.736 0 .515.31.724 1.025 1.044l.43.184c1.458.625 2.28 1.26 2.28 2.688 0 1.54-1.207 2.394-2.83 2.394-1.587 0-2.609-.755-3.12-1.744z"
      />
    </svg>
  )
}

function TypeScriptIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden="true">
      <rect width="24" height="24" rx="2" fill="#3178C6" />
      <path
        fill="#fff"
        d="M13.23 11.2H11.2V10h5.575v1.2h-2.03V18h-1.514zm-6.03 6.8v-1.22l.96-.034c.16-.007.284-.043.374-.11a.37.37 0 0 0 .14-.298v-4.97H7.245V10h4.88v1.168h-1.43v4.988c0 .497-.137.873-.41 1.128-.274.25-.663.416-1.167.497l-.916.219z"
      />
    </svg>
  )
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    id: 'python',
    label: 'Python',
    runtime: 'Python 3.11',
    icon: <PythonIcon />,
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    runtime: 'Node.js 20',
    icon: <JavaScriptIcon />,
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    runtime: 'TypeScript 5.x (tsx)',
    icon: <TypeScriptIcon />,
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export function LanguageSelectPage() {
  const session_id = useSessionStore((s) => s.session_id)
  const currentLanguage = useSessionStore((s) => s.language)
  const setLanguage = useSessionStore((s) => s.setLanguage)
  const navigate = useNavigate()

  const [selected, setSelected] = useState<Language | null>(currentLanguage)

  // Guard: no session means we haven't gone through /start yet
  if (!session_id) {
    return <Navigate to="/start" replace />
  }

  async function handleConfirm() {
    if (!selected) return
    // This is the final user gesture before the coding assessment starts.
    // Request document fullscreen here so browser chrome and the OS taskbar
    // remain hidden when the editor opens.
    if (!document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen?.() } catch { /* AssessPage offers re-entry */ }
    }
    setLanguage(selected)
    navigate('/assess', { replace: true })
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[color:var(--bg-canvas)] px-4 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-2xl">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-[color:var(--text-primary)]">
            Choose your language
          </h1>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            This choice is final - you cannot change it after you begin.
          </p>
        </div>

        {/* Language cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {LANGUAGE_OPTIONS.map((option) => {
            const isSelected = selected === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelected(option.id)}
                className={[
                  'group relative flex flex-col items-center gap-4 rounded-[10px] border-2 px-6 py-8',
                  'cursor-pointer transition-all duration-150 focus:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[color:var(--signal-violet)] focus-visible:ring-offset-2',
                  'focus-visible:ring-offset-[color:var(--bg-canvas)]',
                  isSelected
                    ? 'border-[color:var(--text-primary)] bg-[color:var(--bg-overlay)]'
                    : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] hover:border-[color:var(--border-strong)]',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={isSelected}
              >
                {/* Selected indicator - neutral: language choice is not a scored signal */}
                {isSelected && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--text-primary)]">
                    <svg
                      className="h-3 w-3 text-[color:var(--bg-canvas)]"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                )}

                <span className="rounded-lg bg-[color:var(--bg-inset)] p-2 transition-colors">
                  {option.icon}
                </span>

                <span className="text-center">
                  <span className="block text-lg font-semibold text-[color:var(--text-primary)]">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-[color:var(--text-muted)]">{option.runtime}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* Confirm button */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            disabled={!selected}
            onClick={handleConfirm}
            className={[
              'rounded-[8px] px-10 py-3 text-sm font-semibold transition-all',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--signal-violet)]',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-canvas)]',
              selected
                ? 'bg-[color:var(--text-primary)] text-[color:var(--bg-canvas)] hover:opacity-90'
                : 'cursor-not-allowed bg-[color:var(--bg-overlay)] text-[color:var(--text-muted)]',
            ].join(' ')}
          >
            Begin assessment →
          </button>
        </div>
      </div>
    </div>
  )
}
