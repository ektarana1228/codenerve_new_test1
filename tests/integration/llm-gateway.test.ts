/**
 * LLM gateway integration tests
 *
 * Real DB + real Redis (DB 1). OpenRouter's external HTTP call is replaced by
 * a jest.spyOn on global.fetch so tests run offline and never leak the API key.
 *
 * Tests cover:
 *   - 60 requests succeed, 61st returns 429 RATE_LIMITED
 *   - Interaction log count in DB equals the number of successful requests
 *   - Response body never contains the plaintext API key (Hard Rule)
 *   - Mocked OpenRouter timeout → 504 LLM_TIMEOUT
 */

import Fastify, { type FastifyInstance } from 'fastify'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import { Redis } from 'ioredis'
import { PrismaClient } from '@prisma/client'
import { createTestDb, cleanDb, seedFixtures, type Fixtures, waitForLogs } from './helpers/db'
import { encryptApiKey } from '../../apps/api-llm-gateway/src/lib/crypto'

import { llmRoutes } from '../../apps/api-llm-gateway/src/routes/llm'
import { adminRoutes } from '../../apps/api-llm-gateway/src/routes/admin'
import { makeAuthHooks } from '../../apps/api-llm-gateway/src/plugins/authenticate'

// ── Constants ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET!
const ENCRYPTION_KEY = process.env.OPENROUTER_ENCRYPTION_KEY!
const PLAINTEXT_API_KEY = 'sk-integration-test-key-do-not-use'
const RATE_LIMIT_MAX = 60

// ── App builder ────────────────────────────────────────────────────────────

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  const env = {
    JWT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
    NODE_ENV: 'test' as const,
    PORT: 3102,
    OPENROUTER_ENCRYPTION_KEY: ENCRYPTION_KEY,
  }
  app.register(llmRoutes, { env, authHooks })
  app.register(adminRoutes, { env, authHooks })
  return app
}

// ── Test state ──────────────────────────────────────────────────────────────

let db: PrismaClient
let fixtures: Fixtures
let app: FastifyInstance
let redis: Redis
let fetchSpy: jest.SpyInstance

/** Helper: POST /llm/chat with the session's candidate token. */
function chatRequest(candidateToken: string, prompt = 'How do I write a loop?') {
  return supertest(app.server)
    .post('/api/v1/llm/chat')
    .set('Authorization', `Bearer ${candidateToken}`)
    .send({ prompt })
}

/** Signs a candidate JWT bound to sessionId. */
function makeCandidateToken(userId: string, sessionId: string): string {
  return jwt.sign(
    { sub: userId, role: 'STUDENT', session_id: sessionId },
    JWT_SECRET,
    { expiresIn: '2h' },
  )
}

/** Standard mock fetch response that looks like a successful OpenRouter completion. */
function successFetch(response = 'Here is how you do it.') {
  return Promise.resolve({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: response } }],
    }),
  })
}

beforeAll(async () => {
  db = createTestDb()
  app = buildApp()
  await app.ready()
  redis = new Redis(process.env.REDIS_URL!)
})

afterAll(async () => {
  await app.close()
  await redis.quit()
  await db.$disconnect()
})

beforeEach(async () => {
  await cleanDb(db)
  fixtures = await seedFixtures(db)

  // Flush the test Redis DB to ensure no stale rate-limit counters
  await redis.flushdb()

  // Install a fresh fetch spy for each test; restored in afterEach
  fetchSpy = jest
    .spyOn(global, 'fetch' as keyof typeof global)
    .mockImplementation(() => successFetch() as Promise<Response>)

  // Seed a SystemConfig row with the encrypted test API key so the gateway
  // can decrypt it on each request.
  const encrypted = encryptApiKey(PLAINTEXT_API_KEY, ENCRYPTION_KEY)
  await db.systemConfig.upsert({
    where: { id: 'singleton' },
    update: { openrouterKeyEncrypted: encrypted },
    create: { id: 'singleton', openrouterKeyEncrypted: encrypted },
  })
})

afterEach(() => {
  fetchSpy.mockRestore()
})

// ── Rate limiting ──────────────────────────────────────────────────────────

