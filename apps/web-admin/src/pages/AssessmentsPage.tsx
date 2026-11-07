import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'
import { listAssessments, type AssessmentSummary } from '../api/client'

function AssessmentRow({ assessment }: { assessment: AssessmentSummary }) {
  const navigate = useNavigate()

  return (
    <tr
      className="cursor-pointer border-b border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-canvas)] transition-colors"
      onClick={() => navigate(`/assessments/${assessment.id}`)}
    >
      <td className="px-4 py-3">
        <div>
          <p className="text-sm font-medium text-[color:var(--text-primary)]">{assessment.title}</p>
          {assessment.description && (
            <p className="mt-0.5 max-w-xs truncate text-xs text-[color:var(--text-muted)]">{assessment.description}</p>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={assessment.status} />
      </td>
      <td className="px-4 py-3 text-sm text-[color:var(--text-secondary)]">
        {assessment.language.charAt(0) + assessment.language.slice(1).toLowerCase()}
      </td>
      <td className="px-4 py-3 text-sm text-[color:var(--text-secondary)]">
        {assessment.time_limit_minutes} min
      </td>
      <td className="px-4 py-3 text-xs text-[color:var(--text-muted)]">
        {new Date(assessment.created_at).toLocaleDateString()}
      </td>
    </tr>
  )
}

export function AssessmentsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['assessments'],
    queryFn: listAssessments,
  })

  const assessments = data?.data ?? []

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[color:var(--text-primary)]">Assessments</h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            {isLoading ? 'Loading…' : `${assessments.length} total`}
          </p>
        </div>
        <Link
          to="/assessments/new"
          className="flex items-center gap-2 rounded-lg bg-[color:var(--text-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--bg-canvas)] transition-colors hover:opacity-90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Assessment
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] p-4 text-sm text-[color:var(--status-fail)]">
          Failed to load assessments. Try refreshing.
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-24 text-sm text-[color:var(--text-muted)]">Loading…</div>
      ) : assessments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] py-16 text-center">
          <p className="text-sm text-[color:var(--text-muted)]">No assessments yet.</p>
          <Link
            to="/assessments/new"
            className="mt-3 inline-block text-sm text-[color:var(--status-link)] hover:underline"
          >
            Create your first assessment →
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[color:var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">
                  Language
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">
                  Time Limit
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[color:var(--text-muted)]">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {assessments.map((a) => (
                <AssessmentRow key={a.id} assessment={a} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}
