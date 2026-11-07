import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LeaderboardPage } from '../pages/LeaderboardPage'
import type { LeaderboardEntry, CandidateDetail } from '../api/client'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockGetLeaderboard = vi.fn()
const mockGetAssessment = vi.fn()
const mockGetCandidateReport = vi.fn()
const mockGetInteractionLog = vi.fn()
const mockDownloadPdfReport = vi.fn()

vi.mock('../api/client', () => ({
  getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
  getAssessment: (...args: unknown[]) => mockGetAssessment(...args),
  getCandidateReport: (...args: unknown[]) => mockGetCandidateReport(...args),
  getInteractionLog: (...args: unknown[]) => mockGetInteractionLog(...args),
  downloadPdfReport: (...args: unknown[]) => mockDownloadPdfReport(...args),
  ApiException: class ApiException extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'ApiException'
    }
  },
}))

vi.mock('../components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    session_id: 'session-1',
    candidate_name: 'Alice',
    candidate_email: null,
    total_score: 85.0,
    code_correctness_score: 90.0,
    aiu_total_score: 75.0,
    project_criteria: null,
    submitted_at: '2026-06-01T10:00:00Z',
    ...overrides,
  }
}

const ASSESSMENT_RESPONSE = {
  data: {
    id: 'test-id',
    title: 'Backend Engineer Assessment',
    status: 'ACTIVE' as const,
    language: 'PYTHON' as const,
    time_limit_minutes: 60,
    llm_model: 'openai/gpt-4o-mini',
    code_weight: 60,
    aiu_weight: 40,
    aiu_metrics: ['PROMPT_QUALITY' as const],
    aiu_metric_weights: { prompt_quality: 100 },
    description: null,
    scheduled_start: null,
    expires_at: null,
    created_at: '2026-06-01T08:00:00Z',
  },
}

// Candidate scored with values distinct from leaderboard row to avoid getByText ambiguity
const SCORED_CANDIDATE: CandidateDetail = {
  session_id: 'session-1',
  candidate_name: 'Alice',
  candidate_email: 'alice@example.com',
  assessment_title: 'Backend Engineer Assessment',
  kind: 'CODING',
  language: 'PYTHON',
  total_score: 73.0,
  code_correctness_score: 88.0,
  hidden_tests_passed: 9,
  hidden_tests_total: 10,
  aiu_total_score: 73.0,
  aiu_scores: [
    { metric: 'correctness', score: 92, weight: 25 },
    { metric: 'efficiency', score: 60, weight: 25 },
    { metric: 'robustness', score: 70, weight: 25 },
    { metric: 'code_quality', score: 70, weight: 25 },
  ],
  project_scores: null,
  time_taken_seconds: 3600,
  interaction_count: 8,
  started_at: '2026-06-01T09:00:00Z',
  submitted_at: '2026-06-01T10:00:00Z',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/assessments/test-id/leaderboard']}>
        <Routes>
          <Route path="/assessments/:id/leaderboard" element={<LeaderboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Finds the slide-in candidate panel by its fixed-overlay structure. */
function getSlideinPanel(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /candidate report/i })
  // heading → header div → panel div (the w-[500px] container)
  return heading.closest('[class*="border-l"]') as HTMLElement
}

// ─── Tests: empty state ────────────────────────────────────────────────────────

describe('LeaderboardPage - empty state', () => {
  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
    mockGetLeaderboard.mockResolvedValue({ data: [] })
  })

  it('shows no-submissions message when leaderboard is empty', async () => {
    renderPage()
    expect(await screen.findByText(/no candidates have submitted yet/i)).toBeInTheDocument()
  })

  it('Export CSV button is disabled when there are no entries', async () => {
    renderPage()
    await screen.findByText(/no candidates have submitted yet/i)
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled()
  })
})

// ─── Tests: rank styling ───────────────────────────────────────────────────────

