# AI Coding Interview / Assessment Platform
## Product Requirements Document

**Version:** 2.0
**Status:** Draft
**Source:** Group 12 Proposal — AI Coding: Modern Software Development
**Institution:** Technical University of Munich, Heilbronn
**Last Updated:** May 2026

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Scope of Work](#2-scope-of-work)
3. [User Roles](#3-user-roles)
4. [Tech Stack](#4-tech-stack)
5. [System Architecture](#5-system-architecture)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [AI Usage Evaluation (AIU)](#8-ai-usage-evaluation-aiu)
9. [Scoring Metrics](#9-scoring-metrics)
10. [Assessment Session Flow](#10-assessment-session-flow)
11. [Error States](#11-error-states)
12. [API Design Principles](#12-api-design-principles)
13. [Data Retention and Privacy](#13-data-retention-and-privacy)

---

## 1. Problem Statement

The current online assessment (OA) process for SDE roles is broken in the following ways:

- **Only DSA-based rounds** — tests algorithm recall, not real engineering ability
- **100s of candidates to assess** — scale makes manual review infeasible
- **Undetectable cheating** — platforms like LeetCode and HackerRank only monitor screen activity and tab changes; candidates bypass this using AI through a phone camera
- **Mostly unproctored** — no reliable signal that the work belongs to the candidate

### Typical Interview Process

```
Stage 1          Stage 2           Stage 3       Stage 4
Online           Technical         HR
Assessment  →    Round         →   Round     →   …
     ↑
  Integrate AI here
```

The platform targets Stage 1 — replacing or augmenting the existing OA with an AI-aware evaluation layer.

---

## 2. Scope of Work

- **Multi-role web application** — Student (candidate) and Admin workflows
- **Problem authoring and assessment management** — admin tooling
- **Browser-based IDE** — Monaco editor, Python and JS/TS, autocomplete disabled
- **Sandboxed code execution** — Docker-based, fully isolated
- **Automated evaluation** — code correctness via test cases + AI usage via AIU engine
- **Structured performance reports** — per-candidate and batch, downloadable as PDF
- **Leaderboard** — top-X candidates per assessment batch

---

## 3. User Roles

### 3.1 Student (Candidate)

Job applicant taking a coding assessment. Accesses the platform via a one-time link copied to them by the admin. Interacts with the browser IDE and embedded AI assistant.

### 3.2 Admin

Hiring team member. Creates and manages assessments, generates and copies candidate invite links, configures AIU metric weights, views reports and leaderboard. Provides the OpenRouter API key in the admin settings panel.

---

## 4. Tech Stack

### 4.1 Frontend

| Concern | Choice | Reason |
|---|---|---|
| Framework | React 18 | Component model fits IDE + chat panel layout |
| Build tool | Vite | Fastest dev server; standard for React in 2026 |
| Language | TypeScript | Type safety across shared models |
| IDE component | Monaco Editor | Industry standard browser IDE; VSCode core |
| Autocomplete | Disabled | Removes confounding variable in assessment |
| Styling | Tailwind CSS | Utility-first; no stylesheet sprawl |
| State management | Zustand | Lightweight, no boilerplate; fits session state model |
| Data fetching | TanStack Query | Cache management, background sync, retry logic |
| Testing | Vitest + React Testing Library | Vite-native test runner |
| Monorepo tooling | Turborepo | Shared types, parallel builds, caching |

### 4.2 Backend

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20 LTS | Consistent with frontend TypeScript; large ecosystem |
| Framework | Fastify | 2× throughput vs Express; built-in schema validation; Pino logging native |
| Language | TypeScript | Shared types with frontend via monorepo |
| ORM | Prisma | Type-safe queries; schema as source of truth; migrations built in |
| Validation | Zod | Runtime schema validation on all API inputs; pairs with Prisma types |
| API contract | OpenAPI 3.1 | All endpoints documented; contract-first development |
| Logging | Pino | Fastify-native; structured JSON; high performance |
| Testing | Jest + Supertest | API integration testing |

### 4.3 Code Execution

| Concern | Choice |
|---|---|
| Sandbox | Docker (ephemeral containers per execution) |
| Languages | Python 3.11, JavaScript (Node.js 20), TypeScript (ts-node) |
| Language selection | Candidate picks once at session start — cannot switch mid-assessment |
| Resource limits | CPU: 0.5 core, Memory: 128MB, Wall clock: 10 seconds |

### 4.4 LLM

| Concern | Choice |
|---|---|
| Provider | OpenRouter (`https://openrouter.ai/api/v1`) |
| API key management | Admin enters key once in admin settings panel; stored encrypted in DB |
| Model | Configurable per assessment by admin (OpenRouter model string) |
| Default model | `openai/gpt-4o-mini` (cost-efficient default; admin can override) |

### 4.5 Data

| Concern | Choice |
|---|---|
| Primary database | PostgreSQL 16 |
| ORM | Prisma |
| Session state | Redis 7 |
| Interaction logs | PostgreSQL (append-only table, separate from primary tables) |
| PDF generation | Puppeteer (renders HTML report template to PDF) |

### 4.6 Infrastructure

| Concern | Choice |
|---|---|
| Local dev | Docker Compose (all services + DB + Redis in one `docker compose up`) |
| Production target | Kubernetes-ready (each service containerised independently) |
| Monorepo structure | Turborepo |
| Environment config | `.env` files per service; never committed; `.env.example` committed |

---

## 5. System Architecture

Layered Microservice Architecture — 4 independent backend services behind an API Gateway.

```
┌───────────────────────────────────────────────────────────────┐
│                          CLIENT                               │
│   ┌────────────────────────────┐  ┌─────────────────────────┐ │
│   │  Candidate App             │  │  Admin App              │ │
│   │  React + Vite              │  │  React + Vite           │ │
│   │  Monaco IDE + AI Chat      │  │  Dashboard + Authoring  │ │
│   └────────────────────────────┘  └─────────────────────────┘ │
└────────────────────────┬──────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼──────────────────────────────────────┐
│                     API GATEWAY                               │
│          Rate limiting · Request routing · TLS termination    │
└───┬──────────────────┬────────────────┬────────────────┬──────┘
    │                  │                │                │
┌───▼──────┐  ┌────────▼───────┐  ┌────▼──────────┐  ┌──▼──────────────┐
│  Auth    │  │ Assessment API │  │  LLM Gateway  │  │  Reporting      │
│  Service │  │ (Core Backend) │  │  Proxy + Log  │  │  Service        │
│ JWT+RBAC │  │                │  │               │  │  Scores + PDF   │
└──────────┘  └────────┬───────┘  └───────────────┘  └─────────────────┘
                       │
          ┌────────────┴──────────────┐
          │                           │
┌─────────▼──────┐         ┌──────────▼──────────────┐
│  Code Sandbox  │         │  AIU Scoring Worker      │
│  Docker Runner │         │  Background job          │
└────────────────┘         └─────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                       DATA LAYER                              │
│  PostgreSQL 16          Redis 7           (Docker volumes)    │
│  - users                - session state                       │
│  - assessments          - token cache                         │
│  - problems             - rate limit counters                 │
│  - sessions                                                   │
│  - scores                                                     │
│  - interaction_logs                                           │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                       EXTERNAL                                │
│              OpenRouter API (LLM provider)                    │
└───────────────────────────────────────────────────────────────┘
```

---

## 6. Functional Requirements

### 6.1 Priority Table

| # | Requirement | Priority |
|---|---|---|
| FR-01 | Multi-Role Authentication (JWT + RBAC) | Must Have |
| FR-02 | Assessment Management | Must Have |
| FR-03 | Browser-Based IDE + Sandboxed Execution | Must Have |
| FR-04 | AI Assistant Integration (OpenRouter) | Must Have |
| FR-05 | Automated Test Evaluation | Must Have |
| FR-06 | AI Usage Performance Evaluation (AIU) | Must Have |
| FR-07 | Performance Reports (PDF) | Must Have |
| FR-08 | Leaderboard / Top X Candidates | Should Have |
| FR-09 | System Compatibility Pre-Check | Could Have |
| FR-10 | Screen and/or Video Proctoring | Could Have |

---

### FR-01 — Multi-Role Authentication

- JWT-based login for admin; one-time token link for candidates
- Admin tokens: 8-hour expiry, refreshable
- Candidate session tokens: scoped to single session, expire on submission or session time expiry
- One-time invite tokens: 72-hour TTL, single-use, UUID-v4
- Admin generates invite link from the assessment management panel — copies it manually to share with candidate
- RBAC enforced at API Gateway and re-validated per service
- MFA: not required for v1

### FR-02 — Assessment Management

Admin must be able to:
- Create assessments: title, description, problem(s), time limit, language, LLM model, AIU metric configuration
- Edit draft assessments; cannot edit once any candidate has started
- Generate per-candidate invite links from the assessment panel (one link per candidate slot)
- View assessment status: draft / scheduled / active / closed
- Schedule assessments with a defined open window (start datetime + expiry datetime)
- Archive closed assessments

**Problem authoring:**
- Problem statement written in Markdown with live preview
- Test cases defined as input/output pairs — admin enters manually in a structured form
- Minimum 1 visible test case and 1 hidden test case required before a problem can be published
- Supported test case input types: stdin string, JSON object

### FR-03 — Browser-Based IDE and Sandboxed Code Execution

**IDE (Monaco Editor):**
- Syntax highlighting for Python, JavaScript, TypeScript
- Autocomplete: disabled entirely — no IntelliSense, no inline suggestions
- Keybindings: VSCode default
- Theme: dark (non-negotiable for extended assessment use)
- Code auto-saves to server every 10 seconds and on every meaningful edit (debounced 2s)
- Candidate cannot paste content larger than 500 characters in a single paste event — paste is blocked and logged

**Language selection:**
- Candidate selects language once at session start before the IDE loads
- Cannot change language after selection — selection is locked for the session

**Code Execution:**
- "Run" button executes against visible test cases only — result shown inline
- "Submit" button executes against all test cases (visible + hidden) — triggers session scoring
- Each execution runs in a fresh ephemeral Docker container
- Resource limits per execution: CPU 0.5 core, Memory 128MB, Wall clock 10 seconds
- Execution result returned: `{ status, passed, failed, results: [{ test_id, status, stdout, stderr }] }`
- Hidden test case IDs and content stripped from response before reaching client

**Submission:**
- Candidate explicitly clicks "Submit" to end the session
- On time expiry: 5-minute warning shown as countdown banner; on expiry, current code auto-submits and session locks
- After submission (manual or auto): IDE becomes read-only; AI chat panel closes

### FR-04 — AI Assistant Integration

- AI chat panel displayed alongside IDE during active session
- Candidate types natural language prompts; responses rendered in chat panel with Markdown support
- All requests routed through LLM Gateway — client never calls OpenRouter directly
- Admin provides OpenRouter API key once in admin settings; stored AES-256 encrypted in DB
- Model is configurable per assessment (admin sets OpenRouter model string when creating assessment)
- Default model: `openai/gpt-4o-mini`
- AI chat history visible to candidate within their session
- After submission: AI chat panel is closed and locked

### FR-05 — Automated Test Evaluation

- On "Run": execute visible test cases; return results to candidate immediately
- On "Submit": execute all test cases; store hidden test results server-side
- Code correctness score = hidden test cases passed / total hidden test cases × 100
- Execution results for visible tests shown to candidate immediately
- Hidden test results never exposed to candidate at any point

### FR-06 — AI Usage Performance Evaluation (AIU)

See Section 8 for full AIU specification.

- AIU scoring runs as a background job after submission — not synchronously
- Score is available in admin dashboard within 30 seconds of submission
- Candidate is shown "Assessment submitted. Results are being processed." — no score shown to candidate ever

### FR-07 — Performance Reports

**Per-candidate report contains:**
- Candidate identifier (name or email — admin-defined when generating invite)
- Assessment name and date
- Language used
- Total score
- Code correctness score with visible/hidden test breakdown
- AIU score broken down per active metric with weightage shown
- Time taken (session start to submission)
- Interaction turn count

**Batch report contains:**
- All candidates in the assessment
- Ranked by total score
- Per-candidate score summary row
- Assessment configuration summary (weights, model, time limit)

Both reports downloadable as PDF from the admin dashboard. PDF rendered via Puppeteer from an HTML template.

### FR-08 — Leaderboard

- Admin view of all candidates in a batch ranked by total score
- Top X configurable (default: Top 10)
- Tie-breaking: higher code correctness score ranks first; if still tied, earlier submission time ranks first
- Updated in real time as sessions score
- Exportable as CSV

### FR-09 — System Compatibility Pre-Check (Could Have)

Before assessment starts:
- Browser version check (Chrome 110+, Firefox 110+, Edge 110+)
- Stable network check (WebSocket connection test)
- Candidate cannot proceed until all checks pass
- Failed check shows specific remediation message per item

### FR-10 — Screen and/or Video Proctoring (Could Have)

- Webcam capture and screen recording during session
- Stored server-side; accessible to admin only
- Candidate must explicitly consent before session starts
- No automated proctoring decisions — recording is for admin review only

---

## 7. Non-Functional Requirements

| # | Requirement | Specification |
|---|---|---|
| NFR-01 | LLM response time | < 5–7 seconds for 90% of requests |
| NFR-02 | Code execution time | < 3–4 seconds for 90% of submissions |
| NFR-03 | Sandbox isolation | Zero host system access; ephemeral containers; no network egress |
| NFR-04 | Session resilience | Auto-reconnect on network interruption; restore from Redis without data loss |
| NFR-05 | Code auto-save | Every 10 seconds + debounced on edit; no code lost on browser close |
| NFR-06 | API response time | < 200ms p99 for non-LLM, non-execution endpoints |
| NFR-07 | Concurrent sessions | Support 500 simultaneous active candidate sessions without degradation |
| NFR-08 | Pagination | All list endpoints use cursor-based pagination; no offset pagination |
| NFR-09 | Structured logging | All services emit structured JSON logs via Pino; no unstructured console output in production |
| NFR-10 | Environment config | No secrets in code or version control; all secrets via environment variables |

---

## 8. AI Usage Evaluation (AIU)

The AIU module evaluates how the candidate used the AI assistant. It is the core differentiator from existing assessment platforms.

### 8.1 Metrics

| # | Metric Key | Description |
|---|---|---|
| 1 | `prompt_quality` | Clarity, specificity, and improvement trajectory of prompts over the session |
| 2 | `iteration_efficiency` | Number of AI turns required to reach a working solution; normalised by problem difficulty |
| 3 | `independent_editing` | Ratio of code written/modified by candidate versus accepted directly from AI |
| 4 | `contextual_relevance` | Whether AI was used for appropriate subtasks vs core logic the candidate should own |

### 8.2 Admin Configuration

- Admin selects any or all 4 metrics when creating an assessment
- Admin assigns a percentage weight to each selected metric
- Weights across selected metrics must sum to 100%
- The AIU portion vs code correctness portion is also admin-set (e.g. 60% code / 40% AIU)
- Both `code_weight + aiu_weight` must equal 100 — validated server-side on save

### 8.3 Score Formula

```
aiu_total   = Σ (metric_score[i] × aiu_metric_weight[i])
total_score = (code_correctness × code_weight / 100)
            + (aiu_total × aiu_weight / 100)
```

### 8.4 Metric Scoring Logic

**prompt_quality (0–100)**
Computed from the interaction log. Scores increase for:
- Prompts that include specific constraints or context
- Prompts that improve after receiving an inadequate response
- Prompts that reference prior conversation context
Scores decrease for:
- Copy-pasted problem statement as the prompt
- Identical or near-identical repeated prompts
- Single-word or single-line prompts throughout the session

**iteration_efficiency (0–100)**
Turn count to reach a passing solution, normalised against the problem's difficulty baseline.
- Easy: baseline 3 turns. Medium: baseline 6 turns. Hard: baseline 10 turns.
- Score = max(0, 100 − ((actual_turns − baseline) × 10))
- Capped at 100 for under-baseline performance

**independent_editing (0–100)**
At each point where the candidate accepts an AI code suggestion, the code diff is tracked.
- Lines accepted unchanged from AI / total lines in final submission = acceptance_ratio
- Score = (1 − acceptance_ratio) × 100
- 100% original code = 100. 100% unmodified AI code = 0.

**contextual_relevance (0–100)**
Heuristic classification of what each prompt was asking AI to do:
- High-value AI use: boilerplate, syntax, test generation, documentation → score contribution: high
- Low-value AI use: "solve this problem", "write the entire function for X" → score contribution: low
- Score = (high_value_turns / total_turns) × 100

### 8.5 AIU Scoring Pipeline

```
Session submitted
       ↓
AIU Scoring Worker picks up job from queue
       ↓
Fetch interaction log for session from DB
       ↓
Run all 4 metric scorers in parallel
       ↓
Apply admin-configured weights
       ↓
Write aiu_scores to SessionScore record
       ↓
Trigger total_score computation
       ↓
Mark session as fully scored
       ↓
Notify Reporting Service (webhook)
```

Target: scoring pipeline completes within 30 seconds of submission.

---

## 9. Scoring Metrics

### 9.1 Score Composition

| Component | Description | Weight |
|---|---|---|
| Code Correctness | Hidden test case pass rate (0–100) | Admin-configured |
| AI Usage (AIU) | Weighted composite of active AIU metrics (0–100) | Admin-configured |

### 9.2 Score Visibility

| Audience | Visible |
|---|---|
| Candidate | Visible test case run results only — during session. No score shown at any point. |
| Admin | Full breakdown: code score, per-metric AIU scores, total score, batch rank |

### 9.3 Tie-Breaking

When two candidates have identical total scores:
1. Higher code correctness score ranks first
2. If still tied: earlier submission timestamp ranks first

---

## 10. Assessment Session Flow

```
Admin creates assessment
         ↓
Admin generates invite link per candidate
         ↓
Admin copies and shares link manually
         ↓
Candidate opens link → system check (if FR-09 enabled)
         ↓
Candidate selects language
         ↓
Candidate reads problem statement
         ↓
Session timer starts
         ↓
Candidate codes in IDE + uses AI chat
Code auto-saves every 10s
         ↓
Candidate clicks "Run" → visible test cases execute
         ↓
Candidate clicks "Submit" → all test cases execute
OR
Timer expires → 5-minute warning → auto-submit on expiry
         ↓
IDE + AI chat lock (read-only)
         ↓
Code correctness score computed immediately
AIU scoring job queued → completes within 30s
         ↓
Total score written to DB
Admin dashboard updates
Leaderboard updates
         ↓
Admin views report + downloads PDF
```

---

## 11. Error States

Every error state must show the candidate a specific, non-technical message. No stack traces, no HTTP status codes in the UI.

| Error | Candidate Sees | System Behaviour |
|---|---|---|
| LLM API timeout (>7s) | "AI assistant is taking longer than usual. Please try again." | Request retried once; if second attempt fails, error shown. Session continues unaffected. |
| LLM API unavailable | "AI assistant is temporarily unavailable. Your session continues — you can still code." | AI panel shows disabled state. Session timer continues. Interaction log records outage window. |
| Code execution timeout | "Your code exceeded the time limit (10s). Check for infinite loops." | Container killed. Result returned as timeout failure. |
| Code execution error | "Your code encountered a runtime error." + stderr shown | Execution result stored. Session unaffected. |
| Session disconnection | "You've been disconnected. Reconnecting…" | Auto-reconnect from Redis state. If reconnect fails after 60s: "Please refresh the page. Your code is saved." |
| Invite link expired | "This assessment link has expired. Please contact the hiring team." | 401 returned. Token invalidated. |
| Invite link already used | "This assessment link has already been used." | 401 returned. |
| Session time expired | "Time's up. Your work has been submitted automatically." | Auto-submit triggered. IDE locked. |
| Duplicate submission | Blocked — submit button disabled after first submission | 409 returned if attempted via API directly. |

---

## 12. API Design Principles

- All endpoints follow REST conventions
- All request and response bodies are JSON
- All list endpoints use cursor-based pagination: `{ data: [], next_cursor: string | null }`
- All timestamps are ISO 8601 UTC
- Error responses follow a consistent shape: `{ error: { code: string, message: string } }`
- API versioned under `/api/v1/`
- Full OpenAPI 3.1 spec maintained and committed to repo
- No endpoint exposes hidden test case content to non-admin roles under any circumstances

---

## 13. Data Retention and Privacy

| Data | Retention | Notes |
|---|---|---|
| Interaction logs | 12 months | Deleted after 12 months; used for AIU scoring and admin review only |
| Session code submissions | 12 months | Admin-accessible; never shown to other candidates |
| PDF reports | Until admin deletes assessment | Stored server-side; downloadable on demand |
| Candidate email/name | Duration of assessment + 12 months | Used only for report labelling |
| OpenRouter API key | Until admin removes it | Stored AES-256 encrypted; never logged |
| JWT tokens | Session duration only | Not persisted; Redis TTL matches token expiry |

---

*End of Document*
