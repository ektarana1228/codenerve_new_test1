# CLAUDE.md — AI Coding Interview / Assessment Platform

Read this fully before writing any code. This file is the implementation contract. `requirements.md` tells you what to build. This file tells you how to build it.

---

## What This Project Is

A web platform for AI-integrated coding assessments. Candidates solve problems in a browser IDE with an embedded AI assistant. The platform evaluates both code correctness and how the candidate used the AI. Two roles: **Student (Candidate)** and **Admin**.

---

## Monorepo Structure

```
/
├── apps/
│   ├── web-candidate/        # React + Vite — candidate IDE app
│   ├── web-admin/            # React + Vite — admin dashboard app
│   ├── api-core/             # Fastify — auth + assessment + reporting + proctoring
│   ├── api-llm-gateway/      # Fastify — LLM proxy + interaction logger
│   ├── vscode-orchestrator/  # Fastify — per-session VS Code container manager + reverse proxy
│   └── worker-aiu/           # Node.js background worker — AIU scoring
├── packages/
│   ├── types/                # Shared TypeScript types and Zod schemas
│   ├── db/                   # Prisma schema + generated client
│   ├── config/               # Shared env validation (Zod)
│   └── logger/               # Shared Pino logger config
├── sandbox/
│   ├── runner/               # Docker execution runner (per language)
│   └── dockerfiles/          # Python, Node Dockerfiles for sandbox
├── docker-compose.yml        # Local dev: all services + postgres + redis
├── turbo.json
├── requirements.md
└── CLAUDE.md
```

**Rules:**
- All shared TypeScript types live in `packages/types` — never duplicate type definitions across apps
- Prisma schema is the single source of truth for data shapes — always generate types from schema, never hand-write DB types
- Environment variables are validated with Zod in `packages/config` on startup — if a required env var is missing, the service crashes with a clear message

---

## Tech Stack — Quick Reference

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Data fetching | TanStack Query (React Query) |
| IDE component | Full VS Code (openvscode-server), embedded per-session via iframe (autocomplete disabled via locked settings) |
| Backend framework | Fastify (Node.js 20 LTS) + TypeScript |
| Validation | Zod (all inputs, all API contracts) |
| ORM | Prisma |
| Primary DB | PostgreSQL 16 |
| Cache / session state | Redis 7 |
| LLM provider | OpenRouter (`https://openrouter.ai/api/v1`) |
| Code sandbox | Docker (ephemeral containers) |
| PDF generation | Puppeteer |
| Logging | Pino (structured JSON) |
| Frontend testing | Vitest + React Testing Library |
| Backend testing | Jest + Supertest |
| Monorepo | Turborepo |
| Local dev | Docker Compose |

---

## Services — Ownership and Responsibilities

### api-core
Merged service (formerly separate api-auth / api-assessment / api-reporting / api-proctoring — all four shared one Postgres DB and had no real data-ownership boundary between them, so they were consolidated into one deployable; see `apps/api-core/src/app.ts` for the full route registration).
- **Auth**: issues JWT tokens (admin login, candidate session token), validates tokens, manages one-time invite tokens (generate, consume, expire)
- **Assessment**: session lifecycle (create, start, auto-save code, submit, expire), serves problem content, orchestrates code execution via the Docker sandbox runner, enforces hidden test case isolation, enqueues AIU scoring jobs
- **Reporting**: reads finalised session scores, generates per-candidate and batch PDF reports (Puppeteer), powers the leaderboard endpoint — read-only against score data
- **Proctoring**: system-check gating, behavioral event logging (tab/fullscreen/network), screenshot + video/audio evidence upload to GCS, second-camera mobile pairing, evidence retention/cleanup
- Owns: `users`, `invite_tokens`, `assessments`, `problems`, `test_cases`, `tasks`, `sessions`, `session_scores`, `mobile_pairings`, `proctor_events`, `proctor_media`
- No other service touches this data — they call api-core or verify the JWT signature locally

