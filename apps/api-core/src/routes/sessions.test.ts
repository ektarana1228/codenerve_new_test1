// All external dependencies must be mocked before any route code is imported
jest.mock('@platform/db', () => ({
  prisma: {
    inviteToken: { findUnique: jest.fn(), update: jest.fn() },
    user: { upsert: jest.fn() },
    session: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    proctorEvent: { findFirst: jest.fn(), updateMany: jest.fn() },
    proctorMedia: { updateMany: jest.fn() },
    sessionScore: { create: jest.fn(), upsert: jest.fn() },
    runEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  expire: jest.fn().mockResolvedValue(1),
}

jest.mock('../lib/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
}))

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({}),
  })),
}))

jest.mock('../lib/sandbox', () => ({
  runCode: jest.fn().mockResolvedValue({
    status: 'completed',
    passed: 2,
    failed: 0,
    results: [
      { testCaseId: 'tc-1', status: 'pass', stdout: '42\n', stderr: '' },
      { testCaseId: 'tc-2', status: 'pass', stdout: '42\n', stderr: '' },
    ],
  }),
}))

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { Queue } from 'bullmq'
import { prisma } from '@platform/db'
import { runCode } from '../lib/sandbox'
import { sessionRoutes } from './sessions'
import { makeAuthHooks } from '../plugins/authenticate'
import { TEST_ENV } from '../testEnv'

const JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440000'
const CANDIDATE_ID = '550e8400-e29b-41d4-a716-446655440001'
const SESSION_ID = '550e8400-e29b-41d4-a716-446655440002'
const ASSESSMENT_ID = '550e8400-e29b-41d4-a716-446655440003'

const mockPrisma = jest.mocked(prisma)

function buildApp() {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  app.register(sessionRoutes, {
    env: { ...TEST_ENV, JWT_SECRET },
    authHooks,
  })
  return app
}

function candidateToken(sessionId: string) {
  return jwt.sign({ sub: CANDIDATE_ID, role: 'STUDENT', session_id: sessionId }, JWT_SECRET, {
    expiresIn: '1h',
  })
}

const ACTIVE_SESSION = {
  id: SESSION_ID,
  assessmentId: ASSESSMENT_ID,
  candidateId: CANDIDATE_ID,
  language: 'PYTHON',
  status: 'ACTIVE',
  currentCode: 'print(42)',
  startedAt: new Date(Date.now() - 10000),
  submittedAt: null,
  expiresAt: new Date(Date.now() + 3600000),
  score: null,
}