describe('LeaderboardPage - rubric versions', () => {
  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
  })

  it('warns when coding leaderboard contains mixed technical rubric versions', async () => {
    mockGetLeaderboard.mockResolvedValue({
      data: [
        makeEntry({ session_id: 's-v1', candidate_name: 'V1 Candidate', rubric_version: 'DISABLED_TECHNICAL_V1' }),
        makeEntry({ session_id: 's-v2', candidate_name: 'V2 Candidate', rubric_version: 'DISABLED_TECHNICAL_V2' }),
      ],
      rubric_versions: ['DISABLED_TECHNICAL_V1', 'DISABLED_TECHNICAL_V2'],
      mixed_rubric_versions: true,
    })

    renderPage()

    expect(await screen.findByText(/multiple technical evaluation rubrics/i)).toBeInTheDocument()
    expect(screen.getByText(/DISABLED_TECHNICAL_V1, DISABLED_TECHNICAL_V2/)).toBeInTheDocument()
  })
})

describe('LeaderboardPage - top 3 rank styling', () => {
  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
    mockGetLeaderboard.mockResolvedValue({
      data: [
        makeEntry({ rank: 1, session_id: 's1', candidate_name: 'Gold', total_score: 100 }),
        makeEntry({ rank: 2, session_id: 's2', candidate_name: 'Silver', total_score: 90 }),
        makeEntry({ rank: 3, session_id: 's3', candidate_name: 'Bronze', total_score: 80 }),
        makeEntry({ rank: 4, session_id: 's4', candidate_name: 'Other', total_score: 70 }),
      ],
    })
  })

  it('renders rank badges for all four entries', async () => {
    renderPage()
    expect(await screen.findByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.getByText('#4')).toBeInTheDocument()
  })

  it('rank-1 badge has gold (amber-600) styling', async () => {
    renderPage()
    const badge = await screen.findByText('#1')
    expect(badge.className).toContain('text-[color:var(--status-warn)]')
  })

  it('rank-2 badge has silver (gray-600) styling', async () => {
    renderPage()
    const badge = await screen.findByText('#2')
    expect(badge.className).toContain('text-[color:var(--text-secondary)]')
  })

  it('rank-3 badge has bronze (orange-600) styling', async () => {
    renderPage()
    const badge = await screen.findByText('#3')
    expect(badge.className).toContain('text-orange-600')
  })

  it('rank-4+ badge has no special colour (gray-500)', async () => {
    renderPage()
    const badge = await screen.findByText('#4')
    expect(badge.className).toContain('text-[color:var(--text-muted)]')
    expect(badge.className).not.toContain('text-[color:var(--status-warn)]')
    expect(badge.className).not.toContain('text-orange-600')
  })
})

// ─── Tests: tie-breaking display ──────────────────────────────────────────────

describe('LeaderboardPage - tie-breaking ranks', () => {
  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
    // Both total_score=90; rank 1 order is applied server-side.
    mockGetLeaderboard.mockResolvedValue({
      data: [
        makeEntry({
          rank: 1,
          session_id: 'sa',
          candidate_name: 'Top Coder',
          total_score: 90,
          code_correctness_score: 95,
        }),
        makeEntry({
          rank: 2,
          session_id: 'sb',
          candidate_name: 'Second Coder',
          total_score: 90,
          code_correctness_score: 80,
        }),
      ],
    })
  })

  it('displays rank 1 row before rank 2 row when total scores are tied', async () => {
    renderPage()
    const rows = await screen.findAllByRole('row')
    // rows[0] = header; rows[1] = rank-1; rows[2] = rank-2
    expect(within(rows[1]).getByText('#1')).toBeInTheDocument()
    expect(within(rows[2]).getByText('#2')).toBeInTheDocument()
  })

  it('coding rows do not expose code correctness tie-break values', async () => {
    renderPage()
    const rows = await screen.findAllByRole('row')
    expect(within(rows[1]).queryByText('95.0')).not.toBeInTheDocument()
    expect(within(rows[2]).queryByText('80.0')).not.toBeInTheDocument()
  })
})

// ─── Tests: Top X selector ────────────────────────────────────────────────────

