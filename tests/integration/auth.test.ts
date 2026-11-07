/**
 * Auth service integration tests
 *
 * Runs against a real PostgreSQL test database. No mocks for @platform/db.
 * Tests cover:
 *   - Login (happy path + error paths)
 *   - Invite-token generation + DB verification of 72 h expiry
 *   - Role enforcement on invite-token endpoint
 *   - Session start token lifecycle (fresh / used / expired) — route lives in
 *     api-assessment but is tested here because it's the auth flow's end point.
 */

import Fastify, { type FastifyInstance } from 'fastify'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createTestDb, cleanDb, seedFixtures, type Fixtures } from './helpers/db'

// ── Service route imports (real implementations, real DB) ──────────────────
// auth + assessment routes now live in the merged api-core service.

import { loginRoutes } from '../../apps/api-core/src/routes/login'
import { inviteTokenRoutes } from '../../apps/api-core/src/routes/inviteTokens'
import { sessionRoutes } from '../../apps/api-core/src/routes/sessions'
import { makeAuthHooks } from '../../apps/api-core/src/plugins/authenticate'
import { TEST_ENV } from '../../apps/api-core/src/testEnv'

// ── Sandbox is mocked — assessment tests focus on HTTP + DB, not Docker ────
jest.mock('../../apps/api-core/src/lib/sandbox', () => ({
  runCode: jest.fn(),
}))

// ── Constants ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET!
const ADMIN_PASSWORD = 'admin123'
const testEnv = {
  ...TEST_ENV,
  JWT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL!,
  REDIS_URL: process.env.REDIS_URL!,
  APP_BASE_URL: process.env.APP_BASE_URL!,
  SANDBOX_URL: process.env.SANDBOX_URL!,
}

// ── App builders ──────────────────────────────────────────────────────────

function buildAuthApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  const opts = { env: testEnv, authHooks }
  app.register(loginRoutes, opts)
  app.register(inviteTokenRoutes, opts)
  return app
}

function buildAssessmentApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  app.register(sessionRoutes, { env: testEnv, authHooks })
  return app
}

// ── Test state ─────────────────────────────────────────────────────────────

let db: PrismaClient
let fixtures: Fixtures
let authApp: FastifyInstance
let assessApp: FastifyInstance

beforeAll(async () => {
  db = createTestDb()
  authApp = buildAuthApp()
  assessApp = buildAssessmentApp()
  await Promise.all([authApp.ready(), assessApp.ready()])
})

afterAll(async () => {
  await Promise.all([authApp.close(), assessApp.close()])
  await db.$disconnect()
})

beforeEach(async () => {
  await cleanDb(db)
  fixtures = await seedFixtures(db)
})