const ASSESSMENT_WITH_PROBLEMS = {
  id: ASSESSMENT_ID,
  language: 'PYTHON',
  aiAssistantMode: 'NON_AGENTIC',
  scoringStrictness: 'MEDIUM',
  timeLimitMinutes: 60,
  llmModel: 'openai/gpt-4o-mini',
  problems: [
    {
      id: 'prob-1',
      title: 'Problem',
      description: 'Desc',
      testCases: [
        { id: 'tc-vis-1', input: '1', expected: '1', isHidden: false },
        { id: 'tc-vis-2', input: '2', expected: '2', isHidden: false },
        { id: 'tc-hid-1', input: '3', expected: '3', isHidden: true },
        { id: 'tc-hid-2', input: '4', expected: '4', isHidden: true },
      ],
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── POST /api/v1/sessions/start ─────────────────────────────────────────────

describe('POST /api/v1/sessions/start - invite token lifecycle', () => {
  const VALID_TOKEN_UUID = '7d793037-a076-4049-a0e2-ca5d3e2bffe6'

  function mockValidInviteToken(extra: Partial<{ usedAt: Date | null; expiresAt: Date }> = {}) {
    const invite = {
      id: 'invite-id',
      token: VALID_TOKEN_UUID,
      candidateName: 'Alice',
      candidateEmail: 'alice@example.com',
      usedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      assessment: ASSESSMENT_WITH_PROBLEMS,
      ...extra,
    }
    mockPrisma.inviteToken.findUnique.mockResolvedValue(invite as any)
    return invite
  }

  function mockTransaction() {
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      const newSession = { ...ACTIVE_SESSION }
      mockPrisma.user.upsert.mockResolvedValue({ id: CANDIDATE_ID, email: 'alice@example.com', role: 'STUDENT' } as any)
      mockPrisma.session.create.mockResolvedValue(newSession as any)
      mockPrisma.inviteToken.update.mockResolvedValue({} as any)
      return fn(mockPrisma)
    })
  }

  test('creates the session in a transaction without consuming a reusable invite token', async () => {
    mockValidInviteToken()
    mockTransaction()

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
    })

    expect(response.statusCode).toBe(201)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.inviteToken.update).not.toHaveBeenCalled()
    expect(mockPrisma.session.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ inviteTokenId: 'invite-id' }),
    }))
    expect(mockPrisma.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inviteTokenId: 'invite-id' }),
    }))
  })

  test('a different invite for the same assessment creates a fresh attempt', async () => {
    const invite = mockValidInviteToken()
    mockPrisma.inviteToken.findUnique.mockResolvedValue({ ...invite, id: 'new-invite-id' } as any)
    mockTransaction()

    const app = buildApp()
    await app.ready()
    const response = await app.inject({
      method: 'POST', url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
    })

    expect(response.statusCode).toBe(201)
    expect(mockPrisma.session.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ inviteTokenId: 'new-invite-id' }),
    }))
    expect(mockPrisma.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inviteTokenId: 'new-invite-id' }),
    }))
  })

  test.each(['LOW', 'MEDIUM', 'HIGH', 'EXTRA_HIGH'])(
    'snapshots %s scoring strictness when the session is created',
    async (scoringStrictness) => {
      const invite = mockValidInviteToken()
      mockPrisma.inviteToken.findUnique.mockResolvedValue({
        ...invite,
        assessment: { ...invite.assessment, scoringStrictness },
      } as any)
      mockTransaction()

      const app = buildApp()
      await app.ready()
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions/start',
        payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
      })

      expect(response.statusCode).toBe(201)
      expect(mockPrisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scoringStrictness }),
        }),
      )
    },
  )

  test('returns exactly 2 visible test cases for a problem with 2 visible + 2 hidden', async () => {
    mockValidInviteToken()
    mockTransaction()

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.data.problem.visible_test_cases).toHaveLength(2)
    // Verify the hidden test cases are absent
    const tcIds = body.data.problem.visible_test_cases.map((tc: { id: string }) => tc.id)
    expect(tcIds).not.toContain('tc-hid-1')
    expect(tcIds).not.toContain('tc-hid-2')
  })

  test('returns all problems and seeds a separate solution file for each one', async () => {
    const invite = mockValidInviteToken()
    mockPrisma.inviteToken.findUnique.mockResolvedValue({
      ...(invite as any),
      assessment: {
        ...(invite as any).assessment,
        problems: [
          ...(invite as any).assessment.problems,
          { ...(invite as any).assessment.problems[0], id: 'prob-2', title: 'Second problem' },
        ],
      },
    } as any)
    mockTransaction()

    const app = buildApp()
    await app.ready()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
    })

    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body).data.problems.map((problem: { solution_file: string }) => problem.solution_file)).toEqual([
      'problem-01.py',
      'problem-02.py',
    ])
    const createCall = mockPrisma.session.create.mock.calls[0]![0] as any
    expect(Object.keys(JSON.parse(createCall.data.currentCode).files)).toEqual(['problem-01.py', 'problem-02.py'])
  })

  test('uses solution.py for a single-problem assessment', async () => {
    mockValidInviteToken()
    mockTransaction()

    const app = buildApp()
    await app.ready()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.data.problems[0].solution_file).toBe('solution.py')
    expect(body.data.current_code).not.toContain('problem-01.py')
    expect((mockPrisma.session.create.mock.calls[0]![0] as any).data.currentCode).not.toContain('problem-01.py')
  })

  test('stores the candidate-provided name even when it differs from the invite (name is never verified)', async () => {
    mockValidInviteToken()
    mockTransaction()

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: {
        token: VALID_TOKEN_UUID,
        candidate_name: 'Bob Candidate',
        candidate_email: 'alice@example.com',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockPrisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateName: 'Bob Candidate',
        }),
      }),
    )
  })

  test('returns FORBIDDEN when the candidate email does not match the invite', async () => {
    mockValidInviteToken()

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'someone-else@example.com' },
    })

    expect(response.statusCode).toBe(403)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  test('still allows a start when invite token has a legacy usedAt value', async () => {
    mockValidInviteToken({ usedAt: new Date(Date.now() - 1000) })
    mockTransaction()

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
    })

    expect(response.statusCode).toBe(201)
  })

  test('returns 401 TOKEN_EXPIRED when invite token is past its TTL', async () => {
    mockValidInviteToken({ expiresAt: new Date(Date.now() - 1000) })

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/start',
      payload: { token: VALID_TOKEN_UUID, candidate_email: 'alice@example.com' },
    })

    expect(response.statusCode).toBe(401)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('TOKEN_EXPIRED')
  })
})