describe('LeaderboardPage - Top X selector', () => {
  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
    mockGetLeaderboard.mockResolvedValue({
      data: Array.from({ length: 15 }, (_, i) =>
        makeEntry({
          rank: i + 1,
          session_id: `s-${i + 1}`,
          candidate_name: `Candidate ${i + 1}`,
          total_score: 100 - i,
        }),
      ),
    })
  })

  it('shows only 10 rows by default (Top 10)', async () => {
    renderPage()
    await screen.findByText('#1')
    // 1 header row + 10 data rows = 11
    expect(screen.getAllByRole('row').length).toBe(11)
  })

  it('shows all 15 rows when "All" is selected', async () => {
    renderPage()
    await screen.findByText('#1')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    await waitFor(() => {
      expect(screen.getAllByRole('row').length).toBe(16) // 1 header + 15
    })
  })

  it('clamps to actual entry count when limit exceeds available entries', async () => {
    renderPage()
    await screen.findByText('#1')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '25' } })
    await waitFor(() => {
      expect(screen.getAllByRole('row').length).toBe(16) // only 15 available
    })
  })

  it('selector shows the chosen option', async () => {
    renderPage()
    await screen.findByText('#1')
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '50' } })
    expect(select.value).toBe('50')
  })
})

// ─── Tests: Export CSV ────────────────────────────────────────────────────────

describe('LeaderboardPage - Export CSV', () => {
  let clickSpy: { mockRestore: () => void }

  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
    mockGetLeaderboard.mockResolvedValue({
      data: [
        makeEntry({ rank: 1, session_id: 's1', candidate_name: 'Alice', total_score: 90 }),
        makeEntry({ rank: 2, session_id: 's2', candidate_name: 'Bob', total_score: 75 }),
      ],
    })
    global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/fake')
    global.URL.revokeObjectURL = vi.fn()
    // Prevent jsdom "not implemented: navigation" error from anchor.click()
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    clickSpy.mockRestore()
  })

  it('triggers a download when Export CSV is clicked', async () => {
    renderPage()
    await screen.findByText('Alice')
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('CSV download filename includes the assessment title', async () => {
    renderPage()
    await screen.findByText('Alice')

    const appendSpy = vi.spyOn(document.body, 'appendChild')
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor?.tagName?.toLowerCase()).toBe('a')
    expect(anchor?.download).toContain('backend-engineer-assessment')
    appendSpy.mockRestore()
  })

  it('blob passed to createObjectURL has text/csv MIME type', async () => {
    renderPage()
    await screen.findByText('Alice')
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
    // URL.createObjectURL is a vi.fn() - inspect what was passed to it
    const passedArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob
    expect(passedArg?.type).toBe('text/csv')
  })

  it('revokeObjectURL is called to clean up the blob URL', async () => {
    renderPage()
    await screen.findByText('Alice')
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fake')
  })
})

// ─── Tests: CandidateDetailPanel - unscored ───────────────────────────────────

describe('CandidateDetailPanel - unscored session', () => {
  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
    mockGetLeaderboard.mockResolvedValue({
      data: [makeEntry({ rank: 1, session_id: 'session-1', candidate_name: 'Alice' })],
    })
    // Simulate score not yet available
    mockGetCandidateReport.mockResolvedValue({ data: undefined })
  })

  it('shows unavailable message when the report is not yet available', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Alice'))
    await screen.findByRole('heading', { name: /candidate report/i })
    expect(await screen.findByText(/candidate report is not available yet/i)).toBeInTheDocument()
  })

  it('does not show score numbers when the report is not available', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Alice'))
    await screen.findByText(/candidate report is not available yet/i)
    const panel = getSlideinPanel()
    expect(within(panel).queryByText(/total score/i)).not.toBeInTheDocument()
  })
})

// ─── Tests: CandidateDetailPanel - scored ─────────────────────────────────────

