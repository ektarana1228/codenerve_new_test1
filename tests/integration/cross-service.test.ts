/**
 * Cross-service integration test — full submission flow
 *
 * Exercises the end-to-end path through three real service instances:
 *
 *   assessment (POST /sessions/start)
 *     → assessment (PATCH /sessions/:id/code)
 *     → assessment (POST /sessions/:id/submit)
 *     → BullMQ job enqueued in real Redis (verified via Queue API)
 *     → worker processScoreJob() called directly (no need to spin up the Worker)
 *     → scores persisted in DB
 *     → reporting (GET /leaderboard) reflects the scored session
 *
 * The Docker sandbox and Puppeteer remain mocked.  Everything else — Prisma,
 * Redis, BullMQ job management — uses real infrastructure.
 */

jest.mock('../../apps/api-core/src/lib/sandbox', () => ({
  runCode: jest.fn(),
}))

jest.mock('../../apps/api-core/src/lib/pdf', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 cross-service')),
  buildCandidateReportHtml: jest.fn().mockReturnValue('<html>ok</html>'),
  buildBatchReportHtml: jest.fn().mockReturnValue('<html>ok</html>'),
}))

import Fastify, { type FastifyInstance } from 'fastify'
import supertest from 'supertest'
import { Queue } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { createTestDb, cleanDb, seedFixtures, type Fixtures } from './helpers/db'

import { runCode } from '../../apps/api-core/src/lib/sandbox'
import { sessionRoutes } from '../../apps/api-core/src/routes/sessions'
import { sessionReportRoutes } from '../../apps/api-core/src/routes/reportSessions'
import { assessmentReportRoutes } from '../../apps/api-core/src/routes/reportAssessments'
import { makeAuthHooks } from '../../apps/api-core/src/plugins/authenticate'
import { TEST_ENV } from '../../apps/api-core/src/testEnv'

import { processScoreJob } from '../../apps/worker-aiu/src/processor'
import { AIU_SCORING_QUEUE } from '@platform/types'

// ── Constants ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET!
const mockRunCode = jest.mocked(runCode)

// ── App builders ──────────────────────────────────────────────────────────

function buildAssessmentApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(sessionRoutes, {
    env: {
      ...TEST_ENV,
      JWT_SECRET,
      DATABASE_URL: process.env.DATABASE_URL!,
      REDIS_URL: process.env.REDIS_URL!,
      SANDBOX_URL: process.env.SANDBOX_URL!,
    },
    authHooks: makeAuthHooks(JWT_SECRET),
  })
  return app
}

function buildReportingApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  const env = {
    ...TEST_ENV,
    JWT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
  }
  app.register(sessionReportRoutes, { env, authHooks })
  app.register(assessmentReportRoutes, { env, authHooks })
  return app
}

// ── BullMQ queue handle (used only to inspect, not process jobs) ──────────

function makeRedisOpts() {
  const url = new URL(process.env.REDIS_URL!)
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
    maxRetriesPerRequest: null as null,
  }
}

// ── Test state ─────────────────────────────────────────────────────────────

let db: PrismaClient
let fixtures: Fixtures
let assessApp: FastifyInstance
let reportApp: FastifyInstance
let aiuQueue: Queue

beforeAll(async () => {
  db = createTestDb()
  assessApp = buildAssessmentApp()
  reportApp = buildReportingApp()
  await Promise.all([assessApp.ready(), reportApp.ready()])
  aiuQueue = new Queue(AIU_SCORING_QUEUE, { connection: makeRedisOpts() })
})

afterAll(async () => {
  await Promise.all([assessApp.close(), reportApp.close()])
  await aiuQueue.close()
  await db.$disconnect()
})

beforeEach(async () => {
  await cleanDb(db)
  fixtures = await seedFixtures(db)
  mockRunCode.mockReset()
  // Default: 1 visible TC passes, 1 hidden TC passes → correctness = 100%
  mockRunCode.mockResolvedValue({
    status: 'completed' as const,
    passed: 2,
    failed: 0,
    results: [
      { testCaseId: 'placeholder-1', status: 'pass' as const, stdout: '4\n', stderr: '' },
      { testCaseId: 'placeholder-2', status: 'pass' as const, stdout: '10\n', stderr: '' },
    ],
  })
  // Drain any leftover jobs from a previous test run
  await aiuQueue.drain()
})

// ── Full submission flow ────────────────────────────────────────────────────

