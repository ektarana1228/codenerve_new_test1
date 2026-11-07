import { z } from 'zod'

// ─── Shared base ──────────────────────────────────────────────────────────────
// All backend services include these four variables.

const sharedSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
})

// ─── Per-service schemas ──────────────────────────────────────────────────────

// api-core - merged auth + assessment + reporting + proctoring service.
// Union of what those four services each used to require on their own.
export const apiCoreEnvSchema = sharedSchema.extend({
  PORT: z.coerce.number().int().positive().default(3101),
  // auth
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_BASE_URL: z.string().url().default('http://localhost:3000'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('assessments@apexcoder.io'),
  TEAM_EMAIL_FROM: z.string().default('team@apexcoder.io'),
  TEAM_SMTP_USER: z.string().default(''),
  TEAM_SMTP_PASS: z.string().default(''),
  // assessment
  SANDBOX_URL: z.string().url().default('http://localhost:3200'),
  // proctoring
  PROCTOR_RETENTION_HOURS: z.coerce.number().int().positive().default(96),
  GCS_BUCKET_NAME: z.string().default(''),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default(''),
  CANDIDATE_BASE_URL: z.string().url().default('http://localhost:3000'),
  OPENROUTER_ENCRYPTION_KEY: z
    .string()
    .length(64, 'OPENROUTER_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),
})

export const apiLlmGatewayEnvSchema = sharedSchema.extend({
  PORT: z.coerce.number().int().positive().default(3102),
  // AES-256 key: 32 bytes = 64 hex characters
  OPENROUTER_ENCRYPTION_KEY: z
    .string()
    .length(64, 'OPENROUTER_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),
})

// vscode-orchestrator - spins up one openvscode-server container per session
// and reverse-proxies the browser iframe (+ WebSocket) to it.
export const vscodeOrchestratorEnvSchema = sharedSchema.extend({
  PORT: z.coerce.number().int().positive().default(3104),
  // AES-256 key used to decrypt the saved OpenRouter key for PROJECT OpenCode sessions.
  OPENROUTER_ENCRYPTION_KEY: z
    .string()
    .length(64, 'OPENROUTER_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),
  // openvscode-server image used for CODING sessions and the default.
  VSCODE_IMAGE: z.string().default('gitpod/openvscode-server:1.102.3'),
  // PROJECT sessions use a purpose-built image: openvscode-server + the OpenCode
  // runtime + the OpenCode sidebar extension (see apps/vscode-orchestrator/
  // project.Dockerfile). Falls back to VSCODE_IMAGE when unset.
  VSCODE_PROJECT_IMAGE: z.string().default('aisd/openvscode-opencode:latest'),
  // PROJECT containers need outbound network to reach the model provider that
  // OpenCode calls. When set they join this (egress-capable) network instead of
  // the internal VSCODE_NETWORK. Empty → use VSCODE_NETWORK.
  VSCODE_PROJECT_NETWORK: z.string().default(''),
  // 'docker'  - real openvscode-server containers (production / Docker-enabled dev)
  // 'stub'    - dev-only in-process editor page, no Docker required
  VSCODE_MODE: z.enum(['docker', 'stub']).default('docker'),
  // When set, session containers join this user-defined Docker network and are
  // reached by container name (compose deployment). When empty, containers
  // publish to a random 127.0.0.1 port and are reached there (host dev).
  VSCODE_NETWORK: z.string().default(''),
  // Idle containers with no matching ACTIVE session are reaped after this many ms.
  VSCODE_REAP_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  // Per-container resource ceilings (mirrors the sandbox posture).
  VSCODE_MEMORY_MB: z.coerce.number().int().positive().default(512),
  VSCODE_CPU_QUOTA: z.coerce.number().int().positive().default(100000),
})

// Background worker - no HTTP port. Calls api-llm-gateway's internal judge
// route (shared-secret auth via JWT_SECRET) to score PROJECT submissions.
export const workerAiuEnvSchema = sharedSchema.extend({
  LLM_GATEWAY_URL: z.string().url().default('http://localhost:3102'),
})

// Sandbox runner - no DB/JWT, only Docker config
export const sandboxRunnerEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  SANDBOX_MEMORY_MB: z.coerce.number().int().positive().default(128),
  SANDBOX_CPU_QUOTA: z.coerce.number().int().positive().default(50000),
})

// ─── Inferred types ───────────────────────────────────────────────────────────

export type ApiCoreEnv = z.infer<typeof apiCoreEnvSchema>
export type ApiLlmGatewayEnv = z.infer<typeof apiLlmGatewayEnvSchema>
export type VscodeOrchestratorEnv = z.infer<typeof vscodeOrchestratorEnvSchema>
export type WorkerAiuEnv = z.infer<typeof workerAiuEnvSchema>
export type SandboxRunnerEnv = z.infer<typeof sandboxRunnerEnvSchema>