describe('Rate limiting — RATE_LIMIT_MAX = 60', () => {
  it('60 requests succeed, 61st returns 429 RATE_LIMITED', async () => {
    // Create a real session in DB to satisfy the session lookup inside the route
    const { inviteTokenValue } = fixtures
    const candidate = await db.user.create({
      data: { email: 'ratelimit-candidate@test.test', role: 'STUDENT' },
    })
    const session = await db.session.create({
      data: {
        assessmentId: fixtures.assessmentId,
        candidateId: candidate.id,
        language: 'PYTHON',
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    const candidateToken = makeCandidateToken(candidate.id, session.id)
    const rateKey = `rate:llm:${session.id}`

    // Pre-fill the counter to 59 so only one real HTTP request is needed to
    // reach the limit (keeps the test fast: 2 calls instead of 61).
    await redis.set(rateKey, '59', 'EX', 86400)

    // The 60th request — should succeed
    const res60 = await chatRequest(candidateToken)
    expect(res60.status).toBe(200)
    expect(res60.body.data).toHaveProperty('response')

    // Counter is now 60. The 61st request — must be blocked.
    const res61 = await chatRequest(candidateToken)
    expect(res61.status).toBe(429)
    expect(res61.body.error.code).toBe('RATE_LIMITED')
  })
})

// ── Interaction log persistence ────────────────────────────────────────────

describe('Interaction log count = number of successful requests', () => {
  it('3 successful requests produce 3 interaction log rows in DB', async () => {
    const candidate = await db.user.create({
      data: { email: 'log-candidate@test.test', role: 'STUDENT' },
    })
    const session = await db.session.create({
      data: {
        assessmentId: fixtures.assessmentId,
        candidateId: candidate.id,
        language: 'PYTHON',
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const candidateToken = makeCandidateToken(candidate.id, session.id)

    // Make 3 requests sequentially so turn numbers are deterministic
    for (let i = 0; i < 3; i++) {
      const res = await chatRequest(candidateToken, `Question ${i + 1}`)
      expect(res.status).toBe(200)
    }

    // Logs are written async (void). Poll until all 3 are committed.
    const logCount = await waitForLogs(db, session.id, 3)
    expect(logCount).toBe(3)
  })
})

// ── API key never in response body ────────────────────────────────────────

describe('Hard rule: plaintext API key never appears in response body', () => {
  it('successful response body does not contain the plaintext API key', async () => {
    const candidate = await db.user.create({
      data: { email: 'key-safety-candidate@test.test', role: 'STUDENT' },
    })
    const session = await db.session.create({
      data: {
        assessmentId: fixtures.assessmentId,
        candidateId: candidate.id,
        language: 'PYTHON',
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const candidateToken = makeCandidateToken(candidate.id, session.id)

    const res = await chatRequest(candidateToken, 'Help with Python')
    expect(res.status).toBe(200)

    // The raw response body string must not contain the plaintext key
    expect(res.text).not.toContain(PLAINTEXT_API_KEY)
    // Nor the encrypted form (belt-and-suspenders)
    const encryptedKey = (
      await db.systemConfig.findUnique({ where: { id: 'singleton' } })
    )?.openrouterKeyEncrypted
    expect(res.text).not.toContain(encryptedKey)
  })

  it('error response body does not contain the plaintext API key', async () => {
    // Mock fetch to return a non-OK status
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 503, json: async () => ({}) } as Response),
    )

    const candidate = await db.user.create({
      data: { email: 'error-safety-candidate@test.test', role: 'STUDENT' },
    })
    const session = await db.session.create({
      data: {
        assessmentId: fixtures.assessmentId,
        candidateId: candidate.id,
        language: 'PYTHON',
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const candidateToken = makeCandidateToken(candidate.id, session.id)

    const res = await chatRequest(candidateToken)
    // 502 AI_ASSISTANT_ERROR or similar
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.text).not.toContain(PLAINTEXT_API_KEY)
  })
})

// ── LLM timeout ───────────────────────────────────────────────────────────

describe('Mocked OpenRouter timeout → 504 LLM_TIMEOUT', () => {
  it('returns 504 LLM_TIMEOUT when fetch aborts with an AbortError', async () => {
    // Simulate the AbortController triggering (7 s timeout)
    fetchSpy.mockImplementationOnce(() => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })

    const candidate = await db.user.create({
      data: { email: 'timeout-candidate@test.test', role: 'STUDENT' },
    })
    const session = await db.session.create({
      data: {
        assessmentId: fixtures.assessmentId,
        candidateId: candidate.id,
        language: 'PYTHON',
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const candidateToken = makeCandidateToken(candidate.id, session.id)

    const res = await chatRequest(candidateToken, 'slow question')
    expect(res.status).toBe(504)
    expect(res.body.error.code).toBe('LLM_TIMEOUT')
  })
})
