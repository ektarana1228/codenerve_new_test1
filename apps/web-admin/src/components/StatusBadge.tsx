import type { AssessmentStatus } from '../api/client'

const STYLES: Record<AssessmentStatus, string> = {
  DRAFT: 'bg-[color:var(--bg-overlay)] text-[color:var(--text-secondary)] border border-[color:var(--border-strong)]',
  SCHEDULED: 'bg-[color:var(--status-warn-dim)] text-[color:var(--status-warn)] border border-[color:var(--status-warn)]',
  ACTIVE: 'bg-[color:var(--signal-green-dim)] text-[color:var(--signal-green)] border border-[color:var(--signal-green)]',
  CLOSED: 'bg-[color:var(--status-fail-dim)] text-[color:var(--status-fail)] border border-[color:var(--status-fail)]',
}

const LABELS: Record<AssessmentStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
}

type InviteStatus = 'active' | 'expired'

const INVITE_STYLES: Record<InviteStatus, string> = {
  active: 'bg-[color:var(--signal-green-dim)] text-[color:var(--signal-green)] border border-[color:var(--signal-green)]',
  expired: 'bg-[color:var(--bg-overlay)] text-[color:var(--text-muted)] border border-[color:var(--border-strong)]',
}

export function StatusBadge({ status }: { status: AssessmentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  )
}

export function InviteStatusBadge({ status }: { status: InviteStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${INVITE_STYLES[status]}`}>
      {status === 'active' ? 'Reusable' : 'Expired'}
    </span>
  )
}