// ── Login ─────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('200 + master JWT for correct master credentials', async () => {
    const passwordHash = await bcrypt.hash('master123', 10)
    const master = await db.user.create({
      data: { email: 'test-master@integration.test', passwordHash, role: 'MASTER' },
    })

    const res = await supertest(authApp.server)
      .post('/api/v1/auth/login')
      .send({ email: 'test-master@integration.test', password: 'master123' })

    expect(res.status).toBe(200)
    const decoded = jwt.verify(res.body.data.access_token, JWT_SECRET) as Record<string, unknown>
    expect(decoded.role).toBe('MASTER')
    expect(decoded.sub).toBe(master.id)
  })

  it('200 + valid JWT for correct admin credentials', async () => {
    const res = await supertest(authApp.server)
      .post('/api/v1/auth/login')
      .send({ email: 'test-admin@integration.test', password: ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('access_token')

    // Decode and verify the JWT payload
    const decoded = jwt.verify(res.body.data.access_token, JWT_SECRET) as Record<string, unknown>
    expect(decoded.role).toBe('ADMIN')
    expect(decoded.sub).toBe(fixtures.adminId)
  })

  it('401 UNAUTHORIZED for wrong password', async () => {
    const res = await supertest(authApp.server)
      .post('/api/v1/auth/login')
      .send({ email: 'test-admin@integration.test', password: 'wrong-password' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('401 UNAUTHORIZED for unknown email — same response shape as wrong password', async () => {
    const res = await supertest(authApp.server)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@nowhere.test', password: ADMIN_PASSWORD })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
    // Message must be identical — never reveal which case matched
    expect(res.body.error.message).toBe('Invalid email or password')
  })

  it('403 UNDER_REVIEW for matching pending admin request credentials', async () => {
    await db.adminSignupRequest.create({
      data: {
        email: 'pending-admin@integration.test',
        passwordHash: await bcrypt.hash('pending123', 10),
      },
    })

    const res = await supertest(authApp.server)
      .post('/api/v1/auth/login')
      .send({ email: 'pending-admin@integration.test', password: 'pending123' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('UNDER_REVIEW')
    expect(res.body.error.message).toBe('Under Review')
  })
})

// ── Invite tokens ─────────────────────────────────────────────────────────

describe('POST /api/v1/auth/admins', () => {
  it('201 creates an admin when called with master JWT', async () => {
    const master = await db.user.create({
      data: {
        email: 'creator-master@integration.test',
        passwordHash: await bcrypt.hash('master123', 10),
        role: 'MASTER',
      },
    })
    const masterToken = jwt.sign({ sub: master.id, role: 'MASTER' }, JWT_SECRET, { expiresIn: '1h' })

    const res = await supertest(authApp.server)
      .post('/api/v1/auth/admins')
      .set('Authorization', `Bearer ${masterToken}`)
      .send({ email: 'created-admin@integration.test', password: 'newadmin123A!' })

    expect(res.status).toBe(201)
    expect(res.body.data.email).toBe('created-admin@integration.test')

    const admin = await db.user.findUnique({ where: { email: 'created-admin@integration.test' } })
    expect(admin?.role).toBe('ADMIN')
    expect(admin?.passwordHash).toBeTruthy()
  })

  it('400 VALIDATION_ERROR for weak admin passwords', async () => {
    const master = await db.user.create({
      data: {
        email: 'creator-master-weak@integration.test',
        passwordHash: await bcrypt.hash('master123', 10),
        role: 'MASTER',
      },
    })
    const masterToken = jwt.sign({ sub: master.id, role: 'MASTER' }, JWT_SECRET, { expiresIn: '1h' })

    const res = await supertest(authApp.server)
      .post('/api/v1/auth/admins')
      .set('Authorization', `Bearer ${masterToken}`)
      .send({ email: 'weak-admin@integration.test', password: 'password1' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('403 when called with regular admin JWT', async () => {
    const res = await supertest(authApp.server)
      .post('/api/v1/auth/admins')
      .set('Authorization', `Bearer ${fixtures.adminToken}`)
      .send({ email: 'blocked-admin@integration.test', password: 'newadmin123' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('POST /api/v1/auth/admin-requests/:id/approve', () => {
  it('creates an admin account from a pending request', async () => {
    const master = await db.user.create({
      data: {
        email: 'approval-master@integration.test',
        passwordHash: await bcrypt.hash('master123', 10),
        role: 'MASTER',
      },
    })
    const masterToken = jwt.sign({ sub: master.id, role: 'MASTER' }, JWT_SECRET, { expiresIn: '1h' })
    const adminRequest = await db.adminSignupRequest.create({
      data: {
        email: 'approved-admin@integration.test',
        passwordHash: await bcrypt.hash('approved123', 10),
      },
    })

    const res = await supertest(authApp.server)
      .post(`/api/v1/auth/admin-requests/${adminRequest.id}/approve`)
      .set('Authorization', `Bearer ${masterToken}`)
      // Real clients send this header with no body — must not 500 (FST_ERR_CTP_EMPTY_JSON_BODY).
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const admin = await db.user.findUnique({ where: { email: 'approved-admin@integration.test' } })
    expect(admin?.role).toBe('ADMIN')
    const reviewed = await db.adminSignupRequest.findUnique({ where: { id: adminRequest.id } })
    expect(reviewed?.status).toBe('APPROVED')
  })

  it('conflicts without touching the account when an admin already owns the email', async () => {
    const master = await db.user.create({
      data: {
        email: 'dup-master@integration.test',
        passwordHash: await bcrypt.hash('master123', 10),
        role: 'MASTER',
      },
    })
    const masterToken = jwt.sign({ sub: master.id, role: 'MASTER' }, JWT_SECRET, { expiresIn: '1h' })
    const existing = await db.user.create({
      data: {
        email: 'dup-admin@integration.test',
        passwordHash: await bcrypt.hash('original-password', 10),
        role: 'ADMIN',
      },
    })
    const adminRequest = await db.adminSignupRequest.create({
      data: {
        email: 'dup-admin@integration.test',
        passwordHash: await bcrypt.hash('attacker-password', 10),
      },
    })

    const res = await supertest(authApp.server)
      .post(`/api/v1/auth/admin-requests/${adminRequest.id}/approve`)
      .set('Authorization', `Bearer ${masterToken}`)

    expect(res.status).toBe(409)
    // Existing account's password must be untouched (no silent reset/takeover).
    const unchanged = await db.user.findUnique({ where: { id: existing.id } })
    expect(unchanged?.passwordHash).toBe(existing.passwordHash)
    // Request is resolved so it leaves the pending list.
    const reviewed = await db.adminSignupRequest.findUnique({ where: { id: adminRequest.id } })
    expect(reviewed?.status).toBe('REJECTED')
  })
})

describe('POST /api/v1/auth/invite-tokens', () => {
  it('201 + token when called with admin JWT', async () => {
    const res = await supertest(authApp.server)
      .post('/api/v1/auth/invite-tokens')
      .set('Authorization', `Bearer ${fixtures.adminToken}`)
      .send({
        assessment_id: fixtures.assessmentId,
        candidate_name: 'New Candidate',
        candidate_email: 'new@example.test',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toHaveProperty('token')
    expect(res.body.data).toHaveProperty('invite_url')
  })

  it('generated token exists in DB with expiresAt ≈ now + 72 h', async () => {
    const before = Date.now()

    const res = await supertest(authApp.server)
      .post('/api/v1/auth/invite-tokens')
      .set('Authorization', `Bearer ${fixtures.adminToken}`)
      .send({ assessment_id: fixtures.assessmentId, candidate_name: 'Expiry Check' })

    const after = Date.now()
    expect(res.status).toBe(201)

    const row = await db.inviteToken.findUnique({
      where: { token: res.body.data.token },
      select: { expiresAt: true },
    })
    expect(row).not.toBeNull()

    const expMs = row!.expiresAt.getTime()
    const TTL = 72 * 3600_000
    // Allow ±2 s tolerance for clock drift during the request
    expect(expMs).toBeGreaterThanOrEqual(before + TTL - 2000)
    expect(expMs).toBeLessThanOrEqual(after + TTL + 2000)
  })

  it('403 FORBIDDEN when called with a candidate JWT', async () => {
    // Build a candidate-scoped JWT (role=STUDENT)
    const candidateToken = jwt.sign(
      {
        sub: '00000000-0000-4000-8000-000000000001',
        role: 'STUDENT',
        session_id: '00000000-0000-4000-8000-000000000002',
      },
      JWT_SECRET,
      { expiresIn: '1h' },
    )

    const res = await supertest(authApp.server)
      .post('/api/v1/auth/invite-tokens')
      .set('Authorization', `Bearer ${candidateToken}`)
      .send({ assessment_id: fixtures.assessmentId, candidate_name: 'Hacker' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

// ── Session start — token lifecycle ───────────────────────────────────────

describe('POST /api/v1/sessions/start — token lifecycle', () => {
  it('201 + session JWT for a fresh (unused, non-expired) invite token', async () => {
    const res = await supertest(assessApp.server)
      .post('/api/v1/sessions/start')
      .send({ token: fixtures.inviteTokenValue, candidate_email: 'candidate@integration.test' })

    expect(res.status).toBe(201)
    expect(res.body.data).toHaveProperty('access_token')
    expect(res.body.data).toHaveProperty('session_id')

    // Verify the JWT is a candidate-scoped token
    const decoded = jwt.verify(res.body.data.access_token, JWT_SECRET) as Record<string, unknown>
    expect(decoded.role).toBe('STUDENT')
    expect(decoded.session_id).toBe(res.body.data.session_id)
  })

  it('401 TOKEN_USED when the same token is used a second time', async () => {
    // First use — consumes the token
    await supertest(assessApp.server)
      .post('/api/v1/sessions/start')
      .send({ token: fixtures.inviteTokenValue, candidate_email: 'candidate@integration.test' })
      .expect(201)

    // Second use — must be rejected
    const res = await supertest(assessApp.server)
      .post('/api/v1/sessions/start')
      .send({ token: fixtures.inviteTokenValue, candidate_email: 'candidate@integration.test' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('TOKEN_USED')
  })

  it('401 TOKEN_EXPIRED when invite token is past its TTL', async () => {
    // Directly set expiresAt to the past in the DB
    await db.inviteToken.update({
      where: { id: fixtures.inviteTokenId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await supertest(assessApp.server)
      .post('/api/v1/sessions/start')
      .send({ token: fixtures.inviteTokenValue, candidate_email: 'candidate@integration.test' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('TOKEN_EXPIRED')
  })
})
