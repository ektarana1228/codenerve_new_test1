jest.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    libraryProblem: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    libraryTestCase: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    assessment: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    problem: { create: jest.fn() },
    testCase: { create: jest.fn() },
    task: { count: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '@platform/db'
import { libraryRoutes } from './library'
import { problemRoutes } from './problems'
import { taskRoutes } from './tasks'
import { makeAuthHooks } from '../plugins/authenticate'
import { TEST_ENV } from '../testEnv'

const JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440000'
const ASSESSMENT_ID = '550e8400-e29b-41d4-a716-446655440001'
const LIBRARY_PROBLEM_ID = '550e8400-e29b-41d4-a716-446655440002'
const LIBRARY_TASK_ID = '550e8400-e29b-41d4-a716-446655440003'

const mockPrisma = jest.mocked(prisma)

function buildApp() {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  const opts = { env: { ...TEST_ENV, JWT_SECRET }, authHooks }
  app.register(libraryRoutes, opts)
  app.register(problemRoutes, opts)
  app.register(taskRoutes, opts)
  return app
}

function adminToken() {
  return jwt.sign({ sub: ADMIN_ID, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' } as any)
  // $transaction is used both callback-style (fn(tx)) and array/batch-style
  // ([...promises]) across these routes - support both forms.
  mockPrisma.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
  )
})

// ─── CODING library problems ───────────────────────────────────────────────────

describe('Library - CODING problems', () => {
  test('GET /api/v1/library/problems never returns test case content, only a count', async () => {
    mockPrisma.libraryProblem.count.mockResolvedValue(1)
    mockPrisma.libraryProblem.findMany.mockResolvedValue([
      {
        id: LIBRARY_PROBLEM_ID,
        title: 'Reverse a string',
        topic: 'Strings',
        difficulty: 'EASY',
        description: '# Reverse it',
        allowCopyPaste: false,
        createdAt: new Date(),
        testCases: [{ isHidden: false }, { isHidden: true }],
      },
    ] as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/library/problems',
      headers: { authorization: `Bearer ${adminToken()}` },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].test_case_count).toBe(2)
    expect(body.data[0].testCases).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('isHidden')
  })

  test('POST /api/v1/library/problems creates a problem with its test cases', async () => {
    mockPrisma.libraryProblem.create.mockResolvedValue({ id: LIBRARY_PROBLEM_ID } as any)
    mockPrisma.libraryProblem.findUniqueOrThrow.mockResolvedValue({
      id: LIBRARY_PROBLEM_ID,
      title: 'Reverse a string',
      topic: null,
      difficulty: 'EASY',
      description: '# Reverse it',
      allowCopyPaste: false,
      createdAt: new Date(),
      testCases: [{ isHidden: false }, { isHidden: true }],
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/library/problems',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'Reverse a string',
        description: '# Reverse it',
        difficulty: 'EASY',
        allowCopyPaste: false,
        testCases: [
          { input: 'abc', expected: 'cba', isHidden: false, category: 'EDGE', weight: 3, isCritical: true },
          { input: 'xyz', expected: 'zyx', isHidden: true },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockPrisma.libraryTestCase.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ input: 'abc', isHidden: false, category: 'EDGE', weight: 3, isCritical: true }),
          expect.objectContaining({ input: 'xyz', isHidden: true, category: 'STANDARD', weight: 1, isCritical: false }),
        ]),
      }),
    )
  })

  test('POST /api/v1/library/problems rejects a submission with no hidden test case', async () => {
    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/library/problems',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'Reverse a string',
        description: '# Reverse it',
        difficulty: 'EASY',
        testCases: [
          { input: 'abc', expected: 'cba', isHidden: false },
          { input: 'xyz', expected: 'zyx', isHidden: false },
        ],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR')
  })

  test('DELETE /api/v1/library/problems/:id removes test cases before the problem', async () => {
    mockPrisma.libraryProblem.findUnique.mockResolvedValue({ id: LIBRARY_PROBLEM_ID, kind: 'CODING' } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/library/problems/${LIBRARY_PROBLEM_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    })

    expect(response.statusCode).toBe(204)
    expect(mockPrisma.libraryTestCase.deleteMany).toHaveBeenCalledWith({ where: { libraryProblemId: LIBRARY_PROBLEM_ID } })
    expect(mockPrisma.libraryProblem.delete).toHaveBeenCalledWith({ where: { id: LIBRARY_PROBLEM_ID } })
  })
})

// ─── PROJECT library tasks ──────────────────────────────────────────────────────

