jest.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    assessment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    session: { count: jest.fn() },
  },
}))

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '@platform/db'
import { assessmentRoutes } from './assessments'
import { makeAuthHooks } from '../plugins/authenticate'
import { TEST_ENV } from '../testEnv'

const JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440000'
const ASSESSMENT_ID = '550e8400-e29b-41d4-a716-446655440001'

const mockPrisma = jest.mocked(prisma)

function buildApp() {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  app.register(assessmentRoutes, {
    env: { ...TEST_ENV, JWT_SECRET },
    authHooks,
  })
  return app
}

function adminToken() {
  return jwt.sign({ sub: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' })
}

const EXISTING_ASSESSMENT = {
  id: ASSESSMENT_ID,
  title: 'Test',
  description: null,
  createdBy: ADMIN_ID,
  kind: 'CODING',
  timeLimitMinutes: 60,
  language: 'PYTHON',
  llmModel: 'openai/gpt-4o-mini',
  codeWeight: 60,
  aiuWeight: 40,
  aiuMetrics: ['PROMPT_QUALITY'],
  aiuMetricWeights: { prompt_quality: 100 },
  status: 'DRAFT',
  scheduledStart: null,
  expiresAt: null,
  createdAt: new Date(),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' } as any)
})

// ─── POST /api/v1/assessments - weight validation ─────────────────────────────

describe('POST /api/v1/assessments - weight validation', () => {
  test.each(['AGENTIC', 'NON_AGENTIC'])('rejects %s assistant mode for coding assessments', async (aiAssistantMode) => {
    const app = buildApp()
    await app.ready()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'Disabled assistant assessment', timeLimitMinutes: 60, language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini', codeWeight: 100, aiuWeight: 0,
        aiuMetrics: ['PROMPT_QUALITY'], aiuMetricWeights: { prompt_quality: 100 }, aiAssistantMode,
      },
    })
    expect(response.statusCode).toBe(400)
  })

  test.each(['AGENTIC', 'NON_AGENTIC', 'DISABLED'])('accepts %s assistant mode for project assessments', async (aiAssistantMode) => {
    mockPrisma.assessment.create.mockResolvedValue({
      ...EXISTING_ASSESSMENT,
      kind: 'PROJECT',
      codeWeight: 100,
      aiuWeight: 0,
      aiAssistantMode,
    } as any)
    const app = buildApp()
    await app.ready()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'Project assessment',
        kind: 'PROJECT',
        timeLimitMinutes: 60,
        language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini',
        codeWeight: 100,
        aiuWeight: 0,
        aiuMetrics: ['PROMPT_QUALITY'],
        aiuMetricWeights: { prompt_quality: 100 },
        aiAssistantMode,
        tasks: [{ title: 'Task', description: 'Do the migration', doneWhen: ['It works'] }],
      },
    })
    expect(response.statusCode).toBe(201)
    expect(mockPrisma.assessment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ aiAssistantMode }),
      }),
    )
  })

  test('returns 400 VALIDATION_ERROR when codeWeight + aiuWeight ≠ 100', async () => {
    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'My Assessment',
        timeLimitMinutes: 60,
        language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini',
        codeWeight: 70,
        aiuWeight: 40, // 70 + 40 = 110 ≠ 100
        aiuMetrics: ['PROMPT_QUALITY'],
        aiuMetricWeights: { prompt_quality: 100 },
      },
    })

    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('returns 400 VALIDATION_ERROR when AIU metric weights do not sum to 100', async () => {
    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'My Assessment',
        timeLimitMinutes: 60,
        language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini',
        codeWeight: 60,
        aiuWeight: 40,
        aiuMetrics: ['PROMPT_QUALITY', 'ITERATION_EFFICIENCY'],
        aiuMetricWeights: { prompt_quality: 60, iteration_efficiency: 30 }, // 60+30=90≠100
      },
    })

    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('accepts valid weights (60 + 40 = 100, metrics sum = 100)', async () => {
    mockPrisma.assessment.create.mockResolvedValue({
      ...EXISTING_ASSESSMENT,
      codeWeight: 60,
      aiuWeight: 40,
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'My Assessment',
        timeLimitMinutes: 60,
        language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini',
        codeWeight: 60,
        aiuWeight: 40,
        aiuMetrics: ['PROMPT_QUALITY'],
        aiuMetricWeights: { prompt_quality: 100 },
      },
    })

    expect(response.statusCode).toBe(201)
  })

  test('validates and stores proctoring modes', async () => {
    mockPrisma.assessment.create.mockResolvedValue(EXISTING_ASSESSMENT as any)
    const app = buildApp()
    await app.ready()

    const payload = {
      title: 'Proctored Assessment',
      timeLimitMinutes: 60,
      language: 'PYTHON',
      llmModel: 'openai/gpt-4o-mini',
      codeWeight: 60,
      aiuWeight: 40,
      aiuMetrics: ['PROMPT_QUALITY'],
      aiuMetricWeights: { prompt_quality: 100 },
      screenRecording: 'REQUIRED',
    }

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload,
    })
    expect(accepted.statusCode).toBe(201)
    expect(mockPrisma.assessment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ screenRecording: 'REQUIRED' }),
      }),
    )

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/assessments',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { ...payload, screenRecording: 'ALWAYS' },
    })
    expect(rejected.statusCode).toBe(400)
  })
})

// ─── PATCH /api/v1/assessments/:id - weight validation ────────────────────────

describe('PATCH /api/v1/assessments/:id - weight validation', () => {
  beforeEach(() => {
    mockPrisma.assessment.findUnique.mockResolvedValue(EXISTING_ASSESSMENT as any)
    mockPrisma.session.count.mockResolvedValue(0)
  })

  test('returns 400 when merged codeWeight + aiuWeight ≠ 100', async () => {
    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/assessments/${ASSESSMENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      // existing is 60/40; patching aiuWeight to 50 makes 60+50=110
      payload: { aiuWeight: 50 },
    })

    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('returns 400 when AIU metric weights do not sum to 100', async () => {
    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/assessments/${ASSESSMENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { aiuMetricWeights: { prompt_quality: 40, iteration_efficiency: 40 } }, // 80≠100
    })

    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('allows closing an assessment after candidates have started', async () => {
    mockPrisma.session.count.mockResolvedValue(2)
    mockPrisma.assessment.update.mockResolvedValue({
      ...EXISTING_ASSESSMENT,
      status: 'CLOSED',
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/assessments/${ASSESSMENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: 'CLOSED' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockPrisma.assessment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSESSMENT_ID },
        data: expect.objectContaining({ status: 'CLOSED' }),
      }),
    )
  })

  test('still blocks non-close edits after candidates have started', async () => {
    mockPrisma.session.count.mockResolvedValue(1)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/assessments/${ASSESSMENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { title: 'Updated title' },
    })

    expect(response.statusCode).toBe(403)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('FORBIDDEN')
  })
})
