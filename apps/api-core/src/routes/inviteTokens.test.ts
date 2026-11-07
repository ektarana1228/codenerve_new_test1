// Mock @platform/db before any imports that transitively touch Prisma
jest.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    assessment: { findUnique: jest.fn() },
    inviteToken: { create: jest.fn(), findMany: jest.fn() },
  },
}))

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '@platform/db'
import { inviteTokenRoutes } from './inviteTokens'
import { makeAuthHooks } from '../plugins/authenticate'
import { TEST_ENV } from '../testEnv'

const JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440000'
const ASSESSMENT_ID = '550e8400-e29b-41d4-a716-446655440001'

const mockUser = jest.mocked(prisma.user.findUnique)
const mockAssessment = jest.mocked(prisma.assessment.findUnique)
const mockCreateToken = jest.mocked(prisma.inviteToken.create)

function buildApp() {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  const routeOpts = {
    env: { ...TEST_ENV, JWT_SECRET },
    authHooks,
  }
  app.register(inviteTokenRoutes, routeOpts)
  return app
}

function adminToken() {
  return jwt.sign({ sub: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser.mockResolvedValue({ role: 'ADMIN' } as any)
})

describe('POST /api/v1/auth/invite-tokens', () => {
  const VALID_BODY = {
    assessment_id: ASSESSMENT_ID,
    candidate_name: 'Alice Smith',
    candidate_email: 'alice@example.com',
  }

  test('creates invite token with UUID-v4 token field', async () => {
    const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    const tokenUuid = '7d793037-a076-4049-a0e2-ca5d3e2bffe6'

    mockAssessment.mockResolvedValue({ id: ASSESSMENT_ID, createdBy: ADMIN_ID, title: 'Frontend Assessment', timeLimitMinutes: 60, status: 'ACTIVE' } as any)
    mockCreateToken.mockResolvedValue({
      id: 'token-row-id',
      token: tokenUuid,
      assessmentId: ASSESSMENT_ID,
      candidateName: 'Alice Smith',
      candidateEmail: 'alice@example.com',
      usedAt: null,
      expiresAt: new Date(Date.now() + 72 * 3600000),
      createdAt: new Date(),
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite-tokens',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID_BODY,
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.data.token).toMatch(UUID_V4_RE)
  })

  test('sets expiresAt to exactly 72 hours from now', async () => {
    mockAssessment.mockResolvedValue({ id: ASSESSMENT_ID, createdBy: ADMIN_ID, title: 'Frontend Assessment', timeLimitMinutes: 60, status: 'ACTIVE' } as any)
    mockCreateToken.mockResolvedValue({
      id: 'row',
      token: '7d793037-a076-4049-a0e2-ca5d3e2bffe6',
      assessmentId: ASSESSMENT_ID,
      candidateName: 'Bob',
      candidateEmail: null,
      usedAt: null,
      expiresAt: new Date(),
      createdAt: new Date(),
    } as any)

    const app = buildApp()
    await app.ready()

    const before = Date.now()
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite-tokens',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { assessment_id: ASSESSMENT_ID, candidate_name: 'Bob', candidate_email: 'bob@example.com' },
    })
    const after = Date.now()

    expect(mockCreateToken).toHaveBeenCalledTimes(1)
    const createArgs = mockCreateToken.mock.calls[0]![0] as { data: { expiresAt: Date } }
    const expiresAt = createArgs.data.expiresAt.getTime()
    const EXPECTED_TTL_MS = 72 * 60 * 60 * 1000

    expect(expiresAt).toBeGreaterThanOrEqual(before + EXPECTED_TTL_MS - 50)
    expect(expiresAt).toBeLessThanOrEqual(after + EXPECTED_TTL_MS + 50)
  })

  test('returns 401 when no token is provided', async () => {
    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite-tokens',
      payload: VALID_BODY,
    })

    expect(response.statusCode).toBe(401)
  })

  test('returns 404 when assessment not found', async () => {
    mockAssessment.mockResolvedValue(null)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite-tokens',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID_BODY,
    })

    expect(response.statusCode).toBe(404)
  })

  test('returns 403 when assessment is closed', async () => {
    mockAssessment.mockResolvedValue({ id: ASSESSMENT_ID, createdBy: ADMIN_ID, title: 'Frontend Assessment', timeLimitMinutes: 60, status: 'CLOSED' } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite-tokens',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: VALID_BODY,
    })

    expect(response.statusCode).toBe(403)
    expect(mockCreateToken).not.toHaveBeenCalled()
  })
})