// ─── PATCH /api/v1/sessions/:id/code (auto-save) ─────────────────────────────

describe('PATCH /api/v1/sessions/:id/code - auto-save', () => {
  test('writes new code to both DB and Redis', async () => {
    mockPrisma.session.findUnique.mockResolvedValue(ACTIVE_SESSION as any)
    mockPrisma.session.update.mockResolvedValue({ ...ACTIVE_SESSION, currentCode: 'x=1' } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sessions/${SESSION_ID}/code`,
      headers: { authorization: `Bearer ${candidateToken(SESSION_ID)}` },
      payload: { code: 'x=1' },
    })

    expect(response.statusCode).toBe(200)
    // DB write
    expect(mockPrisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentCode: 'x=1' } }),
    )
    // Redis write - mockRedis.set is the ioredis set mock
    expect(mockRedis.set).toHaveBeenCalledWith(
      `session:${SESSION_ID}:code`,
      'x=1',
      'EX',
      expect.any(Number),
    )
  })

  test('returns 409 SUBMISSION_LOCKED when session is already submitted', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      ...ACTIVE_SESSION,
      status: 'SUBMITTED',
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sessions/${SESSION_ID}/code`,
      headers: { authorization: `Bearer ${candidateToken(SESSION_ID)}` },
      payload: { code: 'x=1' },
    })

    expect(response.statusCode).toBe(409)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('SUBMISSION_LOCKED')
  })
})

// ─── POST /api/v1/sessions/:id/submit ────────────────────────────────────────

