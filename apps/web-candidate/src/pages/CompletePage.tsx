import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Logo, ThemeToggle } from '@platform/web-shared'
import { useSessionStore } from '../store/session'
import { submitFeedback, type CandidateFeedbackPayload } from '../api/client'

// Shown after submit / auto-expiry / exit. No scores - candidates never see AIU or results (CLAUDE.md).
type Status = 'submitted' | 'expired' | 'exited' | 'violation'

const COPY: Record<Status, { heading: string; body: string; ok: boolean }> = {
  submitted: {
    heading: 'Assessment submitted',
    body: 'Thank you for completing the assessment. Your work has been recorded. The hiring team will review your submission and follow up with next steps. You can safely close this tab.',
    ok: true,
  },
  expired: {
    heading: "Time's up - submitted automatically",
    body: 'Your time ran out and your work was submitted automatically. The hiring team will review it and follow up. You can safely close this tab.',
    ok: true,
  },
  violation: {
    heading: 'Submitted automatically - policy violation',
    body: 'Repeated proctoring policy violations triggered automatic submission. Your work has been recorded and the hiring team will review it. You can safely close this tab.',
    ok: true,
  },
  exited: {
    heading: 'You’ve exited the assessment',
    body: 'You have left the assessment. If this was a mistake, reopen your original invite link to continue - as long as your time has not run out.',
    ok: false,
  },
}

