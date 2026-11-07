/**
 * Assessment service integration tests
 *
 * Real DB + real Redis. The Docker sandbox (runCode) is mocked because
 * it requires live containers which are not available in the test environment.
 *
 * Tests cover:
 *   - Problem response never includes hidden test cases (Hard Rule)
 *   - POST /run returns only visible test-case results
 *   - POST /submit response contains no score data (Hard Rule)
 *   - POST /submit twice → 409 SUBMISSION_LOCKED
 *   - PATCH /code persists to DB (and can be read back via GET /sessions/:id)
 *   - PATCH /code on an expired session → 401 SESSION_EXPIRED
 *   - GET /sessions/:id returns currentCode matching the last PATCH /code save
 */

// Sandbox must be mocked before any route import that transitively requires it.
jest.mock('../../apps/api-core/src/lib/sandbox', () => ({
  runCode: jest.fn(),
}))

import Fastify, { type FastifyInstance } from 'fastify'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { createTestDb, cleanDb, seedFixtures, type Fixtures } from './helpers/db'

import { runCode } from '../../apps/api-core/src/lib/sandbox'
import { sessionRoutes } from '../../apps/api-core/src/routes/sessions'
import { makeAuthHooks } from '../../apps/api-core/src/plugins/authenticate'
import { TEST_ENV } from '../../apps/api-core/src/testEnv'

// ── Constants ──────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET!
const mockRunCode = jest.mocked(runCode)

// ── Default sandbox response: both test cases pass ─────────────────────────
const DEFAULT_RUN_RESULT = {
  status: 'completed' as const,
  passed: 1,
  failed: 0,
  results: [{ testCaseId: 'placeholder', status: 'pass' as const, stdout: '4\n', stderr: '' }],
}

// ── App builder ─────────────────────────────────────────────────────────────

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  app.register(sessionRoutes, {
    env: {
      ...TEST_ENV,
      JWT_SECRET,
      DATABASE_URL: process.env.DATABASE_URL!,
      REDIS_URL: process.env.REDIS_URL!,
      SANDBOX_URL: process.env.SANDBOX_URL!,
    },
    authHooks,
  })
  return app
}

// ── Test state ─────────────────────────────────────────────────────────────

let db: PrismaClient
let fixtures: Fixtures
let app: FastifyInstance

/** Starts a session and returns { access_token, session_id }. */
async function startSession() {
  mockRunCode.mockResolvedValue(DEFAULT_RUN_RESULT)
  const res = await supertest(app.server)
    .post('/api/v1/sessions/start')
    .send({ token: fixtures.inviteTokenValue })
  expect(res.status).toBe(201)
  return res.body.data as { access_token: string; session_id: string }
}

beforeAll(async () => {
  db = createTestDb()
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await db.$disconnect()
})

beforeEach(async () => {
  await cleanDb(db)
  fixtures = await seedFixtures(db)
  mockRunCode.mockReset()
  mockRunCode.mockResolvedValue(DEFAULT_RUN_RESULT)
})

// ── Hidden test cases never reach the client ──────────────────────────────

describe('Hard rule: hidden test cases never in responses', () => {
  it('POST /sessions/start problem payload contains only visible test cases', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/sessions/start')
      .send({ token: fixtures.inviteTokenValue })

    expect(res.status).toBe(201)
    const { problem } = res.body.data

    // Must contain the visible test case
    const tcIds: string[] = problem.visible_test_cases.map(
      (tc: { id: string }) => tc.id,
    )
    expect(tcIds).toContain(fixtures.visibleTcId)

    // Must NOT contain the hidden test case
    expect(tcIds).not.toContain(fixtures.hiddenTcId)
    expect(problem.visible_test_cases).toHaveLength(1)
  })

  it('POST /run returns only visible test-case results — hidden IDs absent', async () => {
    const { access_token, session_id } = await startSession()

    // Sandbox returns results for the visible test case only
    mockRunCode.mockResolvedValueOnce({
      status: 'completed',
      passed: 1,
      failed: 0,
      results: [
        { testCaseId: fixtures.visibleTcId, status: 'pass', stdout: '4\n', stderr: '' },
      ],
    })

    const res = await supertest(app.server)
      .post(`/api/v1/sessions/${session_id}/run`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ code: 'print(2+2)' })

    expect(res.status).toBe(200)

    const resultIds: string[] = res.body.data.results.map(
      (r: { test_case_id: string }) => r.test_case_id,
    )
    // Visible test case present
    expect(resultIds).toContain(fixtures.visibleTcId)
    // Hidden test case absent
    expect(resultIds).not.toContain(fixtures.hiddenTcId)
  })
})

