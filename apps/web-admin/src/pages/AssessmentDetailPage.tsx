import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { CANDIDATE_URL } from '@platform/web-shared'
import { Layout } from '../components/Layout'
import { StatusBadge, InviteStatusBadge } from '../components/StatusBadge'
import { AddProblemPanel, ProblemBankPanel, LibraryProblemPanel } from '../components/ProblemForm'
import { AddTaskPanel, TaskBankPanel } from '../components/TaskForm'
import {
  getAssessment,
  listInviteTokens,
  generateInviteToken,
  getSystemConfig,
  updateAssessment,
  type InviteToken,
  type ProblemSummary,
  type AssessmentSummary,
} from '../api/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds the candidate-facing invite URL from the raw token UUID. */
function buildInviteUrl(token: string): string {
  const configuredCandidateUrl = CANDIDATE_URL.replace(/\/+$/, '')

  try {
    const currentUrl = new URL(window.location.href)
    const candidateUrl = new URL(configuredCandidateUrl)
    const usesDefaultLocalCandidate =
      candidateUrl.hostname === 'localhost' && candidateUrl.port === '3000'

    // If the admin UI is opened via 127.0.0.1 or a LAN host, localhost links can
    // point candidates at the wrong machine. Mirror the current host in dev.
    if (usesDefaultLocalCandidate && currentUrl.hostname !== 'localhost') {
      candidateUrl.protocol = currentUrl.protocol
      candidateUrl.hostname = currentUrl.hostname
      candidateUrl.port = '3000'
    }

    candidateUrl.pathname = '/start'
    candidateUrl.search = ''
    candidateUrl.searchParams.set('token', token)
    return candidateUrl.toString()
  } catch {
    return `${configuredCandidateUrl}/start?token=${encodeURIComponent(token)}`
  }
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for browsers without Clipboard API
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const AI_ASSISTANT_MODE_LABELS: Record<string, string> = {
  AGENTIC: 'Agentic',
  NON_AGENTIC: 'Non-Agentic',
  DISABLED: 'Disabled',
}

function ConfigRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[color:var(--border-subtle)] py-2.5 text-sm last:border-0">
      <span className="text-[color:var(--text-muted)]">{label}</span>
      <span className="min-w-0 break-words text-left font-medium text-[color:var(--text-primary)]">{value}</span>
    </div>
  )
}