### api-llm-gateway
- Single proxy between client and OpenRouter
- Logs every prompt-response pair to `interaction_logs` table
- Enforces per-session rate limits (Redis counter)
- Retrieves encrypted OpenRouter API key from DB; decrypts in memory; never logs it
- Owns: `interaction_logs`

### vscode-orchestrator
- Launches and reaps one `openvscode-server` container per session (Docker socket)
- Seeds each container's `/home/workspace/project` from `Session.currentCode`
- Reverse-proxies the candidate iframe's HTTP + WebSocket traffic to the container
- Writes the locked-down VS Code settings layer (autocomplete off, no telemetry/terminal/marketplace) into every container
- Syncs the live workspace back to `Session.currentCode` (maintenance loop + `flush`) so Run/Submit read fresh code
- Reads `sessions`; writes only `sessions.currentCode`. Never executes candidate code.

### worker-aiu
- Background worker — not an HTTP service
- Pulls jobs from a Redis queue (Bull or BullMQ)
- Fetches interaction log for the session
- Runs all 4 AIU metric scorers
- Writes results to `session_scores`
- Triggers total score computation
- Target: complete within 30 seconds of job enqueue

---

## Database Schema

Prisma schema. All migrations committed to `packages/db/migrations/`.

```prisma
model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String?      // null for candidates (no password)
  role         Role
  createdAt    DateTime     @default(now())
  assessments  Assessment[] // admin only
  sessions     Session[]    // candidate only
}

enum Role {
  ADMIN
  STUDENT
}

model InviteToken {
  id           String    @id @default(uuid())
  token        String    @unique @default(uuid())
  assessmentId String
  assessment   Assessment @relation(fields: [assessmentId], references: [id])
  candidateName String   // admin-assigned label for the candidate slot
  candidateEmail String?
  usedAt       DateTime?
  expiresAt    DateTime  // now + 72 hours on creation
  createdAt    DateTime  @default(now())
}

model Assessment {
  id              String       @id @default(uuid())
  title           String
  description     String?
  createdBy       String
  admin           User         @relation(fields: [createdBy], references: [id])
  problems        Problem[]
  timeLimitMinutes Int
  language        Language
  llmModel        String       @default("openai/gpt-4o-mini")
  codeWeight      Int          // 0-100, must sum to 100 with aiuWeight
  aiuWeight       Int
  aiuMetrics      AiuMetric[]  // which metrics are active
  aiuMetricWeights Json        // { prompt_quality: 40, iteration_efficiency: 60 }
  status          AssessmentStatus @default(DRAFT)
  scheduledStart  DateTime?
  expiresAt       DateTime?
  createdAt       DateTime     @default(now())
  inviteTokens    InviteToken[]
  sessions        Session[]
}

enum AssessmentStatus {
  DRAFT
  SCHEDULED
  ACTIVE
  CLOSED
}

enum Language {
  PYTHON
  JAVASCRIPT
  TYPESCRIPT
}

enum AiuMetric {
  PROMPT_QUALITY
  ITERATION_EFFICIENCY
  INDEPENDENT_EDITING
  CONTEXTUAL_RELEVANCE
}

model Problem {
  id           String      @id @default(uuid())
  assessmentId String
  assessment   Assessment  @relation(fields: [assessmentId], references: [id])
  title        String
  description  String      // Markdown
  difficulty   Difficulty
  testCases    TestCase[]
  createdAt    DateTime    @default(now())
}

enum Difficulty {
  EASY
  MEDIUM
  HARD
}

model TestCase {
  id        String   @id @default(uuid())
  problemId String
  problem   Problem  @relation(fields: [problemId], references: [id])
  input     String
  expected  String
  isHidden  Boolean  @default(false)
  createdAt DateTime @default(now())
}

model Session {
  id           String        @id @default(uuid())
  assessmentId String
  assessment   Assessment    @relation(fields: [assessmentId], references: [id])
  candidateId  String
  candidate    User          @relation(fields: [candidateId], references: [id])
  language     Language
  status       SessionStatus @default(PENDING)
  currentCode  String        @default("")  // auto-saved continuously
  startedAt    DateTime?
  submittedAt  DateTime?
  expiresAt    DateTime?
  score        SessionScore?
  logs         InteractionLog[]
}

enum SessionStatus {
  PENDING
  ACTIVE
  SUBMITTED
  EXPIRED
}

model SessionScore {
  id                  String   @id @default(uuid())
  sessionId           String   @unique
  session             Session  @relation(fields: [sessionId], references: [id])
  codeCorrectnessScore Float   // 0-100
  aiuScores           Json     // { prompt_quality: 72, iteration_efficiency: 65, ... }
  aiuTotalScore       Float    // 0-100
  totalScore          Float    // 0-100
  scoredAt            DateTime @default(now())
}

model InteractionLog {
  id           String   @id @default(uuid())
  sessionId    String
  session      Session  @relation(fields: [sessionId], references: [id])
  turnNumber   Int
  promptText   String
  responseText String
  timestamp    DateTime @default(now())

  @@index([sessionId])
}

model SystemConfig {
  id              String   @id @default("singleton")
  openrouterKeyEncrypted String?  // AES-256 encrypted
  updatedAt       DateTime @updatedAt
}
```

