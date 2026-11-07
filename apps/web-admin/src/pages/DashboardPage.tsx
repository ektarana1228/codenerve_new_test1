import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'
import { listAssessments, type AssessmentSummary } from '../api/client'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-2 text-3xl font-bold text-[color:var(--text-primary)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[color:var(--text-muted)]">{sub}</p>}
    </div>
  )
}

function AssessmentRow({ assessment }: { assessment: AssessmentSummary }) {
  return (
    <Link
      to={`/assessments/${assessment.id}`}
      className="flex items-center justify-between rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] px-4 py-3 transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-overlay)]"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[color:var(--text-primary)]">{assessment.title}</p>
        <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
          {assessment.language} · {assessment.time_limit_minutes} min
        </p>
      </div>
      <div className="ml-4 flex-shrink-0">
        <StatusBadge status={assessment.status} />
      </div>
    </Link>
  )
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['assessments'],
    queryFn: listAssessments,
  })

  const assessments = data?.data ?? []
  const total = assessments.length
  const active = assessments.filter((a) => a.status === 'ACTIVE').length
  const draft = assessments.filter((a) => a.status === 'DRAFT').length
  const feedbackResponses = assessments.reduce((sum, a) => sum + (a.feedback_summary?.responses ?? 0), 0)
  const weightedFeedbackTotal = assessments.reduce((sum, a) => {
    const responses = a.feedback_summary?.responses ?? 0
    const average = a.feedback_summary?.average_rating
    return average == null ? sum : sum + average * responses
  }, 0)
  const averageFeedback = feedbackResponses > 0 ? (weightedFeedbackTotal / feedbackResponses).toFixed(1) : '-'
  const recent = [...assessments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[color:var(--text-primary)]">Dashboard</h1>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">Overview of all assessments</p>
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Total Assessments" value={isLoading ? '-' : total} />
        <StatCard label="Active Assessments" value={isLoading ? '-' : active} sub="Currently accepting candidates" />
        <StatCard label="Drafts" value={isLoading ? '-' : draft} sub="Not yet published" />
        <StatCard label="Candidate Feedback" value={isLoading ? '-' : `${averageFeedback} /5`} sub={`${feedbackResponses} response${feedbackResponses === 1 ? '' : 's'}`} />
      </div>

      {/* Recent assessments */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[color:var(--text-secondary)]">Recent Assessments</h2>
        <Link to="/assessments" className="text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]">
          View all →
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[color:var(--text-muted)]">Loading…</div>
      ) : recent.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] py-12 text-center text-sm text-[color:var(--text-muted)]">
          No assessments yet.{' '}
          <Link to="/assessments/new" className="text-[color:var(--status-link)] hover:underline">
            Create one
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {recent.map((a) => (
            <AssessmentRow key={a.id} assessment={a} />
          ))}
        </div>
      )}
    </Layout>
  )
}
