import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import {
  getLeaderboard,
  getAssessment,
  getCandidateReport,
  getInteractionLog,
  downloadPdfReport,
  downloadSubmission,
  ApiException,
  type LeaderboardEntry,
} from '../api/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOP_X_OPTIONS = [
  { label: 'Top 10', value: 10 },
  { label: 'Top 25', value: 25 },
  { label: 'Top 50', value: 50 },
  { label: 'All', value: 0 },
]

function fmtScore(n: number): string {
  return n.toFixed(1)
}

function fmtScoreOutOf100(n: number): string {
  return `${fmtScore(n)} /100`
}

const PROJECT_CRITERION_DESCRIPTIONS: Record<string, string> = {
  acceptance_and_functional_correctness: 'Checks whether the final submission satisfies the task behavior, Done when requirements, and relevant edge cases.',
  verification_and_regression_safety: 'Checks evidence of testing, failure investigation, preserved behavior, and regression-safe changes.',
  technical_reasoning_and_ai_direction: 'Checks how clearly the candidate decomposed the task, gave AI useful context, reviewed output, and corrected mistakes.',
  independent_engineering_contribution: 'Checks meaningful candidate review, edits, debugging, and decisions beyond directly accepting AI output.',
  architecture_and_migration_quality: 'Checks fit with existing architecture, maintainability, data/config safety, sequencing, and root-cause handling.',
  scope_and_code_quality: 'Checks focused, readable, reviewable changes without hard-coded shortcuts, dead code, churn, or unrelated edits.',
}

function projectCriterionDescription(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return PROJECT_CRITERION_DESCRIPTIONS[key] ?? 'Checks the saved evaluator evidence for this configured project criterion.'
}