---

## Authentication

### Admin Login

```
POST /api/v1/auth/login
Body: { email: string, password: string }
Response: { access_token: string }  // JWT, 8hr expiry

JWT payload: {
  sub: user_id,
  role: "ADMIN",
  iat, exp
}
```

### Candidate Session Start

```
POST /api/v1/sessions/start
Body: { token: string }   // one-time invite token
Response: {
  access_token: string,   // JWT scoped to this session
  session_id: string,
  problem: { id, title, description, visible_test_cases[] },
  assessment: { time_limit_minutes, language, llm_model }
}

JWT payload: {
  sub: user_id,
  role: "STUDENT",
  session_id: string,
  iat, exp
}
```

One-time tokens are single-use. Consuming the token creates the session and marks the token as used. A second request with the same token returns 401.

### Request Authentication

Every protected endpoint requires `Authorization: Bearer <token>` header. Services validate the JWT signature locally using the shared public key. They do not call the auth service on every request.

---

## Editor: Embedded VS Code (openvscode-server)

The candidate codes in a **full VS Code**, not the Monaco library. Each session gets
its own `openvscode-server` container, managed by **`apps/vscode-orchestrator`** and
embedded in the candidate app through a same-origin `<iframe>`.

### Architecture

```
web-candidate (iframe)
   └─ GET /vscode/:sessionId/*  ─┐   (HTTP + WebSocket)
                                 ▼
              vscode-orchestrator (Fastify, :3104)
                 ├─ reverse-proxies iframe traffic to the session container
                 ├─ POST /api/v1/vscode/sessions/:id/ensure  → boot/seed/reuse container
                 ├─ POST /api/v1/vscode/sessions/:id/flush   → workspace → Session.currentCode
                 └─ maintenance loop: sync workspaces → DB, reap on submit/expire
                                 ▼
              openvscode-server container (per session)
                 /home/workspace/project  ← candidate's files
```

- **Source of truth for code stays the DB.** The container filesystem is the live
  working copy; the orchestrator syncs it into `Session.currentCode` (same
  `{__multifile__, main, files}` envelope as before), so **Run/Submit/reconnection
  are unchanged** — they still read `currentCode`.
- **Run/Submit still route through the sandbox runner.** Code never executes inside
  the VS Code container. `flush` writes the workspace to the DB, then the existing
  `/run` and `/submit` paths feed it to the Docker sandbox. Hidden tests never enter
  the workspace.
- **Language** is fixed at session start and seeded as `solution.<ext>`. Do not allow
  language switching after start.