export function CompletePage() {
  const [params] = useSearchParams()
  const raw = params.get('status')
  const status: Status = raw === 'expired' || raw === 'exited' || raw === 'violation' ? raw : 'submitted'
  const { heading, body, ok } = COPY[status]
  const sessionId = useSessionStore((s) => s.session_id)
  const assessment = useSessionStore((s) => s.assessment)
  const assessmentName = assessment?.title ?? ''
  const showAiFeedback = assessment?.ai_assistant_mode !== 'DISABLED'
  const [ratings, setRatings] = useState({
    overall_experience: 5,
    instructions_clarity: 5,
    difficulty_relevance: 5,
    technical_performance: 5,
    coding_environment: 5,
    ai_assistant_usefulness: 5,
    proctoring_experience: 5,
  })
  const [aiAssistantUsage, setAiAssistantUsage] = useState<CandidateFeedbackPayload['ai_assistant_usage']>('DID_NOT_USE')
  const [comments, setComments] = useState('')
  const [taskWhereIssueOccurred, setTaskWhereIssueOccurred] = useState('')
  const [technicalIssueType, setTechnicalIssueType] = useState('')
  const [mayContact, setMayContact] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmitFeedback = useMemo(() => Boolean(sessionId) && status !== 'exited' && !saved, [sessionId, status, saved])

  function setRating(key: keyof typeof ratings, value: number) {
    setRatings((current) => ({ ...current, [key]: value }))
  }

  async function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionId) {
      useSessionStore.getState().reset()
      setSaved(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await submitFeedback(sessionId, {
        ...ratings,
        ai_assistant_usefulness: showAiFeedback ? ratings.ai_assistant_usefulness : 1,
        ai_assistant_usage: showAiFeedback ? aiAssistantUsage : 'WAS_NOT_AVAILABLE',
        assessment_name: assessmentName || undefined,
        task_where_issue_occurred: taskWhereIssueOccurred || undefined,
        technical_issue_type: technicalIssueType || undefined,
        may_contact: mayContact,
        comments: comments || undefined,
      })
      useSessionStore.getState().reset()
      setSaved(true)
    } catch {
      setError('Could not save feedback. Please try once more.')
    } finally {
      setSaving(false)
    }
  }

  const ratingQuestions: Array<{ key: keyof typeof ratings; label: string; help?: string; max?: number }> = [
    { key: 'overall_experience', label: 'Overall experience' },
    { key: 'instructions_clarity', label: 'Instructions and clarity' },
    { key: 'difficulty_relevance', label: 'Difficulty and relevance' },
    { key: 'technical_performance', label: 'Technical performance', help: '1 = many issues, 5 = smooth/no issues' },
    { key: 'coding_environment', label: 'Coding environment' },
    ...(showAiFeedback ? [{ key: 'ai_assistant_usefulness' as const, label: 'AI coding assistant' }] : []),
    { key: 'proctoring_experience', label: 'Proctoring experience' },
  ]

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-[color:var(--bg-canvas)] px-4 py-8 font-sans">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, var(--signal-violet), transparent)', opacity: 0.12, filter: 'blur(40px)' }}
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-3xl">
        <div className="mb-8 flex justify-center">
          <Logo size={34} />
        </div>

        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-6 shadow-xl">
          <div className="text-center">
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: ok ? 'var(--signal-green-dim)' : 'var(--bg-overlay)' }}
            >
              {ok ? (
                <svg className="h-6 w-6 text-[color:var(--signal-green)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="h-6 w-6 text-[color:var(--text-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                </svg>
              )}
            </div>

            <h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">{saved ? 'Thank you for your feedback' : heading}</h1>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[color:var(--text-secondary)]">
              {saved ? 'Your assessment is complete. You can safely close this tab.' : body.replace(' You can safely close this tab.', '')}
            </p>
          </div>

          {canSubmitFeedback && (
            <form onSubmit={handleFeedbackSubmit} className="mt-6 space-y-5 text-left">
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] px-4 py-3 text-sm text-[color:var(--text-secondary)]">
                Your feedback is confidential and will not affect your assessment score or hiring decision.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {ratingQuestions.map((q) => (
                  <label key={q.key} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-canvas)] p-3">
                    <span className="block text-sm font-medium text-[color:var(--text-primary)]">{q.label}</span>
                    {q.help && <span className="mt-0.5 block text-xs text-[color:var(--text-muted)]">{q.help}</span>}
                    <select
                      value={ratings[q.key]}
                      onChange={(event) => setRating(q.key, Number(event.target.value))}
                      className="mt-2 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)]"
                    >
                      {Array.from({ length: (q.max ?? 5) + 1 }, (_, i) => i)
                        .filter((n) => q.max === 10 || n > 0)
                        .map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {showAiFeedback && (
                  <label className="text-sm text-[color:var(--text-secondary)]">
                    AI assistant follow-up
                    <select value={aiAssistantUsage} onChange={(e) => setAiAssistantUsage(e.target.value as CandidateFeedbackPayload['ai_assistant_usage'])} className="mt-1 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)]">
                      <option value="VERY_USEFUL">Very useful</option>
                      <option value="SOMEWHAT_USEFUL">Somewhat useful</option>
                      <option value="NOT_USEFUL">Not useful</option>
                      <option value="DID_NOT_USE">Did not use it</option>
                      <option value="WAS_NOT_AVAILABLE">Was not available</option>
                    </select>
                  </label>
                )}
                <label className="text-sm text-[color:var(--text-secondary)]">
                  Type of technical issue (optional)
                  <input value={technicalIssueType} onChange={(e) => setTechnicalIssueType(e.target.value)} className="mt-1 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)]" placeholder="Loading, camera, lost code..." />
                </label>
                <label className="text-sm text-[color:var(--text-secondary)]">
                  Task where issue occurred (optional)
                  <input value={taskWhereIssueOccurred} onChange={(e) => setTaskWhereIssueOccurred(e.target.value)} className="mt-1 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)]" placeholder="Task 1, problem 2..." />
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm text-[color:var(--text-secondary)]">
                  <input type="checkbox" checked={mayContact} onChange={(e) => setMayContact(e.target.checked)} />
                  Permission to contact me about this feedback
                </label>
              </div>

              <label className="block text-sm text-[color:var(--text-secondary)]">
                Open feedback (optional)
                <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)]" placeholder="What worked well, and what should we improve?" />
              </label>

              {error && <p className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-3 py-2 text-sm text-[color:var(--status-fail)]">{error}</p>}
              <button type="submit" disabled={saving} className="w-full rounded-lg bg-[color:var(--signal-green)] px-4 py-3 text-sm font-semibold text-black disabled:opacity-60">
                {saving ? 'Saving feedback...' : 'Submit feedback and finish'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-10 text-xs text-[color:var(--text-muted)]">Powered by apexcoder.io</p>
      </div>
    </div>
  )
}
