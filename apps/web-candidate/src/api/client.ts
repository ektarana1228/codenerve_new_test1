import { useSessionStore } from '../store/session'

// ─── Error type ───────────────────────────────────────────────────────────────

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

/**
 * Wraps fetch with:
 * - JSON Content-Type header
 * - Automatic Bearer token from the Zustand session store
 * - Structured error throwing (ApiException on non-2xx)
 * - Dispatches a 'connection-lost' custom event on network-level failures
 *   (TypeError = no response) so ConnectionBanner can detect them
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useSessionStore.getState().token

  const headers: Record<string, string> = {
    // Only set Content-Type when we're actually sending a JSON body.
    // Fastify rejects Content-Type: application/json with an empty body.
    ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers as Record<string, string> | undefined ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  let response: Response

  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers })
  } catch (err) {
    // TypeError means a real network failure (no DNS, no connection, etc.)
    // Signal the ConnectionBanner to start its retry loop
    if (err instanceof TypeError) {
      window.dispatchEvent(new CustomEvent('connection-lost'))
    }
    throw err
  }

  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } | undefined
    try { body = await response.json() } catch { /* ignore parse errors */ }
    throw new ApiException(
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed with status ${response.status}`,
    )
  }

  return response.json() as Promise<T>
}

// ─── Typed endpoint wrappers ──────────────────────────────────────────────────

export type ProjectTask = {
  id: string
  order: number
  title: string
  description: string
  done_when: string[]
}

export type ProjectBrief = {
  template_info: string | null
  allowed_models: string[]
  connection_details: Array<{ label: string; value: string }>
  submission_files: Array<{ name: string; description: string }>
  tasks: ProjectTask[]
}

export type StartSessionResponse = {
  data: {
    access_token: string
    session_id: string
    time_remaining: number | null
    current_code?: string
    // 'CODING' (problem + test cases) | 'PROJECT' (task/deliverable based)
    kind?: 'CODING' | 'PROJECT'
    problems?: Array<{
      id: string
      title: string
      description: string
      difficulty: string
      allow_copy_paste: boolean
      solution_file?: string
      visible_test_cases: Array<{ id: string; input: string; expected: string }>
    }>
    problem: {
      id: string
      title: string
      description: string
      difficulty: string
      allow_copy_paste: boolean
      solution_file?: string
      visible_test_cases: Array<{ id: string; input: string; expected: string }>
    } | null
    project?: ProjectBrief | null
    assessment: {
      title: string
      time_limit_minutes: number
      language: string
      llm_model: string
      ai_assistant_mode?: 'AGENTIC' | 'NON_AGENTIC' | 'DISABLED'
      allowed_models?: string[]
      allow_copy_paste?: boolean
      proctoring: {
        screen_recording: 'OFF' | 'OPTIONAL' | 'REQUIRED'
        video_proctoring: 'OFF' | 'OPTIONAL' | 'REQUIRED'
        microphone_recording: 'OFF' | 'OPTIONAL' | 'REQUIRED'
        second_camera: 'OFF' | 'OPTIONAL' | 'REQUIRED'
      }
    }
  }
}

export type GetSessionResponse = {
  data: {
    session_id: string
    assessment_id: string
    status: string
    current_code: string
    time_remaining: number | null
    language: string
    started_at: string | null
    expires_at: string | null
  }
}

/** POST /api/v1/sessions/start - no auth required (public invite token) */
export async function startSession(
  inviteToken: string,
  candidateName: string | undefined,
  candidateEmail: string,
): Promise<StartSessionResponse> {
  return apiFetch('/sessions/start', {
    method: 'POST',
    body: JSON.stringify({
      token: inviteToken,
      candidate_name: candidateName || undefined,
      candidate_email: candidateEmail,
    }),
  })
}

export function activateSession(sessionId: string): Promise<{
  data: { access_token: string; started_at: string; expires_at: string }
}> {
  return apiFetch(`/sessions/${sessionId}/activate`, { method: 'POST' })
}

export function requestAdminAccount(payload: {
  email: string
  password: string
  fullName?: string
  companyName?: string
}): Promise<{ data: { id: string; email: string; status: string } }> {
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

export function checkProctoringConnection(payload: string): Promise<{ data: { received_bytes: number } }> {
  return apiFetch('/proctoring/connectivity', {
    method: 'POST',
    body: JSON.stringify({ payload }),
  })
}

export function logProctoringEvent(
  sessionId: string,
  source: 'SYSTEM' | 'DESKTOP' | 'MOBILE',
  type: string,
  metadata: Record<string, unknown> = {},
): Promise<{ data: { id: string; created_at: string } }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ source, type, metadata }),
  })
}

export function completeSystemCheck(
  sessionId: string,
  checks: Record<string, 'passed' | 'failed' | 'skipped'>,
  batchId?: string,
): Promise<{ data: { can_proceed: boolean } }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/checks/complete`, {
    method: 'POST',
    body: JSON.stringify({ checks, batch_id: batchId }),
  })
}

