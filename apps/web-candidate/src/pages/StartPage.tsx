import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ApiException, startSession } from '../api/client'
import { useSessionStore } from '../store/session'
import { Logo, ThemeToggle } from '@platform/web-shared'

type PageState =
  | { phase: 'form' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }

// Error messages visible to candidates - never expose internal codes
const ERROR_MESSAGES: Record<string, string> = {
  TOKEN_EXPIRED: 'This assessment link has expired. Please contact the hiring team.',
  FORBIDDEN: "That email doesn't match this invite. Please use the email your recruiter sent it to, or contact the hiring team.",
}

const FALLBACK_ERROR =
  'Unable to start the assessment. Please check your link or contact the hiring team.'

const inputCls =
  'w-full rounded-[8px] border border-[color:var(--border-strong)] bg-[color:var(--bg-inset)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--signal-violet)] focus:shadow-[0_0_0_3px_rgba(139,123,255,0.22)]'

export function StartPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const setSession = useSessionStore((s) => s.setSession)

  const [state, setState] = useState<PageState>({ phase: 'form' })
  const [candidateName, setCandidateName] = useState('')
  const [candidateEmail, setCandidateEmail] = useState('')
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const token = searchParams.get('token')

    if (!token) {
      setState({ phase: 'error', message: 'No invite token found in the URL.' })
      return
    }
    setInviteToken(token)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps - runs once on mount

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteToken || !candidateName.trim() || !candidateEmail.trim() || startedRef.current) return

    startedRef.current = true
    setState({ phase: 'loading' })

    // Enter full screen from within this click gesture - browsers only allow
    // requestFullscreen in response to a user gesture, so this is our one shot.
    // Fullscreen persists across the SPA route changes into the editor page.
    try {
      await document.documentElement.requestFullscreen?.()
    } catch {
      // Best effort - some browsers/permissions block it; the assessment page
      // offers a re-enter affordance.
    }

    try {
      const res = await startSession(inviteToken, candidateName.trim(), candidateEmail.trim())
      setSession({
        session_id: res.data.session_id,
        token: res.data.access_token,
        kind: res.data.kind ?? 'CODING',
        problems: res.data.problems ?? [],
        problem: res.data.problem,
        project: res.data.project ?? null,
        assessment: res.data.assessment,
        current_code: res.data.current_code,
        time_remaining: res.data.time_remaining,
      })
      navigate('/system-check', { replace: true })
    } catch (err: unknown) {
      if (err instanceof ApiException && err.code === 'SESSION_EXPIRED') {
        const submitted = err.message.toLowerCase().includes('submitted')
        navigate(`/complete?status=${submitted ? 'submitted' : 'expired'}`, { replace: true })
        return
      }
      const message =
        err instanceof ApiException
          ? (ERROR_MESSAGES[err.code] ?? err.message ?? FALLBACK_ERROR)
          : 'Network error. Please check your connection and refresh.'
      startedRef.current = false
      setState({ phase: 'error', message })
    }
  }

  return (
    <div className="relative flex h-full min-h-screen items-center justify-center bg-[color:var(--bg-canvas)] px-4 font-sans">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md text-center">
        {/* Logo / brand mark */}
        <div className="mb-8 flex justify-center">
          <Logo size={40} />
        </div>

        {state.phase === 'form' ? (
          <>
            <h1 className="mb-3 text-2xl font-semibold text-[color:var(--text-primary)]">
              Start your assessment
            </h1>
            <p className="mb-8 text-sm text-[color:var(--text-muted)]">
              Enter your details before continuing.
            </p>
            <p className="mb-6 text-sm leading-relaxed text-[color:var(--text-muted)]">
              If you accidentally exit during the assessment, your current work and remaining time are saved. Rejoin immediately using the same assessment link to continue the same attempt.
            </p>

            <form onSubmit={handleStart} className="space-y-4 text-left">
              <div>
                <label htmlFor="candidate-name" className="mb-1.5 block text-xs font-medium text-[color:var(--text-muted)]">
                  Full name
                </label>
                <input
                  id="candidate-name"
                  type="text"
                  required
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  className={inputCls}
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label htmlFor="candidate-email" className="mb-1.5 block text-xs font-medium text-[color:var(--text-muted)]">
                  Email address
                </label>
                <input
                  id="candidate-email"
                  type="email"
                  required
                  value={candidateEmail}
                  onChange={(e) => setCandidateEmail(e.target.value)}
                  className={inputCls}
                  placeholder="jane@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={!candidateName.trim() || !candidateEmail.trim()}
                className="w-full rounded-[8px] bg-[color:var(--text-primary)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bg-canvas)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
              </button>
            </form>
          </>
        ) : state.phase === 'loading' ? (
          <>
            <h1 className="mb-3 text-2xl font-semibold text-[color:var(--text-primary)]">
              Starting your assessment…
            </h1>
            <p className="text-sm text-[color:var(--text-muted)]">Please wait while we set things up.</p>
            <div className="mt-8 flex justify-center">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[color:var(--signal-violet)] border-t-transparent" />
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--status-fail-dim)]">
                <svg
                  className="h-5 w-5 text-[color:var(--status-fail)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
            </div>
            <h1 className="mb-3 text-xl font-semibold text-[color:var(--text-primary)]">
              Unable to start assessment
            </h1>
            <p className="text-sm leading-relaxed text-[color:var(--text-secondary)]">{state.message}</p>
          </>
        )}
      </div>
    </div>
  )
}