// ── Submit ────────────────────────────────────────────────────────────────

describe('POST /api/v1/sessions/:id/submit', () => {
  it('200 response contains NO score data (Hard Rule: AIU scores never shown)', async () => {
    const { access_token, session_id } = await startSession()

    const res = await supertest(app.server)
      .post(`/api/v1/sessions/${session_id}/submit`)
      .set('Authorization', `Bearer ${access_token}`)

    expect(res.status).toBe(200)

    // The response must only confirm submission — no scores
    const body = res.body.data
    expect(body).not.toHaveProperty('score')
    expect(body).not.toHaveProperty('total_score')
    expect(body).not.toHaveProperty('code_correctness_score')
    expect(body).not.toHaveProperty('aiu_scores')
    expect(body).not.toHaveProperty('aiu_total_score')
    expect(body).toHaveProperty('message') // just a confirmation string
  })

  it('409 SUBMISSION_LOCKED on second submit attempt', async () => {
    const { access_token, session_id } = await startSession()

    // First submit
    await supertest(app.server)
      .post(`/api/v1/sessions/${session_id}/submit`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(200)

    // Second submit — must be rejected
    const res = await supertest(app.server)
      .post(`/api/v1/sessions/${session_id}/submit`)
      .set('Authorization', `Bearer ${access_token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SUBMISSION_LOCKED')
  })
})

// ── Code auto-save ────────────────────────────────────────────────────────

describe('PATCH /api/v1/sessions/:id/code — auto-save', () => {
  it('persists code to DB and is readable via GET /sessions/:id', async () => {
    const { access_token, session_id } = await startSession()
    const savedCode = 'def solve(a, b):\n    return a + b'

    const patchRes = await supertest(app.server)
      .patch(`/api/v1/sessions/${session_id}/code`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ code: savedCode })

    expect(patchRes.status).toBe(200)
    expect(patchRes.body.data).toHaveProperty('saved_at')

    // Verify persisted to DB (the code reaches the DB, not just Redis)
    const row = await db.session.findUnique({
      where: { id: session_id },
      select: { currentCode: true },
    })
    expect(row?.currentCode).toBe(savedCode)
  })

  it('GET /sessions/:id returns currentCode matching the last save', async () => {
    const { access_token, session_id } = await startSession()
    const savedCode = 'x = 42'

    await supertest(app.server)
      .patch(`/api/v1/sessions/${session_id}/code`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ code: savedCode })
      .expect(200)

    // Simulate reconnection: GET the session
    const getRes = await supertest(app.server)
      .get(`/api/v1/sessions/${session_id}`)
      .set('Authorization', `Bearer ${access_token}`)

    expect(getRes.status).toBe(200)
    expect(getRes.body.data.current_code).toBe(savedCode)
    expect(getRes.body.data.session_id).toBe(session_id)
  })

  it('401 SESSION_EXPIRED when session timer has elapsed', async () => {
    const { access_token, session_id } = await startSession()

    // Expire the session directly in the DB
    await db.session.update({
      where: { id: session_id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await supertest(app.server)
      .patch(`/api/v1/sessions/${session_id}/code`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ code: 'too late' })

    // Implementation returns SESSION_EXPIRED (mapped to 401)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SESSION_EXPIRED')
  })
})