describe('CandidateDetailPanel - scored session', () => {
  beforeEach(() => {
    mockGetAssessment.mockResolvedValue(ASSESSMENT_RESPONSE)
    // Leaderboard row uses different scores from panel report so text queries
    // do not match leaderboard row values.
    mockGetLeaderboard.mockResolvedValue({
      data: [makeEntry({ rank: 1, session_id: 'session-1', candidate_name: 'Alice' })],
    })
    mockGetCandidateReport.mockResolvedValue({ data: SCORED_CANDIDATE })
    mockGetInteractionLog.mockResolvedValue({ data: [] })
    mockDownloadPdfReport.mockResolvedValue(undefined)
  })

  async function openPanel() {
    renderPage()
    fireEvent.click(await screen.findByText('Alice'))
    await screen.findByRole('heading', { name: /candidate report/i })
    // Wait for report data to load
    await screen.findByText('73.0')
    return getSlideinPanel()
  }

  it('shows candidate name in the panel', async () => {
    const panel = await openPanel()
    // Alice appears in both the leaderboard row and the panel - use within(panel)
    expect(within(panel).getAllByText('Alice').length).toBeGreaterThanOrEqual(1)
  })

  it('shows total score prominently', async () => {
    const panel = await openPanel()
    expect(within(panel).getAllByText('73.0').length).toBeGreaterThanOrEqual(1)
  })

  it('does not show code correctness for coding reports', async () => {
    const panel = await openPanel()
    expect(within(panel).queryByText(/code correctness/i)).not.toBeInTheDocument()
    expect(within(panel).queryByText('88.0')).not.toBeInTheDocument()
  })

  it('does not show hidden test pass count as a separate code-correctness detail', async () => {
    const panel = await openPanel()
    expect(within(panel).queryByText(/hidden tests passed/i)).not.toBeInTheDocument()
  })

  it('shows deterministic technical evaluation criteria instead of legacy AIU metric names', async () => {
    const panel = await openPanel()
    expect(within(panel).getByText('Correctness')).toBeInTheDocument()
    expect(within(panel).getByText('Efficiency')).toBeInTheDocument()
    expect(within(panel).getByText('Robustness')).toBeInTheDocument()
    expect(within(panel).getByText('Code Quality')).toBeInTheDocument()
    expect(within(panel).queryByText('Prompt Quality')).not.toBeInTheDocument()
  })

  it('shows technical evaluation metric scores', async () => {
    const panel = await openPanel()
    expect(within(panel).getByText(/92\.0 \/100/)).toBeInTheDocument()
    expect(within(panel).getByText(/60\.0 \/100/)).toBeInTheDocument()
  })

  it('shows AIU metric weight', async () => {
    const panel = await openPanel()
    expect(within(panel).getAllByText(/\(25%\)/).length).toBe(4)
  })

  it('shows time taken and interaction count stats', async () => {
    const panel = await openPanel()
    expect(within(panel).getByText(/1h 0m/i)).toBeInTheDocument()
    expect(within(panel).getByText(/8 turns/i)).toBeInTheDocument()
  })

  it('Download PDF button is present and enabled', async () => {
    const panel = await openPanel()
    const btn = within(panel).getByRole('button', { name: /download pdf/i })
    expect(btn).not.toBeDisabled()
  })

  it('clicking Download PDF calls downloadPdfReport with the session ID', async () => {
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: /download pdf/i }))
    await waitFor(() => {
      expect(mockDownloadPdfReport).toHaveBeenCalledWith('session-1')
    })
  })

  it('interaction log section is collapsed by default', async () => {
    const panel = await openPanel()
    expect(within(panel).queryByText(/ai interaction log/i)).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /view log/i })).toBeInTheDocument()
  })

  it('interaction log becomes visible after clicking View Log', async () => {
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: /view log/i }))
    expect(await screen.findByText(/ai interaction log/i)).toBeInTheDocument()
  })

  it('interaction log collapses again when Hide Log is clicked', async () => {
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: /view log/i }))
    await screen.findByText(/ai interaction log/i)
    fireEvent.click(within(panel).getByRole('button', { name: /hide log/i }))
    await waitFor(() => {
      expect(screen.queryByText(/ai interaction log/i)).not.toBeInTheDocument()
    })
  })

  it('panel closes when the backdrop overlay is clicked', async () => {
    const panel = await openPanel()
    // The backdrop is the sibling div before the slide-in panel
    const fixedOverlay = panel.parentElement as HTMLElement
    const backdrop = fixedOverlay.firstElementChild as HTMLElement
    fireEvent.click(backdrop)
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /candidate report/i })).not.toBeInTheDocument()
    })
  })
})