- **Theme** tracks the app (light/dark) and is applied at container boot; changing the
  app theme re-ensures the frame.
- **Read-only after submit** is enforced by `files.readonlyInclude: {"**": true}` in the
  workspace settings (re-applied by the orchestrator lock step) and a read-only reload.

### Autocomplete-off + lockdown (the settings layer)

Real VS Code ships IntelliSense **on**, so every suggestion lever is re-disabled in
`apps/vscode-orchestrator/src/lib/config-layer.ts` and written as workspace settings in
every container (`quickSuggestions`, `suggestOnTriggerCharacters`,
`acceptSuggestionOnEnter`, `tabCompletion`, `wordBasedSuggestions`, `parameterHints`,
`inlineSuggest`, `snippetSuggestions`, plus `typescript/javascript.suggest.enabled`).
The same file disables telemetry, workspace trust, extension auto-update, and the
marketplace. **If you touch that file, keep every suggestion setting disabled.**

### Accepted regressions vs. the old Monaco integration

These were signed off before the iframe migration — the editor now lives in a
cross-origin frame the parent app cannot instrument:

- **Clipboard copy/cut/paste blocking is NOT enforced.** `allow_copy_paste` and the
  per-problem clipboard gate no longer apply in the editor.
- **The >500-char large-paste guard is NOT enforced.**
- Restoring either would require patching/rebuilding VS Code itself.

Dev without Docker: set `VSCODE_MODE=stub` (or let the orchestrator auto-fall back) to
serve a minimal same-origin editor page that preserves the workspace/flush/sync flow.
It is **not** VS Code and has no isolation — dev only.

---

## Code Auto-Save

Auto-save runs two ways simultaneously:

1. **Interval save:** every 10 seconds, POST current editor content to assessment API
2. **Debounced save:** 2 seconds after the last keystroke, POST current editor content

```
PATCH /api/v1/sessions/:session_id/code
Headers: Authorization: Bearer <candidate_token>
Body: { code: string }
Response: { saved_at: string }  // ISO timestamp
```

The server writes `currentCode` on the Session record. On reconnection, the server returns the last saved code so the editor restores it. The client is never the source of truth for code content.

---

## LLM Gateway — Implementation Details

```
POST /api/v1/llm/chat
Headers: Authorization: Bearer <candidate_token>
Body: { prompt: string, session_id: string }
Response: { response: string, turn_number: number }
```

**Gateway flow:**
1. Validate candidate JWT and extract session_id
2. Check rate limit in Redis: `rate:llm:{session_id}` — max 60 requests per session (configurable)
3. Fetch encrypted OpenRouter key from DB → decrypt in memory
4. Forward request to OpenRouter with session conversation history as context
5. Log the prompt-response pair to `interaction_logs` (async — do not wait for DB write before returning)
6. Return response to client

**Never:**
- Log the OpenRouter API key
- Expose the OpenRouter API endpoint URL in any response
- Return raw OpenRouter error messages to the client (sanitise to generic "AI assistant error")

**Conversation context:**
Send the last 10 turns of the session as context to OpenRouter on each request. Do not send the full history beyond 10 turns — manages token cost and latency.

---

## Code Sandbox — Docker Runner

Each execution creates a fresh container, runs the code, captures output, and destroys the container.

```typescript
interface ExecutionRequest {
  language: 'python' | 'javascript' | 'typescript'
  code: string
  testCases: Array<{ id: string; input: string; expected: string; isHidden: boolean }>
}

interface ExecutionResult {
  status: 'completed' | 'timeout' | 'error'
  passed: number
  failed: number
  results: Array<{
    testCaseId: string
    status: 'pass' | 'fail' | 'error'
    stdout: string
    stderr: string
    // isHidden is NOT included in the response — stripped before returning to client
  }>
}
```