describe('Full submission flow', () => {
  it(
    'start session → save code → submit → AIU job in Redis → worker scores → leaderboard updated',
    async () => {
      // ── 1. Start session ──────────────────────────────────────────────────
      const startRes = await supertest(assessApp.server)
        .post('/api/v1/sessions/start')
        .send({ token: fixtures.inviteTokenValue })

      expect(startRes.status).toBe(201)
      const { access_token, session_id } = startRes.body.data as {
        access_token: string
        session_id: string
      }

      // Verify the invite token is now marked as used
      const usedToken = await db.inviteToken.findUnique({
        where: { id: fixtures.inviteTokenId },
        select: { usedAt: true },
      })
      expect(usedToken?.usedAt).not.toBeNull()

      // ── 2. Save code ──────────────────────────────────────────────────────
      const CODE = 'def solve(a, b): return a + b'
      const saveRes = await supertest(assessApp.server)
        .patch(`/api/v1/sessions/${session_id}/code`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ code: CODE })

      expect(saveRes.status).toBe(200)

      // Verify code is durable in DB (not just in Redis)
      const sessionRow = await db.session.findUnique({
        where: { id: session_id },
        select: { currentCode: true },
      })
      expect(sessionRow?.currentCode).toBe(CODE)

      // ── 3. Submit ─────────────────────────────────────────────────────────
      const submitRes = await supertest(assessApp.server)
        .post(`/api/v1/sessions/${session_id}/submit`)
        .set('Authorization', `Bearer ${access_token}`)

      expect(submitRes.status).toBe(200)

      // Hard Rule: submit response must contain no score data
      expect(submitRes.body.data).not.toHaveProperty('score')
      expect(submitRes.body.data).not.toHaveProperty('total_score')
      expect(submitRes.body.data).not.toHaveProperty('code_correctness_score')
      expect(submitRes.body.data).not.toHaveProperty('aiu_scores')

      // Session is now SUBMITTED in DB
      const submittedSession = await db.session.findUnique({
        where: { id: session_id },
        select: { status: true },
      })
      expect(submittedSession?.status).toBe('SUBMITTED')

      // ── 4. Verify AIU job was enqueued in Redis ────────────────────────────
      // Give BullMQ a moment to persist the job to Redis
      await new Promise((r) => setTimeout(r, 150))
      const waitingJobs = await aiuQueue.getJobs(['waiting', 'active', 'delayed'])
      const ourJob = waitingJobs.find((j) => j.data.session_id === session_id)
      expect(ourJob).toBeDefined()
      expect(ourJob!.name).toBe('score')

      // ── 5. Run the AIU worker processor directly ────────────────────────────
      await processScoreJob({ session_id })

      // ── 6. Verify scores are persisted in DB ──────────────────────────────
      const score = await db.sessionScore.findUnique({ where: { sessionId: session_id } })
      expect(score).not.toBeNull()
      expect(score!.codeCorrectnessScore).toBeGreaterThanOrEqual(0)
      expect(score!.aiuTotalScore).toBeGreaterThanOrEqual(0)
      expect(score!.totalScore).toBeGreaterThanOrEqual(0)

      // AIU scores object must have all four metric keys
      const aiuScores = score!.aiuScores as Record<string, number>
      expect(aiuScores).toHaveProperty('prompt_quality')
      expect(aiuScores).toHaveProperty('iteration_efficiency')
      expect(aiuScores).toHaveProperty('independent_editing')
      expect(aiuScores).toHaveProperty('contextual_relevance')

      // ── 7. Verify leaderboard reflects the scored session ─────────────────
      const leaderboardRes = await supertest(reportApp.server)
        .get(`/api/v1/reports/assessments/${fixtures.assessmentId}/leaderboard`)
        .set('Authorization', `Bearer ${fixtures.adminToken}`)

      expect(leaderboardRes.status).toBe(200)

      const rows = leaderboardRes.body.data
      expect(rows).toHaveLength(1)
      expect(rows[0].rank).toBe(1)
      expect(rows[0].total_score).toBe(score!.totalScore)
      expect(rows[0].code_correctness_score).toBe(score!.codeCorrectnessScore)
    },
  )

  it('second submit attempt after scoring returns 409 SUBMISSION_LOCKED', async () => {
    const startRes = await supertest(assessApp.server)
      .post('/api/v1/sessions/start')
      .send({ token: fixtures.inviteTokenValue })
      .expect(201)

    const { access_token, session_id } = startRes.body.data

    await supertest(assessApp.server)
      .post(`/api/v1/sessions/${session_id}/submit`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(200)

    const res = await supertest(assessApp.server)
      .post(`/api/v1/sessions/${session_id}/submit`)
      .set('Authorization', `Bearer ${access_token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SUBMISSION_LOCKED')
  })
})
