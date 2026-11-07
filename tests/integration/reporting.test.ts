/**
 * Reporting service integration tests
 *
 * Real DB. Puppeteer / generatePdf is mocked with a minimal PDF buffer so
 * tests run without a Chrome installation.
 *
 * Tests cover:
 *   - GET /leaderboard: candidates sorted by totalScore DESC, codeCorrectness DESC,
 *     submittedAt ASC — tie-breaking verified
 *   - GET /reports/sessions/:id: 404 before AIU scoring is complete (no score row)
 *   - GET /reports/sessions/:id/pdf: Content-Type application/pdf
 *   - GET /reports/assessments/:id/batch/pdf: Content-Type application/pdf
 */

// Mock Puppeteer so tests never need a real Chrome binary.
jest.mock('../../apps/api-core/src/lib/pdf', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 integration-test')),
  buildCandidateReportHtml: jest.fn().mockReturnValue('<html>candidate</html>'),
  buildBatchReportHtml: jest.fn().mockReturnValue('<html>batch</html>'),
}))

import Fastify, { type FastifyInstance } from 'fastify'
import supertest from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createTestDb, cleanDb, seedFixtures, type Fixtures } from './helpers/db'

import { sessionReportRoutes } from '../../apps/api-core/src/routes/reportSessions'
import { assessmentReportRoutes } from '../../apps/api-core/src/routes/reportAssessments'
import { makeAuthHooks } from '../../apps/api-core/src/plugins/authenticate'
import { TEST_ENV } from '../../apps/api-core/src/testEnv'

// ── App builder ────────────────────────────────────────────────────────────

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(process.env.JWT_SECRET!)
  const env = {
    ...TEST_ENV,
    JWT_SECRET: process.env.JWT_SECRET!,
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
  }
  app.register(sessionReportRoutes, { env, authHooks })
  app.register(assessmentReportRoutes, { env, authHooks })
  return app
}

// ── Test state ─────────────────────────────────────────────────────────────

let db: PrismaClient
let fixtures: Fixtures
let app: FastifyInstance

/**
 * Seeds a scored, submitted session directly in DB without going through the
 * assessment service. Used to set up leaderboard and report test data.
 */
async function insertScoredSession(opts: {
  email: string
  totalScore: number
  codeCorrectnessScore: number
  submittedAt: Date
}): Promise<string> {
  const candidate = await db.user.create({
    data: { email: opts.email, role: 'STUDENT' },
  })
  // Create a unique invite token per candidate so name resolution works
  const inviteToken = await db.inviteToken.create({
    data: {
      assessmentId: fixtures.assessmentId,
      candidateName: opts.email.split('@')[0]!,
      candidateEmail: opts.email,
      expiresAt: new Date(Date.now() + 72 * 3600_000),
      usedAt: opts.submittedAt,
    },
  })
  const session = await db.session.create({
    data: {
      assessmentId: fixtures.assessmentId,
      candidateId: candidate.id,
      language: 'PYTHON',
      status: 'SUBMITTED',
      startedAt: new Date(opts.submittedAt.getTime() - 30 * 60_000),
      submittedAt: opts.submittedAt,
      expiresAt: new Date(opts.submittedAt.getTime() + 30 * 60_000),
    },
  })
  // SessionScore with pre-computed totals
  const aiuTotalScore = 50
  await db.sessionScore.create({
    data: {
      sessionId: session.id,
      codeCorrectnessScore: opts.codeCorrectnessScore,
      aiuScores: { prompt_quality: 50, iteration_efficiency: 50 },
      aiuTotalScore,
      totalScore: opts.totalScore,
    },
  })
  return session.id
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
})

// ── Leaderboard sorting ────────────────────────────────────────────────────

describe('GET /api/v1/reports/assessments/:id/leaderboard', () => {
  it('returns candidates sorted: totalScore DESC → codeCorrectness DESC → submittedAt ASC', async () => {
    const t = new Date('2024-01-01T10:00:00Z').getTime()
    // Four sessions with deliberate score patterns to exercise all tie-break rules
    await insertScoredSession({
      email: 'a@test.test',
      totalScore: 90,
      codeCorrectnessScore: 80,
      submittedAt: new Date(t),          // rank 1 — same score as B but earlier
    })
    await insertScoredSession({
      email: 'b@test.test',
      totalScore: 90,
      codeCorrectnessScore: 80,
      submittedAt: new Date(t + 60_000), // rank 2 — same total+code, submitted later
    })
    await insertScoredSession({
      email: 'c@test.test',
      totalScore: 90,
      codeCorrectnessScore: 75,          // rank 3 — same total, lower code correctness
      submittedAt: new Date(t),
    })
    await insertScoredSession({
      email: 'd@test.test',
      totalScore: 85,                    // rank 4 — lowest total
      codeCorrectnessScore: 80,
      submittedAt: new Date(t),
    })

    const res = await supertest(app.server)
      .get(`/api/v1/reports/assessments/${fixtures.assessmentId}/leaderboard`)
      .set('Authorization', `Bearer ${fixtures.adminToken}`)

    expect(res.status).toBe(200)
    const rows = res.body.data
    expect(rows).toHaveLength(4)

    // Verify rank and sort order
    const names = rows.map((r: { candidate_name: string }) => r.candidate_name)
    expect(names[0]).toBe('a')
    expect(names[1]).toBe('b')
    expect(names[2]).toBe('c')
    expect(names[3]).toBe('d')

    // rank field must be 1-indexed and sequential
    const ranks = rows.map((r: { rank: number }) => r.rank)
    expect(ranks).toEqual([1, 2, 3, 4])
  })
})

// ── Session report — 404 before AIU scoring ────────────────────────────────

describe('GET /api/v1/reports/sessions/:id', () => {
  it('404 when session has no SessionScore row yet', async () => {
    // Create a submitted session with NO score row
    const candidate = await db.user.create({
      data: { email: 'unscored@test.test', role: 'STUDENT' },
    })
    const session = await db.session.create({
      data: {
        assessmentId: fixtures.assessmentId,
        candidateId: candidate.id,
        language: 'PYTHON',
        status: 'SUBMITTED',
        startedAt: new Date(),
        submittedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    const res = await supertest(app.server)
      .get(`/api/v1/reports/sessions/${session.id}`)
      .set('Authorization', `Bearer ${fixtures.adminToken}`)

    expect(res.status).toBe(404)
  })
})

// ── PDF endpoints ──────────────────────────────────────────────────────────

describe('PDF endpoints', () => {
  it('GET /sessions/:id/pdf returns Content-Type: application/pdf', async () => {
    const sessionId = await insertScoredSession({
      email: 'pdf-candidate@test.test',
      totalScore: 78,
      codeCorrectnessScore: 70,
      submittedAt: new Date(),
    })

    const res = await supertest(app.server)
      .get(`/api/v1/reports/sessions/${sessionId}/pdf`)
      .set('Authorization', `Bearer ${fixtures.adminToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
  })

  it('GET /assessments/:id/batch/pdf returns Content-Type: application/pdf', async () => {
    await insertScoredSession({
      email: 'batch-candidate-1@test.test',
      totalScore: 80,
      codeCorrectnessScore: 75,
      submittedAt: new Date(),
    })
    await insertScoredSession({
      email: 'batch-candidate-2@test.test',
      totalScore: 70,
      codeCorrectnessScore: 65,
      submittedAt: new Date(),
    })

    const res = await supertest(app.server)
      .get(`/api/v1/reports/assessments/${fixtures.assessmentId}/batch/pdf`)
      .set('Authorization', `Bearer ${fixtures.adminToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
  })
})
