import { useAuthStore } from '../store/auth'

// ─── Error class ──────────────────────────────────────────────────────────────

export class ApiException extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiException'
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().admin_token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers })
  } catch {
    throw new ApiException('NETWORK_ERROR', 'Network error - check your connection')
  }

  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } | undefined
    try { body = await response.json() } catch { /* ignore */ }
    throw new ApiException(
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed (${response.status})`,
    )
  }

  return response.json() as Promise<T>
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type LoginResponse = { data: { access_token: string } }
export type AdminAccount = {
  id: string
  email: string
  role: 'ADMIN'
  created_at: string
  total_assignments: number
  live_assignments: number
  total_sessions: number
  active_sessions: number
  submitted_sessions: number
}
export type AdminSignupRequest = {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  created_at: string
}

export function loginAdmin(email: string, password: string): Promise<LoginResponse> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function createAdminAccount(email: string, password: string): Promise<{ data: AdminAccount }> {
  return apiFetch('/auth/admins', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function listAdminAccounts(): Promise<{ data: AdminAccount[] }> {
  return apiFetch('/auth/admins')
}

export function revokeAdminAccount(id: string): Promise<{ data: { id: string } }> {
  return apiFetch(`/auth/admins/${id}`, { method: 'DELETE' })
}

export function requestAdminAccount(payload: {
  email: string
  password: string
  fullName?: string
  companyName?: string
}): Promise<{ data: AdminSignupRequest }> {
  return apiFetch('/auth/admin-requests', {
    method: 'POST',
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      fullName: payload.fullName || undefined,
      companyName: payload.companyName || undefined,
    }),
  })
}

export function listAdminSignupRequests(): Promise<{ data: AdminSignupRequest[] }> {
  return apiFetch('/auth/admin-requests')
}

export function approveAdminSignupRequest(id: string): Promise<{ data: { id: string } }> {
  return apiFetch(`/auth/admin-requests/${id}/approve`, { method: 'POST' })
}

export function rejectAdminSignupRequest(id: string): Promise<{ data: { id: string } }> {
  return apiFetch(`/auth/admin-requests/${id}/reject`, { method: 'POST' })
}

// ─── Assessments ──────────────────────────────────────────────────────────────

export type AssessmentStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED'
export type AssessmentKind = 'CODING' | 'PROJECT'
export type Language = 'PYTHON' | 'JAVASCRIPT' | 'TYPESCRIPT'
export type ProctoringMode = 'OFF' | 'OPTIONAL' | 'REQUIRED'
export type ScoringStrictness = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH'
export type AiAssistantMode = 'AGENTIC' | 'NON_AGENTIC' | 'DISABLED'
export type AiuMetric =
  | 'PROMPT_QUALITY'
  | 'ITERATION_EFFICIENCY'
  | 'INDEPENDENT_EDITING'
  | 'CONTEXTUAL_RELEVANCE'

// PROJECT-kind building blocks.
export type ConnectionDetail = { label: string; value: string }
export type SubmissionFileSpec = { name: string; description: string }
export type ProjectScoringCriterion = { key: string; name: string; description: string; weight: number }
// Uploaded on create (base64 content); returned as path + size only.
export type ReferenceFile = { path: string; contentBase64: string }
export type ReferenceFileInfo = { path: string; size: number }
export type TaskSummary = {
  id: string
  assessment_id: string
  order: number
  title: string
  description: string
  done_when: string[]
  created_at: string
}

export type AssessmentSummary = {
  id: string
  title: string
  description: string | null
  kind?: AssessmentKind
  status: AssessmentStatus
  language: Language
  time_limit_minutes: number
  llm_model: string
  allowed_models?: string[]
  template_info?: string | null
  connection_details?: ConnectionDetail[]
  submission_files?: SubmissionFileSpec[]
  reference_files?: ReferenceFileInfo[]
  project_scoring_criteria?: ProjectScoringCriterion[]
  scoring_strictness?: ScoringStrictness
  code_weight: number
  aiu_weight: number
  aiu_metrics: AiuMetric[]
  aiu_metric_weights: Record<string, number>
  allow_copy_paste: boolean
  ai_assistant_mode?: AiAssistantMode
  screen_recording: ProctoringMode
  video_proctoring: ProctoringMode
  microphone_recording: ProctoringMode
  second_camera: ProctoringMode
  scheduled_start: string | null
  expires_at: string | null
  created_at: string
  problems?: ProblemSummary[]
  tasks?: TaskSummary[]
  feedback_summary?: { responses: number; average_rating: number | null }
}

export type TestCaseSummary = {
  id: string
  problem_id: string
  input: string
  expected: string
  is_hidden: boolean
  created_at: string
}

export type ProblemSummary = {
  id: string
  assessment_id: string
  title: string
  description: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  allow_copy_paste: boolean
  created_at: string
  test_cases?: TestCaseSummary[]
}

export type CreateTaskPayload = {
  title: string
  description: string
  doneWhen: string[]
  // Set when this task was added from the bug-fix bank.
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD'
  bugBankId?: string
}

export type CreateAssessmentPayload = {
  title: string
  description?: string
  kind?: AssessmentKind
  timeLimitMinutes: number
  language: Language
  llmModel: string
  codeWeight: number
  aiuWeight: number
  aiuMetrics: AiuMetric[]
  aiuMetricWeights: Record<string, number>
  allowCopyPaste?: boolean
  // Optional: omitting it lets the backend apply the kind-based default.
  aiAssistantMode?: AiAssistantMode
  scoringStrictness?: ScoringStrictness
  screenRecording: ProctoringMode
  videoProctoring: ProctoringMode
  microphoneRecording: ProctoringMode
  secondCamera: ProctoringMode
  // PROJECT kind only.
  allowedModels?: string[]
  templateInfo?: string
  connectionDetails?: ConnectionDetail[]
  submissionFiles?: SubmissionFileSpec[]
  referenceFiles?: ReferenceFile[]
  projectScoringCriteria?: ProjectScoringCriterion[]
  // Admin-only reference fix for bug-fix bank tasks. Never returned by the
  // API - write-only, consumed by SQS scoring.
  solutionFiles?: ReferenceFile[]
  tasks?: CreateTaskPayload[]
  scheduledStart?: string
  expiresAt?: string
}

export type CreateProblemPayload = {
  title: string
  description: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  allowCopyPaste: boolean
  testCases: Array<{ input: string; expected: string; isHidden: boolean }>
}

export type ProblemBankEntry = {
  id: string
  title: string
  topic: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  description: string
  test_case_count: number
  reference_solutions: Record<Language, string>
  time_complexity: string
  space_complexity: string
}

// Full content (including the reference solution) since this is an admin-only,
// 10-entry bank - no pagination/search needed unlike the generated CODING bank.
export type ProjectBugBankEntry = {
  id: string
  title: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  language: Language
  description: string
  done_when: string[]
  files: ReferenceFile[]
  solution_files: ReferenceFile[]
}

export function listProjectBugBank(language?: Language): Promise<{ data: ProjectBugBankEntry[] }> {
  const query = language ? `?language=${language}` : ''
  return apiFetch(`/project-bug-bank${query}`)
}

export function listAssessments(): Promise<{ data: AssessmentSummary[]; next_cursor: string | null }> {
  return apiFetch('/assessments')
}

export function getAssessment(id: string): Promise<{ data: AssessmentSummary }> {
  return apiFetch(`/assessments/${id}`)
}

export function createAssessment(payload: CreateAssessmentPayload): Promise<{ data: AssessmentSummary }> {
  return apiFetch('/assessments', { method: 'POST', body: JSON.stringify(payload) })
}

export function createProblem(assessmentId: string, payload: CreateProblemPayload): Promise<{ data: ProblemSummary }> {
  return apiFetch(`/assessments/${assessmentId}/problems`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateAssessment(
  id: string,
  payload: Partial<CreateAssessmentPayload & { status: AssessmentStatus }>,
): Promise<{ data: AssessmentSummary }> {
  return apiFetch(`/assessments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

// ─── Invite tokens ────────────────────────────────────────────────────────────

export function listProblemBank(filters: { search: string; topic: string; difficulty: string; page: number }): Promise<{
  data: ProblemBankEntry[]; topics: string[]; total: number; page: number; pages: number
}> {
  const query = new URLSearchParams({ page: String(filters.page), limit: '25' })
  if (filters.search) query.set('search', filters.search)
  if (filters.topic) query.set('topic', filters.topic)
  if (filters.difficulty) query.set('difficulty', filters.difficulty)
  return apiFetch(`/problem-bank?${query}`)
}

export function addProblemFromBank(assessmentId: string, bankId: string): Promise<{ data: ProblemSummary }> {
  return apiFetch(`/assessments/${assessmentId}/problems/from-bank`, {
    method: 'POST',
    body: JSON.stringify({ bank_id: bankId }),
  })
}

// ─── Library (admin-authored, reusable problems/tasks) ───────────────────────

export type LibraryProblemSummary = {
  id: string
  title: string
  topic: string | null
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  description: string
  allow_copy_paste: boolean
  test_case_count: number
  created_at: string
}

export type LibraryTaskEntry = {
  id: string
  title: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  language: Language | null
  description: string
  done_when: string[]
  files: ReferenceFile[]
  solution_files: ReferenceFile[]
  created_at: string
}

export type CreateLibraryProblemPayload = {
  title: string
  topic?: string
  description: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  allowCopyPaste: boolean
  testCases: Array<{ input: string; expected: string; isHidden: boolean }>
}

export type CreateLibraryTaskPayload = {
  title: string
  description: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  language: Language
  doneWhen: string[]
  referenceFiles: ReferenceFile[]
  solutionFiles: ReferenceFile[]
}

export function listLibraryProblems(filters: { search: string; difficulty: string; page: number }): Promise<{
  data: LibraryProblemSummary[]; total: number; page: number; pages: number
}> {
  const query = new URLSearchParams({ page: String(filters.page), limit: '25' })
  if (filters.search) query.set('search', filters.search)
  if (filters.difficulty) query.set('difficulty', filters.difficulty)
  return apiFetch(`/library/problems?${query}`)
}

export type LibraryTestCase = { id: string; input: string; expected: string; is_hidden: boolean }

export function getLibraryProblem(id: string): Promise<{ data: LibraryProblemSummary & { test_cases: LibraryTestCase[] } }> {
  return apiFetch(`/library/problems/${id}`)
}

export function createLibraryProblem(payload: CreateLibraryProblemPayload): Promise<{ data: LibraryProblemSummary }> {
  return apiFetch('/library/problems', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateLibraryProblem(
  id: string,
  payload: Partial<CreateLibraryProblemPayload>,
): Promise<{ data: LibraryProblemSummary }> {
  return apiFetch(`/library/problems/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function deleteLibraryProblem(id: string): Promise<void> {
  return apiFetch(`/library/problems/${id}`, { method: 'DELETE' })
}

export function listLibraryTasks(filters?: { search?: string; language?: string; difficulty?: string }): Promise<{ data: LibraryTaskEntry[] }> {
  const query = new URLSearchParams()
  if (filters?.search) query.set('search', filters.search)
  if (filters?.language) query.set('language', filters.language)
  if (filters?.difficulty) query.set('difficulty', filters.difficulty)
  const qs = query.toString()
  return apiFetch(`/library/tasks${qs ? `?${qs}` : ''}`)
}

export function createLibraryTask(payload: CreateLibraryTaskPayload): Promise<{ data: LibraryTaskEntry }> {
  return apiFetch('/library/tasks', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateLibraryTask(
  id: string,
  payload: Partial<CreateLibraryTaskPayload>,
): Promise<{ data: LibraryTaskEntry }> {
  return apiFetch(`/library/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function deleteLibraryTask(id: string): Promise<void> {
  return apiFetch(`/library/tasks/${id}`, { method: 'DELETE' })
}

export function addProblemFromLibrary(assessmentId: string, libraryId: string): Promise<{ data: ProblemSummary }> {
  return apiFetch(`/assessments/${assessmentId}/problems/from-library`, {
    method: 'POST',
    body: JSON.stringify({ library_id: libraryId }),
  })
}

export function createTask(assessmentId: string, payload: CreateTaskPayload & { referenceFiles?: ReferenceFile[]; solutionFiles?: ReferenceFile[] }): Promise<{ data: TaskSummary }> {
  return apiFetch(`/assessments/${assessmentId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type InviteTokenStatus = 'active' | 'expired'

export type InviteToken = {
  id: string
  token: string
  candidate_name: string
  candidate_email: string | null
  used_at: string | null
  expires_at: string
  created_at: string
  status: InviteTokenStatus
}

export function listInviteTokens(
  assessmentId: string,
): Promise<{ data: InviteToken[]; next_cursor: string | null }> {
  return apiFetch(`/auth/invite-tokens/${assessmentId}`)
}

export function generateInviteToken(
  assessmentId: string,
  candidateName: string,
  candidateEmail: string,
): Promise<{ data: { token: string; invite_url: string; email_sent: boolean } }> {
  return apiFetch('/auth/invite-tokens', {
    method: 'POST',
    body: JSON.stringify({
      assessment_id: assessmentId,
      candidate_name: candidateName,
      candidate_email: candidateEmail,
    }),
  })
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export type CriterionScore = { name: string; score: number; weight: number }

export type LeaderboardEntry = {
  rank: number
  session_id: string
  candidate_name: string
  candidate_email: string | null
  total_score: number
  code_correctness_score: number
  aiu_total_score: number
  rubric_version?: string
  // PROJECT-kind only: per-criterion scores for the Scoring Criteria column.
  project_criteria: CriterionScore[] | null
  submitted_at: string
}

export function getLeaderboard(assessmentId: string, topX = 10): Promise<{ data: LeaderboardEntry[]; feedback_summary?: { responses: number; average_rating: number | null }; rubric_versions?: string[]; mixed_rubric_versions?: boolean }> {
  const query = new URLSearchParams({ top_x: String(topX) })
  return apiFetch(`/reports/assessments/${assessmentId}/leaderboard?${query}`)
}

// ─── Candidate reports ────────────────────────────────────────────────────────

export type AiuScoreDetail = {
  metric: string
  score: number
  weight: number
}

export type CandidateDetail = {
  session_id: string
  candidate_name: string
  candidate_email: string | null
  assessment_title: string
  kind: 'CODING' | 'PROJECT'
  language: string
  total_score: number
  code_correctness_score: number
  hidden_tests_passed: number | null
  hidden_tests_total: number | null
  aiu_total_score: number
  rubric_version?: string
  aiu_scores: AiuScoreDetail[]
  // PROJECT-kind only: per-criterion scores for the detail panel.
  project_scores: CriterionScore[] | null
  project_evaluation?: {
    tasks: Array<{
      task_id: string
      difficulty: string
      base_score: number
      final_score: number
      criteria: Array<{ name: string; score: number; weight: number }>
      rationale: string
      evidence_references: string[]
      missing_requirements: string[]
      applied_caps: Array<{ reason: string; cap: number }>
    }>
    assistant_evidence_state: string
    manual_review_required: boolean
    manual_review_reasons: string[]
  } | null
  feedback?: {
    average_rating: number
    overall_experience: number
    instructions_clarity: number
    difficulty_relevance: number
    platform_usability: number
    technical_performance: number
    coding_environment: number
    ai_assistant_usefulness: number
    ai_assistant_usage: string | null
    proctoring_experience: number
    fairness: number
    assessment_name: string | null
    task_where_issue_occurred: string | null
    technical_issue_type: string | null
    may_contact: boolean
    comments: string | null
    submitted_at: string
  } | null
  time_taken_seconds: number | null
  interaction_count: number
  started_at: string | null
  submitted_at: string | null
}

export function getCandidateReport(sessionId: string): Promise<{ data: CandidateDetail }> {
  return apiFetch(`/reports/sessions/${sessionId}`)
}

export type InteractionTurn = {
  turn_number: number
  prompt_text: string
  response_text: string
  timestamp: string
}

export function getInteractionLog(sessionId: string): Promise<{ data: InteractionTurn[] }> {
  return apiFetch(`/reports/sessions/${sessionId}/interactions`)
}

export type ProctorEvent = { id: string; source: string; type: string; metadata: Record<string, unknown>; created_at: string }
export type ProctorMedia = { id: string; kind: string; mime_type: string; size_bytes: number; captured_at: string; segment_label?: string }

export function getProctorEvents(sessionId: string): Promise<{ data: ProctorEvent[] }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/events?limit=500`)
}

export function getProctorMedia(sessionId: string): Promise<{ assessment_id: string; data: ProctorMedia[] }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/media`)
}

export function deleteProctorMedia(sessionId: string, mediaId: string): Promise<{ data: { deleted: true } }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/media/${mediaId}`, { method: 'DELETE' })
}

export async function getProctorMediaUrl(sessionId: string, mediaId: string): Promise<string> {
  const token = useAuthStore.getState().admin_token
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(`/api/v1/proctoring/sessions/${sessionId}/media/${mediaId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
      throw new ApiException(body?.error?.code ?? 'MEDIA_UNAVAILABLE', body?.error?.message ?? 'Evidence could not be loaded')
    }
    const contentType = response.headers.get('Content-Type') ?? ''
    if (!contentType.startsWith('video/') && !contentType.startsWith('audio/')) {
      throw new ApiException('INVALID_MEDIA', 'Evidence has an unsupported media type')
    }
    return URL.createObjectURL(await response.blob())
  } catch (error) {
    if (error instanceof ApiException) throw error
    if (controller.signal.aborted) throw new ApiException('MEDIA_TIMEOUT', 'Evidence loading timed out')
    throw new ApiException('MEDIA_UNAVAILABLE', 'Evidence could not be loaded')
  } finally {
    window.clearTimeout(timeout)
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadProctorMedia(sessionId: string, media: ProctorMedia): Promise<void> {
  const token = useAuthStore.getState().admin_token
  const response = await fetch(`/api/v1/proctoring/sessions/${sessionId}/media/${media.id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new ApiException('MEDIA_UNAVAILABLE', 'Evidence could not be downloaded')
  const extension = media.mime_type.startsWith('image/') ? 'jpg' : media.mime_type.startsWith('audio/') ? 'webm' : 'webm'
  downloadBlob(await response.blob(), `${media.kind.toLowerCase()}-${media.captured_at.replace(/[:.]/g, '-')}.${extension}`)
}

export async function downloadSubmission(sessionId: string): Promise<void> {
  const token = useAuthStore.getState().admin_token
  const response = await fetch(`/api/v1/reports/sessions/${sessionId}/submission`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new ApiException('DOWNLOAD_FAILED', 'Failed to download submitted code')
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `submission-${sessionId}.txt`
  downloadBlob(await response.blob(), filename)
}

export async function downloadPdfReport(sessionId: string): Promise<void> {
  const token = useAuthStore.getState().admin_token
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  let response: Response
  try {
    response = await fetch(`/api/v1/reports/sessions/${sessionId}/pdf?t=${Date.now()}`, { headers, cache: 'no-store' })
  } catch {
    throw new ApiException('NETWORK_ERROR', 'Network error - check your connection')
  }
  if (!response.ok) throw new ApiException('DOWNLOAD_FAILED', 'Failed to download PDF report')
  const blob = await response.blob()
  if (blob.size === 0) throw new ApiException('DOWNLOAD_FAILED', 'Downloaded PDF was empty')
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `report-${sessionId}.pdf`
  downloadBlob(blob, filename)
}

// ─── System config ────────────────────────────────────────────────────────────

export type SystemConfig = {
  openrouter_key_configured: boolean
}

export function getSystemConfig(): Promise<{ data: SystemConfig }> {
  return apiFetch('/admin/config')
}

export function saveOpenRouterKey(key: string): Promise<{ data: Record<string, never> }> {
  return apiFetch('/admin/config/openrouter-key', {
    method: 'POST',
    body: JSON.stringify({ key }),
  })
}