export function uploadProctoringScreenshot(
  sessionId: string,
  kind: 'SCREEN' | 'WEBCAM',
  image: string,
): Promise<{ data: { id: string; captured_at: string } }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/screenshots`, {
    method: 'POST',
    body: JSON.stringify({ kind, image }),
  })
}

export function uploadProctoringRecording(
  sessionId: string,
  kind: 'SCREEN_RECORDING' | 'WEBCAM_RECORDING' | 'MICROPHONE_RECORDING',
  mimeType: string,
  data: string,
): Promise<{ data: { id: string; captured_at: string } }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/recordings`, {
    method: 'POST',
    body: JSON.stringify({ kind, mime_type: mimeType, data }),
  })
}

export function createMobilePairing(sessionId: string): Promise<{ data: { pairing_url: string } }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/mobile-pairing`, { method: 'POST' })
}

export function getMobilePairing(sessionId: string): Promise<{ data: { paired: boolean; connected: boolean; last_seen_at: string | null } }> {
  return apiFetch(`/proctoring/sessions/${sessionId}/mobile-pairing`)
}

export async function connectMobileProctor(token: string): Promise<{ data: { session_id: string } }> {
  return mobileFetch('/proctoring/mobile/connect', token, { method: 'POST' })
}

export async function heartbeatMobileProctor(token: string): Promise<void> {
  await mobileFetch('/proctoring/mobile/heartbeat', token, { method: 'POST' })
}

export async function uploadMobileRecording(token: string, mimeType: string, data: string): Promise<void> {
  await mobileFetch('/proctoring/mobile/recordings', token, { method: 'POST', body: JSON.stringify({ mime_type: mimeType, data }) })
}

async function mobileFetch<T>(path: string, token: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    // Only send a JSON content-type when there's actually a body - Fastify rejects
    // application/json with an empty body (connect/heartbeat send none).
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Pairing ${token}`,
    },
  })
  if (!response.ok) {
    const message = await response.json().then((body) => body?.error?.message).catch(() => null)
    throw new Error(message ?? `Mobile proctoring request failed (${response.status})`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

/** GET /api/v1/sessions/:id - requires candidate JWT in store */
export async function getSession(sessionId: string): Promise<GetSessionResponse> {
  return apiFetch(`/sessions/${sessionId}`)
}

/** PATCH /api/v1/sessions/:id/code - auto-save candidate code */
export async function saveCode(sessionId: string, code: string): Promise<{ data: { saved_at: string } }> {
  return apiFetch(`/sessions/${sessionId}/code`, {
    method: 'PATCH',
    body: JSON.stringify({ code }),
  })
}

export async function exitSession(sessionId: string, code: string, remainingSeconds?: number | null): Promise<{ data: { remaining_seconds: number | null; resume_until: string } }> {
  return apiFetch(`/sessions/${sessionId}/exit`, {
    method: 'POST',
    body: JSON.stringify({ code, ...(typeof remainingSeconds === 'number' ? { remaining_seconds: remainingSeconds } : {}) }),
  })
}

/** POST /api/v1/llm/chat */
export async function sendChatMessage(prompt: string): Promise<{ data: { response: string; turn_number: number } }> {
  const sessionId = useSessionStore.getState().session_id
  return apiFetch('/llm/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt, session_id: sessionId }),
  })
}

/** POST /api/v1/llm/agent - agentic assistant that can edit the workspace. */
export async function sendAgentMessage(
  prompt: string,
  files: Record<string, string>,
  activeFile: string,
): Promise<{ data: { response: string; edits: Record<string, string>; turn_number: number } }> {
  return apiFetch('/llm/agent', {
    method: 'POST',
    body: JSON.stringify({ prompt, files, active_file: activeFile }),
  })
}

export type RunCodeResponse = {
  data: {
    status: 'completed' | 'timeout' | 'error'
    passed: number
    failed: number
    results: Array<{
      testCaseId: string
      status: 'pass' | 'fail' | 'error'
      stdout: string
      stderr: string
    }>
  }
}

/** POST /api/v1/sessions/:id/run - executes code against visible test cases */
export async function runCode(sessionId: string, problemId: string, code: string): Promise<RunCodeResponse> {
  return apiFetch(`/sessions/${sessionId}/run`, {
    method: 'POST',
    body: JSON.stringify({ code, problem_id: problemId }),
  })
}

// ─── VS Code orchestrator ─────────────────────────────────────────────────────

export type EnsureVscodeResponse = {
  data: { url: string; mode: 'docker' | 'stub'; read_only: boolean }
}

/**
 * POST /api/v1/vscode/sessions/:id/ensure - boot (or reuse) the session's VS Code
 * container, seeded from the durable code, and get the same-origin iframe URL.
 */
export async function ensureVscode(
  sessionId: string,
  theme: 'dark' | 'light',
): Promise<EnsureVscodeResponse> {
  return apiFetch(`/vscode/sessions/${sessionId}/ensure`, {
    method: 'POST',
    body: JSON.stringify({ theme }),
  })
}

/**
 * POST /api/v1/vscode/sessions/:id/flush - read the live workspace out of the
 * container into the durable Session.currentCode and return the serialized code.
 * Called before Run and before Submit so the server sees the latest edits.
 */
export async function flushVscode(
  sessionId: string,
): Promise<{ data: { code: string; saved_at: string } }> {
  return apiFetch(`/vscode/sessions/${sessionId}/flush`, { method: 'POST' })
}

export async function applyVscode(
  sessionId: string,
  code: string,
): Promise<{ data: { code: string; saved_at: string } }> {
  return apiFetch(`/vscode/sessions/${sessionId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

/** POST /api/v1/sessions/:id/submit - finalises the session */
export async function submitSession(sessionId: string): Promise<{ data: { submitted_at: string } }> {
  return apiFetch(`/sessions/${sessionId}/submit`, { method: 'POST' })
}

export type CandidateFeedbackPayload = {
  overall_experience: number
  instructions_clarity: number
  difficulty_relevance: number
  platform_usability?: number
  technical_performance: number
  coding_environment: number
  ai_assistant_usefulness: number
  ai_assistant_usage?: 'VERY_USEFUL' | 'SOMEWHAT_USEFUL' | 'NOT_USEFUL' | 'DID_NOT_USE' | 'WAS_NOT_AVAILABLE'
  proctoring_experience: number
  fairness?: number
  recommendation_score?: number
  assessment_name?: string
  task_where_issue_occurred?: string
  technical_issue_type?: string
  may_contact?: boolean
  comments?: string
}

export async function submitFeedback(sessionId: string, payload: CandidateFeedbackPayload): Promise<{ data: { saved: true } }> {
  return apiFetch(`/sessions/${sessionId}/feedback`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** POST /api/v1/sessions/:id/events - fire-and-forget event logging (never throws) */
export function logSessionEvent(sessionId: string, type: string): void {
  apiFetch(`/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  }).catch(() => {})
}