**Container configuration:**
```
Memory limit:   128MB
CPU limit:      0.5 cores
Network:        none (--network none)
Wall clock:     10 seconds (SIGKILL after timeout)
Volume mounts:  none
User:           non-root (uid 1000)
```

**Before returning results to the client:**
- Strip `isHidden: true` test cases from the result array
- Strip test case `id` values for hidden tests
- For hidden test failures, return only the count — no input/output shown

---

## AIU Scoring — Implementation

The worker runs after session submission. It reads the full interaction log and computes 4 scores.

### prompt_quality

```typescript
function scorePromptQuality(logs: InteractionLog[]): number {
  // Signals that increase score:
  // - Average prompt length > 50 chars
  // - Prompt references prior context (detects overlap with previous prompts)
  // - Prompt contains constraint keywords (numbers, specific requirements)
  // - Prompt quality improves over time (later prompts score higher than earlier)

  // Signals that decrease score:
  // - Prompt is identical or near-identical (<5 word difference) to a prior prompt
  // - Prompt length < 20 chars
  // - Prompt appears to be a direct copy of the problem statement

  // Return 0-100
}
```

### iteration_efficiency

```typescript
const BASELINES = { EASY: 3, MEDIUM: 6, HARD: 10 }

function scoreIterationEfficiency(
  logs: InteractionLog[],
  difficulty: Difficulty,
  codeCorrectnessScore: number
): number {
  if (codeCorrectnessScore < 50) return 0  // no credit if solution doesn't work
  const actual = logs.length
  const baseline = BASELINES[difficulty]
  return Math.max(0, Math.min(100, 100 - ((actual - baseline) * 10)))
}
```

### independent_editing

```typescript
function scoreIndependentEditing(
  logs: InteractionLog[],
  finalCode: string
): number {
  // For each AI response, extract code blocks
  // Compute how many lines of finalCode appear verbatim from AI responses
  // acceptance_ratio = matched_lines / total_lines_in_final_code
  // score = (1 - acceptance_ratio) * 100
  // Return 0-100
}
```

### contextual_relevance

```typescript
const HIGH_VALUE_PATTERNS = [
  /write.*test/i, /generate.*boilerplate/i, /syntax for/i,
  /how do i/i, /what is the/i, /explain/i, /document/i
]
const LOW_VALUE_PATTERNS = [
  /solve this/i, /write the.*function/i, /complete this/i,
  /give me the.*solution/i, /write the entire/i
]

function scoreContextualRelevance(logs: InteractionLog[]): number {
  let highValue = 0
  let lowValue = 0
  for (const log of logs) {
    if (HIGH_VALUE_PATTERNS.some(p => p.test(log.promptText))) highValue++
    else if (LOW_VALUE_PATTERNS.some(p => p.test(log.promptText))) lowValue++
  }
  const total = logs.length || 1
  return Math.round(((highValue) / total) * 100)
}
```

These are heuristic v1 implementations. They will be imperfect. Ship them, collect real session data, then iterate. Do not over-engineer the scoring logic before you have real data.

---

## API Response Shapes

All API responses follow these shapes. Never deviate.

**Success:**
```json
{
  "data": { ... }
}
```

**Success (list):**
```json
{
  "data": [ ... ],
  "next_cursor": "string_or_null"
}
```

**Error:**
```json
{
  "error": {
    "code": "SNAKE_CASE_ERROR_CODE",
    "message": "Human-readable message safe to show in UI"
  }
}
```

**Common error codes:**
```
UNAUTHORIZED          — missing or invalid JWT
FORBIDDEN             — valid JWT but insufficient role
NOT_FOUND             — resource doesn't exist or not accessible to this role
VALIDATION_ERROR      — request body failed Zod validation
SESSION_EXPIRED       — session time limit exceeded
TOKEN_USED            — invite token already consumed
TOKEN_EXPIRED         — invite token past 72hr TTL
RATE_LIMITED          — LLM requests exceeded per-session limit
EXECUTION_TIMEOUT     — code execution exceeded 10s wall clock
SUBMISSION_LOCKED     — session already submitted
```