function shortProjectEvaluationSummary(task: {
  final_score: number
  base_score: number
  applied_caps: { reason: string; cap: number }[]
  missing_requirements: string[]
  rationale?: string | null
  evidence_references: string[]
}): string[] {
  const bullets: string[] = []
  const rationale = (task.rationale ?? '').trim()
  const firstSentence = rationale.match(/^[^.!?]+[.!?]/)?.[0]?.trim()

  if (firstSentence) bullets.push(firstSentence)
  if (task.applied_caps.length > 0) {
    bullets.push(`Score was capped for: ${task.applied_caps.map((cap) => cap.reason).join('; ')}.`)
  } else if (task.final_score === task.base_score) {
    bullets.push('No score cap changed the task score.')
  }
  if (task.missing_requirements.length > 0) {
    bullets.push(`Missing requirement: ${task.missing_requirements.slice(0, 2).join('; ')}.`)
  }
  if (task.evidence_references.length > 0) {
    bullets.push(`Evidence reviewed: ${task.evidence_references.slice(0, 2).join('; ')}.`)
  }
  bullets.push(`Final task result: ${fmtScoreOutOf100(task.final_score)}.`)

  return bullets.slice(0, 5)
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

function fmtOptionalDuration(seconds: number | null): string {
  return seconds == null ? 'Not available' : fmtDuration(seconds)
}

function metricLabel(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

const TECHNICAL_EVALUATION_METRICS = [
  'correctness',
  'efficiency',
  'robustness',
  'code_quality',
] as const

function technicalEvaluationScores(scores: Array<{ metric: string; score: number; weight: number }>) {
  return TECHNICAL_EVALUATION_METRICS.map((metric) => {
    const score = scores.find((item) => item.metric === metric)
    return {
      metric,
      score: score?.score ?? 0,
      weight: 25,
    }
  })
}

function feedbackLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function aiAssistantUsageLabel(value: string | null): string {
  if (!value) return 'Not answered'
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function getRankStyle(rank: number): { row: string; badge: string } {
  if (rank === 1)
    return {
      row: 'bg-[color:var(--status-warn-dim)]',
      badge: 'text-[color:var(--status-warn)] font-bold',
    }
  if (rank === 2)
    return {
      row: 'bg-[color:var(--bg-overlay)]',
      badge: 'text-[color:var(--text-secondary)] font-semibold',
    }
  if (rank === 3)
    return {
      row: 'bg-[color:var(--bg-canvas)]',
      badge: 'text-orange-600 font-semibold',
    }
  return { row: '', badge: 'text-[color:var(--text-muted)]' }
}

function exportCSV(entries: LeaderboardEntry[], filename: string, isProject: boolean): void {
  const header = isProject
    ? 'Rank,Candidate Name,Total Score,Project Score,Technical Evaluation Score,Submitted At\n'
    : 'Rank,Candidate Name,Total Score,Technical Evaluation Score,Submitted At\n'
  const rows = entries
    .map((e) => {
      const candidate = `"${e.candidate_name.replace(/"/g, '""')}"`
      return isProject
        ? `${e.rank},${candidate},${e.total_score.toFixed(1)},${e.code_correctness_score.toFixed(1)},${e.aiu_total_score.toFixed(1)},${e.submitted_at}`
        : `${e.rank},${candidate},${e.total_score.toFixed(1)},${e.aiu_total_score.toFixed(1)},${e.submitted_at}`
    })
    .join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Candidate Detail Panel ───────────────────────────────────────────────────

function CandidateDetailPanel({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) {
  const [showLog, setShowLog] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [scoringPollExpired, setScoringPollExpired] = useState(false)

  const { data: reportData, isLoading: loadingReport, error: reportError } = useQuery({
    queryKey: ['candidate-report', sessionId],
    queryFn: () => getCandidateReport(sessionId),
    retry: false,
    // Project scoring completes asynchronously. Keep the open panel current and
    // replace the progress state as soon as the persisted criteria are ready.
    refetchInterval: (query) => {
      if (scoringPollExpired) return false
      if (query.state.data) return false
      const error = query.state.error
      if (error instanceof ApiException && error.code !== 'SCORE_MISSING') return false
      return 1_500
    },
  })

  const { data: logData, isLoading: loadingLog } = useQuery({
    queryKey: ['interaction-log', sessionId],
    queryFn: () => getInteractionLog(sessionId),
    enabled: showLog,
  })

  const { mutate: triggerDownload, isPending: downloading } = useMutation({
    mutationFn: () => downloadPdfReport(sessionId),
    onMutate: () => setDownloadError(null),
    onError: (err) => {
      setDownloadError(err instanceof ApiException ? err.message : 'Download failed')
    },
  })
  const { mutate: triggerSubmissionDownload, isPending: downloadingSubmission } = useMutation({
    mutationFn: () => downloadSubmission(sessionId),
    onMutate: () => setDownloadError(null),
    onError: (err) => {
      setDownloadError(err instanceof ApiException ? err.message : 'Download failed')
    },
  })

  const detail = reportData?.data
  const scoringPending = reportError instanceof ApiException && reportError.code === 'SCORE_MISSING' && !scoringPollExpired

  useEffect(() => {
    setScoringPollExpired(false)
    const timer = window.setTimeout(() => setScoringPollExpired(true), 15_000)
    return () => window.clearTimeout(timer)
  }, [sessionId])

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Slide-in panel */}
      <div className="flex w-[500px] flex-shrink-0 flex-col border-l border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Candidate Report</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-overlay)] hover:text-[color:var(--text-secondary)]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loadingReport && !reportError ? (
            <div className="flex items-center justify-center py-16 text-sm text-[color:var(--text-muted)]">
              Loading…
            </div>
          ) : scoringPending ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <span
                className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[color:var(--signal-violet)] border-t-transparent"
                aria-hidden="true"
              />
              <p className="text-sm text-[color:var(--text-muted)]">Scoring in progress…</p>
            </div>
          ) : reportError ? (
            <div className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-3 py-2.5 text-xs text-[color:var(--status-fail)]">
              {reportError instanceof ApiException ? reportError.message : 'Failed to load candidate report.'}
            </div>
          ) : !detail ? (
            <div className="flex items-center justify-center py-16 text-sm text-[color:var(--text-muted)]">
              Candidate report is not available yet.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Candidate info */}
              <div>
                <p className="text-lg font-semibold text-[color:var(--text-primary)]">{detail.candidate_name}</p>
                {detail.candidate_email && (
                  <p className="text-xs text-[color:var(--text-muted)]">{detail.candidate_email}</p>
                )}
                <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
                  {detail.assessment_title} ·{' '}
                  {detail.language.charAt(0) + detail.language.slice(1).toLowerCase()}
                </p>
              </div>
              <Link to={`/proctoring/${sessionId}`} className="inline-flex border border-[color:var(--border-strong)] px-3 py-2 text-sm font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--bg-overlay)]">
                Review proctoring evidence
              </Link>

              {/* Total score - prominent */}
              <div className="rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] p-6 text-center">
                <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">
                  Total Score
                </p>
                <p className="mt-2 text-6xl font-bold text-[color:var(--text-primary)]">
                  {fmtScore(detail.total_score)}
                  <span className="ml-2 align-baseline text-2xl font-semibold text-[color:var(--text-muted)]">/100</span>
                </p>
              </div>

              {/* Project quality */}
              {detail.kind === 'PROJECT' && (
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Project Quality
                  </p>
                  <p className="text-xl font-bold text-[color:var(--text-primary)]">
                    {fmtScoreOutOf100(detail.code_correctness_score)}
                  </p>
                </div>
                <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full bg-[color:var(--bg-overlay)]">
                  <div
                    className="h-full rounded-full bg-[color:var(--status-link)] transition-all"
                    style={{ width: `${detail.code_correctness_score}%` }}
                  />
                </div>
                {detail.hidden_tests_passed != null && detail.hidden_tests_total != null && (
                  <p className="text-xs text-[color:var(--text-muted)]">
                    {detail.hidden_tests_passed} / {detail.hidden_tests_total} hidden tests passed
                  </p>
                )}
              </div>
              )}

              {/* Technical evaluation breakdown */}
              {detail.kind !== 'PROJECT' && detail.aiu_scores.length > 0 && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                      Technical Evaluation
                    </p>
                    <p className="text-xl font-bold text-[color:var(--text-primary)]">
                      {fmtScoreOutOf100(detail.aiu_total_score)}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {technicalEvaluationScores(detail.aiu_scores).map((aiu) => (
                      <div key={aiu.metric}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-[color:var(--text-secondary)]">{metricLabel(aiu.metric)}</span>
                          <span className="text-[color:var(--text-secondary)]">
                            {fmtScoreOutOf100(aiu.score)}{' '}
                            <span className="text-[color:var(--text-secondary)]">({aiu.weight}%)</span>
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--bg-overlay)]">
                          <div
                            className="h-full rounded-full bg-[color:var(--signal-violet)] transition-all"
                            style={{ width: `${aiu.score}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scoring criteria breakdown (PROJECT) */}
              {detail.project_scores && detail.project_scores.length > 0 && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Scoring Criteria
                  </p>
                  <div className="space-y-3">
                    {detail.project_scores.map((c) => (
                      <div key={c.name}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-[color:var(--text-secondary)]">{c.name}</span>
                          <span className="text-[color:var(--text-secondary)]">{fmtScoreOutOf100(c.score)} <span className="text-[color:var(--text-muted)]">({c.weight}%)</span></span>
                        </div>
                        <p className="mb-1.5 text-[11px] leading-4 text-[color:var(--text-muted)]">
                          {projectCriterionDescription(c.name)}
                        </p>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--bg-overlay)]">
                          <div
                            className="h-full rounded-full bg-[color:var(--signal-violet)] transition-all"
                            style={{ width: `${c.score}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.project_evaluation && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Project Evaluation</p>
                    {detail.project_evaluation.manual_review_required && (
                      <span className="rounded bg-[color:var(--status-warn-dim)] px-2 py-1 text-xs text-[color:var(--status-warn)]">Manual review recommended</span>
                    )}
                  </div>
                  <p className="mb-3 text-xs text-[color:var(--text-muted)]">AI evidence: {detail.project_evaluation.assistant_evidence_state.replace(/_/g, ' ')}</p>
                  {detail.project_evaluation.manual_review_reasons.length > 0 && (
                    <ul className="mb-3 list-disc space-y-1 pl-4 text-xs text-[color:var(--status-warn)]">
                      {detail.project_evaluation.manual_review_reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                  <div className="space-y-3">
                    {detail.project_evaluation.tasks.map((task, index) => (
                      <div key={task.task_id || index} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-[color:var(--text-primary)]">Task {index + 1} · {task.difficulty}</span>
                          <span className="font-semibold text-[color:var(--text-primary)]">{fmtScoreOutOf100(task.final_score)} <span className="font-normal text-[color:var(--text-muted)]">(base {fmtScoreOutOf100(task.base_score)})</span></span>
                        </div>
                        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-[color:var(--text-secondary)]">
                          {shortProjectEvaluationSummary(task).map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.feedback && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Candidate Feedback</p>
                    <p className="text-sm font-semibold text-[color:var(--text-primary)]">{detail.feedback.average_rating.toFixed(1)} /5</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ['overall_experience', detail.feedback.overall_experience],
                      ['instructions_clarity', detail.feedback.instructions_clarity],
                      ['difficulty_relevance', detail.feedback.difficulty_relevance],
                      ['platform_usability', detail.feedback.platform_usability],
                      ['technical_performance', detail.feedback.technical_performance],
                      ['coding_environment', detail.feedback.coding_environment],
                      ['ai_assistant_usefulness', detail.feedback.ai_assistant_usefulness],
                      ['proctoring_experience', detail.feedback.proctoring_experience],
                      ['fairness', detail.feedback.fairness],
                    ].map(([key, value]) => (
                      <div key={String(key)} className="rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] px-2 py-1.5">
                        <span className="block text-[color:var(--text-muted)]">{feedbackLabel(String(key))}</span>
                        <span className="font-semibold text-[color:var(--text-primary)]">{value} /5</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-[color:var(--text-secondary)]">
                    <p>AI assistant: {aiAssistantUsageLabel(detail.feedback.ai_assistant_usage)}</p>
                    {detail.feedback.technical_issue_type && <p>Issue type: {detail.feedback.technical_issue_type}</p>}
                    {detail.feedback.task_where_issue_occurred && <p>Task: {detail.feedback.task_where_issue_occurred}</p>}
                    {detail.feedback.comments && <p className="whitespace-pre-wrap rounded bg-[color:var(--bg-overlay)] p-2">{detail.feedback.comments}</p>}
                    <p>Contact permission: {detail.feedback.may_contact ? 'Yes' : 'No'}</p>
                  </div>
                </div>
              )}

              {/* Session stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-3 text-center">
                  <p className="text-xs text-[color:var(--text-muted)]">Time Taken</p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
                    {fmtOptionalDuration(detail.time_taken_seconds)}
                  </p>
                </div>
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-3 text-center">
                  <p className="text-xs text-[color:var(--text-muted)]">AI Interactions</p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
                    {detail.interaction_count} turns
                  </p>
                </div>
              </div>

              {/* Download error */}
              {downloadError && (
                <div className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-3 py-2.5 text-xs text-[color:var(--status-fail)]">
                  {downloadError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => triggerDownload()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[color:var(--text-primary)] px-3 py-2.5 text-sm font-medium text-[color:var(--bg-canvas)] hover:opacity-90 disabled:opacity-60"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  {downloading ? 'Downloading…' : 'Download PDF'}
                </button>
                <button
                  type="button"
                  disabled={downloadingSubmission}
                  onClick={() => triggerSubmissionDownload()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[color:var(--border-strong)] px-3 py-2.5 text-sm font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-overlay)] disabled:opacity-60"
                >
                  {downloadingSubmission ? 'Downloading...' : 'Download Code'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLog((v) => !v)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[color:var(--border-strong)] px-3 py-2.5 text-sm font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-overlay)]"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
                    />
                  </svg>
                  {showLog ? 'Hide Log' : 'View Log'}
                </button>
              </div>

              {/* Interaction log */}
              {showLog && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-canvas)] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    AI Interaction Log
                  </p>
                  {loadingLog ? (
                    <p className="text-xs text-[color:var(--text-secondary)]">Loading…</p>
                  ) : !logData?.data.length ? (
                    <p className="text-xs text-[color:var(--text-secondary)]">No interactions recorded.</p>
                  ) : (
                    <div className="space-y-4">
                      {logData.data.map((turn) => (
                        <div key={turn.turn_number}>
                          <div className="mb-1.5 rounded-lg bg-[color:var(--bg-overlay)] p-3">
                            <p className="mb-1 text-xs font-medium text-[color:var(--status-link)]">
                              Turn {turn.turn_number} - Prompt
                            </p>
                            <p className="whitespace-pre-wrap text-xs text-[color:var(--text-secondary)]">
                              {turn.prompt_text}
                            </p>
                          </div>
                          <div className="rounded-lg bg-[color:var(--bg-overlay)] p-3">
                            <p className="mb-1 text-xs font-medium text-[color:var(--signal-violet)]">Response</p>
                            <p className="whitespace-pre-wrap text-xs text-[color:var(--text-secondary)]">
                              {turn.response_text}
                            </p>
                          </div>
                          <p className="mt-1 text-right text-xs text-[color:var(--text-secondary)]">
                            {new Date(turn.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function LeaderboardPage() {
  const { id } = useParams<{ id: string }>()
  const [topX, setTopX] = useState(10)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  const { data: assessmentData } = useQuery({
    queryKey: ['assessment', id],
    queryFn: () => getAssessment(id!),
    enabled: !!id,
  })

  const { data: leaderboardData, isLoading } = useQuery({
    queryKey: ['leaderboard', id, topX],
    queryFn: () => getLeaderboard(id!, topX === 0 ? 100 : topX),
    enabled: !!id,
    refetchInterval: 30_000,
  })

  const assessment = assessmentData?.data
  const isProject = assessment?.kind === 'PROJECT'
  const allEntries = leaderboardData?.data ?? []
  const feedbackSummary = leaderboardData?.feedback_summary
  const mixedRubricVersions = leaderboardData?.mixed_rubric_versions ?? false
  const rubricVersions = leaderboardData?.rubric_versions ?? []
  const displayedEntries = topX === 0 ? allEntries : allEntries.slice(0, topX)

  function handleExportCSV() {
    const title = assessment?.title ?? id ?? 'leaderboard'
    exportCSV(
      displayedEntries,
      `leaderboard-${title.replace(/\s+/g, '-').toLowerCase()}.csv`,
      isProject,
    )
  }

  return (
    <Layout>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          to={`/assessments/${id}`}
          className="mb-2 inline-block text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]"
        >
          ← {assessment?.title ?? 'Assessment'}
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[color:var(--text-primary)]">Leaderboard</h1>
          <div className="flex items-center gap-3">
            <select
              value={topX}
              onChange={(e) => setTopX(Number(e.target.value))}
              className="rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-secondary)] focus:border-[color:var(--signal-violet)] focus:outline-none"
            >
              {TOP_X_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={displayedEntries.length === 0}
              className="flex items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-overlay)] disabled:opacity-50"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      {feedbackSummary && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
            <p className="text-xs uppercase tracking-wider text-[color:var(--text-muted)]">Feedback responses</p>
            <p className="mt-2 text-2xl font-bold text-[color:var(--text-primary)]">{feedbackSummary.responses}</p>
          </div>
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
            <p className="text-xs uppercase tracking-wider text-[color:var(--text-muted)]">Average rating</p>
            <p className="mt-2 text-2xl font-bold text-[color:var(--text-primary)]">{feedbackSummary.average_rating == null ? '-' : `${feedbackSummary.average_rating.toFixed(1)} /5`}</p>
          </div>
        </div>
      )}
      {mixedRubricVersions && !isProject && (
        <div className="mb-5 rounded-xl border border-[color:var(--status-warn)] bg-[color:var(--status-warn-dim)] px-4 py-3 text-sm text-[color:var(--status-warn)]">
          This leaderboard includes multiple technical evaluation rubrics: {rubricVersions.join(', ')}. Compare total scores with care.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)]">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-[color:var(--text-muted)]">Loading leaderboard…</div>
        ) : displayedEntries.length === 0 ? (
          <div className="py-16 text-center text-sm text-[color:var(--text-muted)]">
            No candidates have submitted yet.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[color:var(--border-subtle)]">
                <th className="px-5 py-3 text-left text-xs font-medium text-[color:var(--text-secondary)]">Rank</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[color:var(--text-secondary)]">Candidate</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-[color:var(--text-secondary)]">Total (/100)</th>
                {isProject && (
                  <th className="px-5 py-3 text-right text-xs font-medium text-[color:var(--text-secondary)]">Project (/100)</th>
                )}
                {!isProject && (
                  <th className="px-5 py-3 text-right text-xs font-medium text-[color:var(--text-secondary)]">Technical Evaluation</th>
                )}
                <th className="px-5 py-3 text-right text-xs font-medium text-[color:var(--text-secondary)]">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedEntries.map((entry) => {
                const style = getRankStyle(entry.rank)
                return (
                  <tr
                    key={entry.session_id}
                    className={`cursor-pointer border-b border-[color:var(--border-subtle)] last:border-0 transition-colors hover:bg-[color:var(--bg-canvas)] ${style.row}`}
                    onClick={() => setSelectedSession(entry.session_id)}
                  >
                    <td className="px-5 py-4">
                      <span className={`text-sm ${style.badge}`}>#{entry.rank}</span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-[color:var(--text-primary)]">{entry.candidate_name}</p>
                      {entry.candidate_email && (
                        <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{entry.candidate_email}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-semibold text-[color:var(--text-primary)]">
                        {fmtScoreOutOf100(entry.total_score)}
                      </span>
                    </td>
                    {isProject && (
                      <td className="px-5 py-4 text-right text-sm text-[color:var(--text-secondary)]">
                        {fmtScoreOutOf100(entry.code_correctness_score)}
                      </td>
                    )}
                    {!isProject && (
                      <td className="px-5 py-4 text-right text-sm text-[color:var(--text-secondary)]">
                        {fmtScoreOutOf100(entry.aiu_total_score)}
                      </td>
                    )}
                    <td className="px-5 py-4 text-right text-xs text-[color:var(--text-muted)]">
                      {new Date(entry.submitted_at).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Candidate detail panel ─────────────────────────────────── */}
      {selectedSession && (
        <CandidateDetailPanel
          sessionId={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </Layout>
  )
}