describe('Library - PROJECT tasks', () => {
  test('POST /api/v1/library/tasks stores doneWhen/referenceFiles/solutionFiles', async () => {
    mockPrisma.libraryProblem.create.mockResolvedValue({
      id: LIBRARY_TASK_ID,
      title: 'Fix pagination',
      difficulty: 'EASY',
      language: 'JAVASCRIPT',
      description: 'Bug: off by one',
      doneWhen: ['paginate() returns the right count'],
      referenceFiles: [{ path: 'pagination.js', contentBase64: 'YnVn' }],
      solutionFiles: [{ path: 'pagination.js', contentBase64: 'Zml4' }],
      createdAt: new Date(),
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/library/tasks',
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'Fix pagination',
        description: 'Bug: off by one',
        difficulty: 'EASY',
        language: 'JAVASCRIPT',
        doneWhen: ['paginate() returns the right count'],
        referenceFiles: [{ path: 'pagination.js', contentBase64: 'YnVn' }],
        solutionFiles: [{ path: 'pagination.js', contentBase64: 'Zml4' }],
      },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.data.files).toEqual([{ path: 'pagination.js', contentBase64: 'YnVn' }])
    expect(body.data.solution_files).toEqual([{ path: 'pagination.js', contentBase64: 'Zml4' }])
  })
})

// ─── Adding a library problem/task to an assessment ─────────────────────────────

describe('POST /api/v1/assessments/:id/problems/from-library', () => {
  test('copies the library problem + test cases into a new Problem/TestCase, server-side', async () => {
    mockPrisma.assessment.findUnique.mockResolvedValue({ id: ASSESSMENT_ID, createdBy: ADMIN_ID } as any)
    mockPrisma.libraryProblem.findUnique.mockResolvedValue({
      id: LIBRARY_PROBLEM_ID,
      kind: 'CODING',
      title: 'Reverse a string',
      description: '# Reverse it',
      difficulty: 'EASY',
      allowCopyPaste: false,
      testCases: [
        { input: 'abc', expected: 'cba', isHidden: false },
        { input: 'xyz', expected: 'zyx', isHidden: true },
      ],
    } as any)
    mockPrisma.problem.create.mockResolvedValue({
      id: 'new-problem-id', assessmentId: ASSESSMENT_ID, title: 'Reverse a string', description: '# Reverse it', difficulty: 'EASY', allowCopyPaste: false, createdAt: new Date(),
    } as any)
    mockPrisma.testCase.create
      .mockResolvedValueOnce({ id: 'tc-1', problemId: 'new-problem-id', input: 'abc', expected: 'cba', isHidden: false, createdAt: new Date() } as any)
      .mockResolvedValueOnce({ id: 'tc-2', problemId: 'new-problem-id', input: 'xyz', expected: 'zyx', isHidden: true, createdAt: new Date() } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${ASSESSMENT_ID}/problems/from-library`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { library_id: LIBRARY_PROBLEM_ID },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.data.test_cases).toHaveLength(2)
    expect(mockPrisma.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assessmentId: ASSESSMENT_ID, title: 'Reverse a string' }) }),
    )
  })
})

describe('POST /api/v1/assessments/:id/tasks', () => {
  test('rejects tasks on a CODING assessment', async () => {
    mockPrisma.assessment.findUnique.mockResolvedValue({ id: ASSESSMENT_ID, createdBy: ADMIN_ID } as any)
    mockPrisma.assessment.findUniqueOrThrow.mockResolvedValue({ kind: 'CODING', referenceFiles: null, solutionFiles: null } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${ASSESSMENT_ID}/tasks`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { title: 'Task', description: 'Desc', doneWhen: ['done'] },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR')
  })

  test('appends referenceFiles/solutionFiles onto the assessment and creates the task', async () => {
    mockPrisma.assessment.findUnique.mockResolvedValue({ id: ASSESSMENT_ID, createdBy: ADMIN_ID } as any)
    mockPrisma.assessment.findUniqueOrThrow.mockResolvedValue({
      kind: 'PROJECT',
      referenceFiles: [{ path: 'existing.js', contentBase64: 'eA==' }],
      solutionFiles: [],
    } as any)
    mockPrisma.task.count.mockResolvedValue(1)
    mockPrisma.task.create.mockResolvedValue({
      id: 'task-1', assessmentId: ASSESSMENT_ID, order: 1, title: 'Fix it', description: 'Desc', doneWhen: ['done'], createdAt: new Date(),
    } as any)

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/assessments/${ASSESSMENT_ID}/tasks`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        title: 'Fix it',
        description: 'Desc',
        doneWhen: ['done'],
        difficulty: 'EASY',
        referenceFiles: [{ path: 'new.js', contentBase64: 'bmV3' }],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockPrisma.assessment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referenceFiles: [{ path: 'existing.js', contentBase64: 'eA==' }, { path: 'new.js', contentBase64: 'bmV3' }],
        }),
      }),
    )
    expect(mockPrisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 1, title: 'Fix it' }) }),
    )
  })
})