describe('POST /api/v1/sessions/:id/submit', () => {
  const SESSION_WITH_ASSESSMENT = {
    ...ACTIVE_SESSION,
    assessment: {
      ...ASSESSMENT_WITH_PROBLEMS,
      codeWeight: 60,
      aiuWeight: 40,
    },
  }

  test('enqueues AIU scoring job to Redis queue after submission', async () => {
    mockPrisma.session.findUnique.mockResolvedValue(SESSION_WITH_ASSESSMENT as any)
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      mockPrisma.sessionScore.create.mockResolvedValue({} as any)
      mockPrisma.session.update.mockResolvedValue({} as any)
      return fn(mockPrisma)
    })

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${SESSION_ID}/submit`,
      headers: { authorization: `Bearer ${candidateToken(SESSION_ID)}` },
    })

    expect(response.statusCode).toBe(200)
    expect(mockPrisma.sessionScore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ rubricVersion: 'DISABLED_TECHNICAL_V2' }),
        update: expect.objectContaining({
          codeCorrectnessScore: 52.5,
          aiuTotalScore: 0,
          totalScore: 0,
          aiuScores: expect.objectContaining({
            correctness: 0,
            efficiency: 0,
            robustness: 0,
            code_quality: 0,
          }),
          scoreEvidence: expect.objectContaining({
            coding_test_evidence: expect.objectContaining({
              problems: expect.arrayContaining([
                expect.objectContaining({
                  category_states: expect.objectContaining({
                    efficiency: 'NOT_MEASURED',
                    robustness: 'NOT_MEASURED',
                    codeQuality: 'INSUFFICIENT_CODE',
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    )

    const QueueConstructor = jest.mocked(Queue)
    const queueInstance = QueueConstructor.mock.results[0]!.value
    expect(queueInstance.add).toHaveBeenCalledWith(
      'score',
      { session_id: SESSION_ID },
      expect.any(Object),
    )
  })

  test('scores each problem against its own solution file', async () => {
    const secondProblem = {
      ...ASSESSMENT_WITH_PROBLEMS.problems[0],
      id: 'prob-2',
      testCases: [{ id: 'tc-2', input: '2', expected: '2', isHidden: true }],
    }
    mockPrisma.session.findUnique.mockResolvedValue({
      ...SESSION_WITH_ASSESSMENT,
      currentCode: JSON.stringify({
        __multifile__: true,
        main: 'problem-01.py',
        files: { 'problem-01.py': 'print(1)', 'problem-02.py': 'print(2)' },
      }),
      assessment: { ...SESSION_WITH_ASSESSMENT.assessment, problems: [ASSESSMENT_WITH_PROBLEMS.problems[0], secondProblem] },
    } as any)
    jest.mocked(runCode).mockResolvedValueOnce({ status: 'completed', passed: 4, failed: 0, results: [] }).mockResolvedValueOnce({ status: 'completed', passed: 1, failed: 0, results: [] })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(mockPrisma))

    const app = buildApp()
    await app.ready()
    const response = await app.inject({ method: 'POST', url: `/api/v1/sessions/${SESSION_ID}/submit`, headers: { authorization: `Bearer ${candidateToken(SESSION_ID)}` } })

    expect(response.statusCode).toBe(200)
    expect(jest.mocked(runCode).mock.calls.map((call) => call[1].code)).toEqual(['print(1)', 'print(2)'])
  })

  test('returns 409 SUBMISSION_LOCKED when session already has status SUBMITTED', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      ...SESSION_WITH_ASSESSMENT,
      status: 'SUBMITTED',
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${SESSION_ID}/submit`,
      headers: { authorization: `Bearer ${candidateToken(SESSION_ID)}` },
    })

    expect(response.statusCode).toBe(409)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('SUBMISSION_LOCKED')
  })

  test('returns 401 SESSION_EXPIRED when session timer has elapsed', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      ...SESSION_WITH_ASSESSMENT,
      expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${SESSION_ID}/submit`,
      headers: { authorization: `Bearer ${candidateToken(SESSION_ID)}` },
    })

    expect(response.statusCode).toBe(401)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('SESSION_EXPIRED')
  })
})

describe('POST /api/v1/sessions/:id/run', () => {
  test('runs the requested problem using its own solution file', async () => {
    const firstProblem = {
      ...ASSESSMENT_WITH_PROBLEMS.problems[0],
      id: '550e8400-e29b-41d4-a716-446655440010',
    }
    const secondProblem = {
      ...ASSESSMENT_WITH_PROBLEMS.problems[0],
      id: '550e8400-e29b-41d4-a716-446655440011',
    }
    const code = JSON.stringify({
      __multifile__: true,
      main: 'problem-01.py',
      files: { 'problem-01.py': 'print(1)', 'problem-02.py': 'print(2)' },
    })
    mockPrisma.session.findUnique.mockResolvedValue({
      ...ACTIVE_SESSION,
      assessment: { ...ASSESSMENT_WITH_PROBLEMS, problems: [firstProblem, secondProblem] },
    } as any)

    const app = buildApp()
    await app.ready()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${SESSION_ID}/run`,
      headers: { authorization: `Bearer ${candidateToken(SESSION_ID)}` },
      payload: { code, problem_id: secondProblem.id },
    })

    expect(response.statusCode).toBe(200)
    expect(jest.mocked(runCode).mock.calls[0]?.[1].code).toBe('print(2)')
    expect(jest.mocked(runCode).mock.calls[0]?.[1].extraFiles).toBeUndefined()
    expect(mockPrisma.runEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: SESSION_ID,
        problemId: secondProblem.id,
        status: 'completed',
        passed: 2,
        failed: 0,
        codeSnapshot: code,
      }),
    })
  })

})