function ProblemCard({ problem }: { problem: ProblemSummary }) {
  const [open, setOpen] = useState(false)
  const visibleCount = problem.test_cases?.filter((tc) => !tc.is_hidden).length ?? 0
  const hiddenCount = problem.test_cases?.filter((tc) => tc.is_hidden).length ?? 0

  return (
    <div className="rounded-lg border border-[color:var(--border-subtle)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-[color:var(--bg-raised)] px-4 py-3 text-left hover:bg-[color:var(--bg-overlay)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
            problem.difficulty === 'EASY' ? 'bg-[color:var(--signal-green-dim)] text-[color:var(--signal-green)]' :
            problem.difficulty === 'MEDIUM' ? 'bg-[color:var(--status-warn-dim)] text-[color:var(--status-warn)]' :
            'bg-[color:var(--status-fail-dim)] text-[color:var(--status-fail)]'
          }`}>
            {problem.difficulty.charAt(0) + problem.difficulty.slice(1).toLowerCase()}
          </span>
          <span className="text-sm font-medium text-[color:var(--text-primary)]">{problem.title}</span>
        </div>
        <span className="text-xs text-[color:var(--text-muted)]">
          {visibleCount} visible · {hiddenCount} hidden
          <span className="ml-2">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-canvas)] px-4 py-4">
          <div className="prose prose-sm max-w-none mb-4 text-[color:var(--text-secondary)]">
            <ReactMarkdown>{problem.description}</ReactMarkdown>
          </div>
          {problem.test_cases && problem.test_cases.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[color:var(--text-muted)] uppercase tracking-wider">Test Cases</p>
              {problem.test_cases.map((tc, i) => (
                <div key={tc.id} className="rounded border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-[color:var(--text-muted)]">Test {i + 1}</span>
                    {tc.is_hidden && (
                      <span className="rounded-full bg-[color:var(--status-warn-dim)] px-2 py-0.5 text-xs text-[color:var(--status-warn)]">
                        Hidden
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div>
                      <p className="mb-1 text-[color:var(--text-secondary)]">Input</p>
                      <pre className="whitespace-pre-wrap text-[color:var(--text-secondary)]">{tc.input || '(empty)'}</pre>
                    </div>
                    <div>
                      <p className="mb-1 text-[color:var(--text-secondary)]">Expected</p>
                      <pre className="whitespace-pre-wrap text-[color:var(--text-secondary)]">{tc.expected}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InviteTokenRow({
  token,
  onCopy,
}: {
  token: InviteToken
  onCopy: (url: string) => void
}) {
  const url = buildInviteUrl(token.token)

  return (
    <tr className="border-b border-[color:var(--border-subtle)] last:border-0">
      <td className="px-4 py-3">
        <p className="text-sm text-[color:var(--text-primary)]">{token.candidate_name}</p>
        {token.candidate_email && (
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{token.candidate_email}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <InviteStatusBadge status={token.status} />
      </td>
      <td className="px-4 py-3 text-xs text-[color:var(--text-muted)]">
        {new Date(token.created_at).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-xs text-[color:var(--text-muted)]">
        Expires {new Date(token.expires_at).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        {token.status === 'active' ? (
          <button
            type="button"
            onClick={() => onCopy(url)}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-[color:var(--status-link)] hover:bg-[color:var(--bg-overlay)] hover:text-[color:var(--status-link)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586" />
            </svg>
            Copy link
          </button>
        ) : (
          <span className="text-xs text-[color:var(--text-secondary)]">-</span>
        )}
      </td>
    </tr>
  )
}

// ─── Project details (PROJECT kind) ──────────────────────────────────────────
// Split into head/foot around the Tasks section so the parent can render an
// actionable "Add Task" panel between them (mirrors the CODING Problems block,
// which lives directly in the parent rather than a read-only sub-component).

function ProjectDetailsHead({ assessment }: { assessment: AssessmentSummary }) {
  const allowedModels = assessment.allowed_models ?? []
  const connectionDetails = assessment.connection_details ?? []
  const submissionFiles = assessment.submission_files ?? []
  const referenceFiles = assessment.reference_files ?? []
  const scoringCriteria = assessment.project_scoring_criteria ?? []
  const formatBytes = (n: number) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
  const panelCls = 'rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-5'
  const headCls = 'mb-4 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]'

  return (
    <>
      {/* Provided template & models */}
      {(assessment.template_info || allowedModels.length > 0) && (
        <div className={panelCls}>
          <h2 className={headCls}>Provided Template & Models</h2>
          {assessment.template_info && (
            <div className="prose prose-sm mb-4 max-w-none text-[color:var(--text-secondary)]">
              <ReactMarkdown>{assessment.template_info}</ReactMarkdown>
            </div>
          )}
          {allowedModels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {allowedModels.map((m) => (
                <span key={m} className="rounded-full bg-[color:var(--bg-overlay)] px-3 py-1 font-mono text-xs text-[color:var(--text-secondary)]">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Connection details */}
      {scoringCriteria.length > 0 && (
        <div className={panelCls}>
          <h2 className={headCls}>Scoring Criteria</h2>
          <div className="space-y-2">
            {scoringCriteria.map((c) => (
              <div key={c.key} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[color:var(--text-primary)]">{c.name}</span>
                  <span className="font-mono text-xs text-[color:var(--text-muted)]">{c.weight}%</span>
                </div>
                <p className="text-xs text-[color:var(--text-muted)]">{c.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection details */}
      {connectionDetails.length > 0 && (
        <div className={panelCls}>
          <h2 className={headCls}>Connection Details</h2>
          <div className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)]">
            {connectionDetails.map((c, i) => (
              <div key={i} className="flex justify-between gap-4 border-b border-[color:var(--border-subtle)] px-4 py-2.5 text-sm last:border-0">
                <span className="font-mono text-[color:var(--text-muted)]">{c.label}</span>
                <span className="font-mono text-[color:var(--text-primary)]">{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reference files (seeded into the candidate's editor) */}
      {referenceFiles.length > 0 && (
        <div className={panelCls}>
          <h2 className={headCls}>Reference Files ({referenceFiles.length})</h2>
          <div className="space-y-1.5">
            {referenceFiles.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-4 text-sm">
                <span className="min-w-0 truncate font-mono text-[color:var(--text-primary)]">{r.path}</span>
                <span className="shrink-0 text-xs text-[color:var(--text-muted)]">{formatBytes(r.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </>
  )
}

function TaskCard({ task, index }: { task: NonNullable<AssessmentSummary['tasks']>[number]; index: number }) {
  return (
    <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-canvas)] p-4">
      <p className="mb-2 text-sm font-medium text-[color:var(--text-primary)]">
        Task {index + 1} - {task.title}
      </p>
      <div className="prose prose-sm mb-3 max-w-none text-[color:var(--text-secondary)]">
        <ReactMarkdown>{task.description}</ReactMarkdown>
      </div>
      {task.done_when.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">Done when</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[color:var(--text-secondary)]">
            {task.done_when.map((c, ci) => (
              <li key={ci}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ProjectDetailsFoot({ assessment }: { assessment: AssessmentSummary }) {
  const submissionFiles = assessment.submission_files ?? []
  const panelCls = 'rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-5'
  const headCls = 'mb-4 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]'

  if (submissionFiles.length === 0) return null

  return (
    <div className={panelCls}>
      <h2 className={headCls}>Submission Requirements</h2>
      <div className="space-y-2">
        {submissionFiles.map((s, i) => (
          <div key={i} className="flex gap-3 text-sm">
            <span className="shrink-0 font-mono text-[color:var(--text-primary)]">{s.name}</span>
            {s.description && <span className="text-[color:var(--text-muted)]">- {s.description}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Generate invite modal (inline form) ─────────────────────────────────────

function GenerateInviteForm({
  assessmentId,
  onSuccess,
  onCancel,
}: {
  assessmentId: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: () => generateInviteToken(assessmentId, name, email),
    onSuccess: (res) => {
      const url = buildInviteUrl(res.data.token)
      setGeneratedUrl(url)
      setEmailSent(res.data.email_sent)
      void queryClient.invalidateQueries({ queryKey: ['invite-tokens', assessmentId] })
    },
  })

  if (generatedUrl) {
    return (
      <div className="rounded-xl border border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] p-5">
        <p className="mb-1 text-sm font-medium text-[color:var(--signal-green)]">Invite link created</p>
        <p className="mb-3 text-xs text-[color:var(--text-muted)]">{emailSent ? `Email sent to ${email}.` : 'Email was not sent; SMTP is not configured or delivery failed. Copy the link below and send it yourself.'}</p>
        <div className="flex min-w-0 gap-2">
          <input
            readOnly
            value={generatedUrl}
            className="min-w-0 flex-1 truncate rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-xs font-mono text-[color:var(--text-secondary)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              copyToClipboard(generatedUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="rounded-lg bg-[color:var(--text-primary)] px-3 py-2 text-xs font-medium text-[color:var(--bg-canvas)] hover:opacity-90"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <button type="button" onClick={onSuccess} className="mt-3 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)] p-5">
      <h3 className="mb-4 text-sm font-semibold text-[color:var(--text-primary)]">Generate Invite Link</h3>
      {isError && (
        <div className="mb-3 rounded border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] p-3 text-xs text-[color:var(--status-fail)]">
          {error instanceof Error ? error.message : 'Failed to generate link.'}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[color:var(--text-secondary)]">Candidate name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:border-[color:var(--signal-violet)] focus:outline-none"
            placeholder="Alice Smith"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[color:var(--text-secondary)]">Candidate email *</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:border-[color:var(--signal-violet)] focus:outline-none"
            placeholder="alice@company.com"
          />
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">The candidate must enter this exact email to start the assessment.</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!name.trim() || !email.trim() || isPending}
          onClick={() => mutate()}
          className="rounded-lg bg-[color:var(--text-primary)] px-4 py-2 text-sm font-medium text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? 'Generating…' : 'Generate Link'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-secondary)]">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AssessmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [problemPanel, setProblemPanel] = useState<'manual' | 'bank' | 'library' | null>(null)
  const [taskPanel, setTaskPanel] = useState<'manual' | 'bank' | null>(null)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const { data: assessmentData, isLoading: loadingAssessment } = useQuery({
    queryKey: ['assessment', id],
    queryFn: () => getAssessment(id!),
    enabled: !!id,
  })

  const { data: tokensData, isLoading: loadingTokens } = useQuery({
    queryKey: ['invite-tokens', id],
    queryFn: () => listInviteTokens(id!),
    enabled: !!id,
  })

  const { data: configData } = useQuery({
    queryKey: ['system-config'],
    queryFn: getSystemConfig,
  })

  const openrouterKeyMissing = configData?.data.openrouter_key_configured === false

  const publishMutation = useMutation({
    mutationFn: () => updateAssessment(id!, { status: 'ACTIVE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assessment', id] }),
    onError: (err) => alert(err instanceof Error ? err.message : 'Failed to publish'),
  })

  const closeMutation = useMutation({
    mutationFn: () => updateAssessment(id!, { status: 'CLOSED' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assessment', id] }),
    onError: (err) => alert(err instanceof Error ? err.message : 'Failed to close assessment'),
  })

  function handleCopyLink(url: string) {
    copyToClipboard(url)
    setCopyNotice('Link copied!')
    setTimeout(() => setCopyNotice(null), 2000)
  }

  const assessment = assessmentData?.data
  const canGenerateInvite = assessment?.status === 'ACTIVE'

  useEffect(() => {
    if (!canGenerateInvite) setShowInviteForm(false)
  }, [canGenerateInvite])

  if (loadingAssessment) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24 text-sm text-[color:var(--text-muted)]">Loading…</div>
      </Layout>
    )
  }

  if (!assessment) {
    return (
      <Layout>
        <div className="text-center py-16 text-sm text-[color:var(--text-muted)]">Assessment not found.</div>
      </Layout>
    )
  }

  const tokens = tokensData?.data ?? []
  const activeCount = tokens.filter((t) => t.status === 'active').length
  const expiredCount = tokens.filter((t) => t.status === 'expired').length
  const isProject = assessment.kind === 'PROJECT'

  return (
    <Layout>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link to="/assessments" className="mb-2 inline-block text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
          ← Assessments
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[color:var(--text-primary)]">{assessment.title}</h1>
            {assessment.description && (
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">{assessment.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={`/assessments/${assessment.id}/leaderboard`}
              className="flex items-center gap-1.5 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-overlay)]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
              Leaderboard
            </Link>
            <StatusBadge status={assessment.status} />
            {assessment.status === 'DRAFT' && (
              <button
                type="button"
                disabled={publishMutation.isPending}
                onClick={() => publishMutation.mutate()}
                className="rounded-lg bg-[color:var(--text-primary)] px-5 py-2.5 text-sm font-semibold text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {publishMutation.isPending ? 'Publishing…' : '▶ Publish Assessment'}
              </button>
            )}
            {assessment.status === 'ACTIVE' && (
              <button
                type="button"
                disabled={closeMutation.isPending}
                onClick={() => closeMutation.mutate()}
                className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-5 py-2.5 text-sm font-semibold text-[color:var(--status-fail)] transition-colors hover:bg-[color:var(--status-fail-dim)] disabled:opacity-50"
              >
                {closeMutation.isPending ? 'Closing…' : 'Close Assessment'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* OpenRouter key warning */}
      {openrouterKeyMissing && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-[color:var(--status-warn)] bg-[color:var(--status-warn-dim)] px-4 py-3 text-sm text-[color:var(--status-warn)]">
          <svg
            className="h-4 w-4 flex-shrink-0"
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
          <span>
            OpenRouter API key is not configured - the AI assistant will not work in this
            assessment.{' '}
            <Link to="/settings" className="underline hover:text-[color:var(--status-warn)]">
              Configure in Settings
            </Link>
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="col-span-2 min-w-0 space-y-6">

          {/* Config */}
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-5">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
              Configuration
            </h2>
            <ConfigRow label="Type" value={isProject ? 'Project / Migration' : 'Coding'} />
            <ConfigRow label="Language" value={assessment.language.charAt(0) + assessment.language.slice(1).toLowerCase()} />
            <ConfigRow label="Time Limit" value={`${assessment.time_limit_minutes} minutes`} />
            <ConfigRow label="LLM Model" value={assessment.llm_model} />
            {isProject && (
              <ConfigRow
                label="AI Assistant"
                value={AI_ASSISTANT_MODE_LABELS[assessment.ai_assistant_mode ?? 'DISABLED'] ?? 'Disabled'}
              />
            )}
            <ConfigRow label="Copy / Paste" value={assessment.allow_copy_paste ? 'Allowed' : 'Blocked'} />
            {isProject && <ConfigRow label="Scoring Strictness" value={(assessment.scoring_strictness ?? 'MEDIUM').replace('_', ' ')} />}
            {!isProject && (
              <>
                <ConfigRow label="Technical Evaluation Weight" value="100%" />
                <ConfigRow label="Technical Evaluation Criteria" value="Correctness, Efficiency, Robustness, Code Quality" />
              </>
            )}
          </div>

          {/* Problems (CODING) */}
          {!isProject && (
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                  Problems ({assessment.problems?.length ?? 0})
                </h2>
                {!problemPanel && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setProblemPanel('bank')} className="border border-[color:var(--border-strong)] px-3 py-1.5 text-xs font-semibold">Choose from bank</button>
                    <button type="button" onClick={() => setProblemPanel('library')} className="border border-[color:var(--border-strong)] px-3 py-1.5 text-xs font-semibold">Choose from my library</button>
                    <button type="button" onClick={() => setProblemPanel('manual')} className="bg-[color:var(--text-primary)] px-3 py-1.5 text-xs font-semibold text-[color:var(--bg-canvas)]">Create manually</button>
                  </div>
                )}
              </div>

              {assessment.problems && assessment.problems.length === 0 && !problemPanel && (
                <div className="rounded-lg border border-dashed border-[color:var(--border-strong)] py-8 text-center text-sm text-[color:var(--text-muted)]">
                  No problems yet - add one to make the invite link work.
                </div>
              )}

              <div className="space-y-3">
                {assessment.problems?.map((p) => (
                  <ProblemCard key={p.id} problem={p} />
                ))}
              </div>

              {problemPanel === 'manual' && (
                <div className={assessment.problems && assessment.problems.length > 0 ? 'mt-4' : ''}>
                  <AddProblemPanel
                    assessmentId={assessment.id}
                    onAdded={() => setProblemPanel(null)}
                    onCancel={() => setProblemPanel(null)}
                  />
                </div>
              )}
              {problemPanel === 'bank' && (
                <div className={assessment.problems && assessment.problems.length > 0 ? 'mt-4' : ''}>
                  <ProblemBankPanel assessmentId={assessment.id} language={assessment.language} onAdded={() => setProblemPanel(null)} onCancel={() => setProblemPanel(null)} />
                </div>
              )}
              {problemPanel === 'library' && (
                <div className={assessment.problems && assessment.problems.length > 0 ? 'mt-4' : ''}>
                  <LibraryProblemPanel assessmentId={assessment.id} onAdded={() => setProblemPanel(null)} onCancel={() => setProblemPanel(null)} />
                </div>
              )}
            </div>
          )}

          {/* Project details (PROJECT) */}
          {isProject && (
            <>
              <ProjectDetailsHead assessment={assessment} />

              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Tasks ({assessment.tasks?.length ?? 0})
                  </h2>
                  {!taskPanel && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setTaskPanel('bank')} className="border border-[color:var(--border-strong)] px-3 py-1.5 text-xs font-semibold">Choose from bank / library</button>
                      <button type="button" onClick={() => setTaskPanel('manual')} className="bg-[color:var(--text-primary)] px-3 py-1.5 text-xs font-semibold text-[color:var(--bg-canvas)]">Add Task</button>
                    </div>
                  )}
                </div>

                {(!assessment.tasks || assessment.tasks.length === 0) && !taskPanel && (
                  <div className="rounded-lg border border-dashed border-[color:var(--border-strong)] py-8 text-center text-sm text-[color:var(--text-muted)]">
                    No tasks yet - add one to make the invite link work.
                  </div>
                )}

                <div className="space-y-3">
                  {assessment.tasks?.map((t, i) => (
                    <TaskCard key={t.id} task={t} index={i} />
                  ))}
                </div>

                {taskPanel === 'manual' && (
                  <div className={assessment.tasks && assessment.tasks.length > 0 ? 'mt-4' : ''}>
                    <AddTaskPanel assessmentId={assessment.id} onAdded={() => setTaskPanel(null)} onCancel={() => setTaskPanel(null)} />
                  </div>
                )}
                {taskPanel === 'bank' && (
                  <div className={assessment.tasks && assessment.tasks.length > 0 ? 'mt-4' : ''}>
                    <TaskBankPanel assessmentId={assessment.id} language={assessment.language} onAdded={() => setTaskPanel(null)} onCancel={() => setTaskPanel(null)} />
                  </div>
                )}
              </div>

              <ProjectDetailsFoot assessment={assessment} />
            </>
          )}
        </div>

        {/* ── Right column ─────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">

          {/* Copy notice */}
          {copyNotice && (
            <div className="rounded-lg border border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] px-4 py-2.5 text-sm text-[color:var(--signal-green)]">
              {copyNotice}
            </div>
          )}

          {/* Invite links */}
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                Invite Candidates
              </h2>
              <div className="flex gap-2 text-xs text-[color:var(--text-muted)]">
                <span className="text-[color:var(--signal-green)]">{activeCount} reusable</span>
                <span>·</span>
                <span>{expiredCount} expired</span>
              </div>
            </div>

            {showInviteForm && canGenerateInvite ? (
              <GenerateInviteForm
                assessmentId={assessment.id}
                onSuccess={() => setShowInviteForm(false)}
                onCancel={() => setShowInviteForm(false)}
              />
            ) : (
              <button
                type="button"
                disabled={!canGenerateInvite}
                onClick={() => setShowInviteForm(true)}
                title={canGenerateInvite ? 'Generate invite link' : 'Closed assessments cannot generate new invite links'}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[color:var(--border-strong)] py-3 text-sm text-[color:var(--text-muted)] transition-colors hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[color:var(--text-muted)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {canGenerateInvite ? 'Generate Invite Link' : 'Assessment Closed'}
              </button>
            )}

            {/* Token list */}
            {loadingTokens ? (
              <p className="mt-4 text-center text-xs text-[color:var(--text-secondary)]">Loading tokens…</p>
            ) : tokens.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--border-subtle)]">
                <table className="min-w-[560px] w-full">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)]">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-[color:var(--text-secondary)]">Candidate</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-[color:var(--text-secondary)]">Status</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-[color:var(--text-secondary)]">Created</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-[color:var(--text-secondary)]">Expires</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => (
                      <InviteTokenRow key={t.id} token={t} onCopy={handleCopyLink} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

        </div>
      </div>
    </Layout>
  )
}