---

## Environment Variables

Each service has its own `.env`. Validated at startup with Zod — missing vars crash the service with a clear message.

**Shared across services:**
```
DATABASE_URL          postgresql://user:pass@localhost:5432/platform
REDIS_URL             redis://localhost:6379
JWT_SECRET            (min 32 chars)
NODE_ENV              development | production
```

**api-llm-gateway:**
```
OPENROUTER_ENCRYPTION_KEY   (AES-256 key, 32 bytes hex)
```

**sandbox runner:**
```
DOCKER_SOCKET         /var/run/docker.sock
SANDBOX_TIMEOUT_MS    10000
SANDBOX_MEMORY_MB     128
SANDBOX_CPU_QUOTA     50000
```

---

## Session Reconnection

On network drop:
1. Client detects WebSocket or HTTP failure
2. Client shows "Reconnecting…" banner — does not block editor interaction
3. Client retries connection every 3 seconds for 60 seconds
4. On reconnect: client fetches `/api/v1/sessions/:id` which returns current session state including last saved code, time remaining, and interaction log summary
5. Client restores editor content from server response — never trusts local state

If reconnection fails after 60 seconds:
- Show: "Connection lost. Please refresh the page. Your code is saved and your timer is still running."
- On page reload: same reconnection flow — session token still valid, code still in DB

---

## Hard Rules — Never Violate

**Hidden test cases never reach the client.** Not in problem load, not in execution results, not in error messages, not in logs. Any code path that could expose hidden test content to the browser is a bug.

**OpenRouter API key never appears in logs, responses, or error messages.** If you are writing code that handles this key, make sure it is decrypted in memory only and discarded immediately after use.

**AIU scores are never shown to candidates.** Not the total score, not individual metric scores, not a pass/fail indication. The candidate sees "Assessment submitted."

**Autocomplete stays off.** Every VS Code suggestion setting is disabled in `apps/vscode-orchestrator/src/lib/config-layer.ts` and written into each session container. Do not re-enable any suggestion feature there or ship an extension that provides completions. If VS Code enables one by default, add it to the disabled set.

**Code executes only in the sandbox runner — never in the VS Code container.** The VS Code container is an editor, not an execution environment. Run/Submit always flush the workspace to the DB and run through the Docker sandbox (network none, ephemeral, resource-capped).

**Clipboard/large-paste blocking is a known gap under embedded VS Code.** These guards from the old Monaco editor are not enforced in the iframe (see "Accepted regressions"). Do not claim they are enforced; if the product needs them back, it requires patching VS Code, not a settings change.

**JWT role claims are the authority for access control.** Do not fetch the user from the DB on every request to re-check the role. Verify the JWT signature; trust the role claim.

**AIU metric weights must sum to 100 server-side.** Validate in the assessment creation endpoint with Zod. Reject with `VALIDATION_ERROR` if they don't. Do not silently normalise.

**Code auto-save writes to DB, not just Redis.** Redis holds the live session state. The DB holds the durable code. Both must be consistent. If they diverge, DB wins on reconnection.

---

## What to Build First

In this order:

1. `packages/db` — Prisma schema + migration + generated client
2. `packages/types` — Shared Zod schemas matching DB models
3. `api-core` (auth + assessment routes) — JWT issuance, invite token generation, session creation, code auto-save, problem serving
4. `apps/web-candidate` — Monaco IDE, AI chat panel, submit flow
5. `api-llm-gateway` — OpenRouter proxy + interaction logging
6. `worker-aiu` — AIU scoring pipeline
7. `sandbox/runner` — Docker execution runner
8. `api-core` (reporting routes) — Score reports + PDF
9. `apps/web-admin` — Assessment authoring, reports, leaderboard

Do not start 4 before 3 is working. The candidate app has no value without auth and session management behind it.
