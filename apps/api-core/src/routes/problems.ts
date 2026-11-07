import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { CreateProblemRequestSchema, CreateTestCaseRequestSchema } from '@platform/types'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'
import { problemBank, problemBankTopics } from '../problemBank'
import { isMaster } from '../lib/roles'

// ─── Serialisers ──────────────────────────────────────────────────────────────

function serializeTestCase(tc: {
  id: string
  problemId: string
  input: string
  expected: string
  isHidden: boolean
  category?: string
  weight?: number
  isCritical?: boolean
  createdAt: Date
}) {
  return {
    id: tc.id,
    problem_id: tc.problemId,
    input: tc.input,
    expected: tc.expected,
    is_hidden: tc.isHidden,
    category: tc.category ?? 'STANDARD',
    weight: tc.weight ?? 1,
    is_critical: tc.isCritical ?? false,
    created_at: tc.createdAt.toISOString(),
  }
}

function serializeProblem(
  p: {
    id: string
    assessmentId: string
    title: string
    description: string
    difficulty: string
    allowCopyPaste?: boolean
    createdAt: Date
  },
  testCases: ReturnType<typeof serializeTestCase>[],
) {
  return {
    id: p.id,
    assessment_id: p.assessmentId,
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    allow_copy_paste: p.allowCopyPaste ?? false,
    created_at: p.createdAt.toISOString(),
    test_cases: testCases,
  }
}

// ─── Shared guards ────────────────────────────────────────────────────────────

/**
 * Finds an assessment by id, verifies it belongs to the requesting admin,
 * and returns it. Calls sendError and returns null if not found/forbidden.
 */
export async function requireOwnedAssessment(
  reply: Parameters<typeof sendError>[0],
  assessmentId: string,
  adminId: string,
  master = false,
) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, createdBy: true },
  })

  if (!assessment || (!master && assessment.createdBy !== adminId)) {
    sendError(reply, 'NOT_FOUND', 'Assessment not found')
    return null
  }

  return assessment
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

const assessmentIdParam = z.object({ id: z.string().uuid() })
const problemParams = z.object({ id: z.string().uuid(), problem_id: z.string().uuid() })

export async function problemRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  fastify.get<{
    Querystring: { search?: string; topic?: string; difficulty?: string; page?: string; limit?: string }
  }>(
    '/api/v1/problem-bank',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const query = z.object({
        search: z.string().max(100).default(''),
        topic: z.string().max(50).optional(),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }).safeParse(request.query)
      if (!query.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid problem bank filters')
      const search = query.data.search.trim().toLowerCase()
      const filtered = problemBank.filter((problem) =>
        (!search || `${problem.title} ${problem.topic} ${problem.description}`.toLowerCase().includes(search)) &&
        (!query.data.topic || problem.topic === query.data.topic) &&
        (!query.data.difficulty || problem.difficulty === query.data.difficulty),
      )
      const start = (query.data.page - 1) * query.data.limit
      return reply.send({
        data: filtered.slice(start, start + query.data.limit).map((problem) => ({
          id: problem.id,
          title: problem.title,
          topic: problem.topic,
          difficulty: problem.difficulty,
          description: problem.description,
          test_case_count: problem.testCases.length,
          reference_solutions: problem.referenceSolutions,
          time_complexity: problem.timeComplexity,
          space_complexity: problem.spaceComplexity,
        })),
        topics: problemBankTopics,
        total: filtered.length,
        page: query.data.page,
        pages: Math.max(1, Math.ceil(filtered.length / query.data.limit)),
      })
    },
  )

  // ── POST /api/v1/assessments/:id/problems ───────────────────────────────────
  // Creates a problem and its initial test cases in a single transaction.
  // FR-02 mandates ≥1 visible and ≥1 hidden test case - enforced by
  // CreateProblemRequestSchema before we touch the DB.

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/assessments/:id/problems',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = assessmentIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }

      const { id: assessmentId } = paramsResult.data
      const adminId = request.jwtPayload!.sub

      const assessment = await requireOwnedAssessment(reply, assessmentId, adminId, isMaster(request.jwtPayload))
      if (!assessment) return
      const result = CreateProblemRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const { title, description, difficulty, allowCopyPaste, testCases } = result.data

      // Create problem + all test cases atomically
      const { problem, createdTestCases } = await prisma.$transaction(async (tx) => {
        const problem = await tx.problem.create({
          data: {
            assessmentId,
            title,
            description,
            difficulty,
            allowCopyPaste,
          } as never,
        })

        const createdTestCases = await Promise.all(
          testCases.map((tc) =>
            tx.testCase.create({
              data: {
                problemId: problem.id,
                input: tc.input,
                expected: tc.expected,
                isHidden: tc.isHidden,
                category: tc.category,
                weight: tc.weight,
                isCritical: tc.isCritical,
              },
            }),
          ),
        )

        return { problem, createdTestCases }
      })

      return reply.status(201).send({
        data: serializeProblem(problem, createdTestCases.map(serializeTestCase)),
      })
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/assessments/:id/problems/from-bank',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = assessmentIdParam.safeParse(request.params)
      const body = z.object({ bank_id: z.string().min(1).max(100) }).safeParse(request.body)
      if (!params.success || !body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid bank problem request')
      const assessment = await requireOwnedAssessment(reply, params.data.id, request.jwtPayload!.sub, isMaster(request.jwtPayload))
      if (!assessment) return
      const entry = problemBank.find((problem) => problem.id === body.data.bank_id)
      if (!entry) return sendError(reply, 'NOT_FOUND', 'Bank problem not found')

      const { problem, createdTestCases } = await prisma.$transaction(async (tx) => {
        const problem = await tx.problem.create({
          data: {
            assessmentId: assessment.id,
            title: entry.title,
            description: entry.description,
            difficulty: entry.difficulty,
            allowCopyPaste: false,
          } as never,
        })
        const createdTestCases = await Promise.all(entry.testCases.map((testCase) => tx.testCase.create({
          data: { problemId: problem.id, input: testCase.input, expected: testCase.expected, isHidden: testCase.isHidden },
        })))
        return { problem, createdTestCases }
      })
      return reply.status(201).send({ data: serializeProblem(problem, createdTestCases.map(serializeTestCase)) })
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/assessments/:id/problems/from-library',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = assessmentIdParam.safeParse(request.params)
      const body = z.object({ library_id: z.string().uuid() }).safeParse(request.body)
      if (!params.success || !body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid library problem request')
      const assessment = await requireOwnedAssessment(reply, params.data.id, request.jwtPayload!.sub, isMaster(request.jwtPayload))
      if (!assessment) return

      const entry = await prisma.libraryProblem.findUnique({
        where: { id: body.data.library_id },
        include: { testCases: true },
      })
      if (!entry || entry.kind !== 'CODING') return sendError(reply, 'NOT_FOUND', 'Library problem not found')

      const { problem, createdTestCases } = await prisma.$transaction(async (tx) => {
        const problem = await tx.problem.create({
          data: {
            assessmentId: assessment.id,
            title: entry.title,
            description: entry.description,
            difficulty: entry.difficulty,
            allowCopyPaste: entry.allowCopyPaste,
          } as never,
        })
        const createdTestCases = await Promise.all(entry.testCases.map((testCase) => tx.testCase.create({
          data: {
            problemId: problem.id,
            input: testCase.input,
            expected: testCase.expected,
            isHidden: testCase.isHidden,
            category: testCase.category,
            weight: testCase.weight,
            isCritical: testCase.isCritical,
          },
        })))
        return { problem, createdTestCases }
      })
      return reply.status(201).send({ data: serializeProblem(problem, createdTestCases.map(serializeTestCase)) })
    },
  )

  // ── POST /api/v1/assessments/:id/problems/:problem_id/test-cases ────────────
  // Appends a single test case to an existing problem.
  // Validates that both the assessment and the problem exist and belong to
  // this admin before writing.

  fastify.post<{ Params: { id: string; problem_id: string } }>(
    '/api/v1/assessments/:id/problems/:problem_id/test-cases',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = problemParams.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id and problem_id must be valid UUIDs')
      }

      const { id: assessmentId, problem_id: problemId } = paramsResult.data
      const adminId = request.jwtPayload!.sub

      // Verify assessment ownership
      const assessment = await requireOwnedAssessment(reply, assessmentId, adminId, isMaster(request.jwtPayload))
      if (!assessment) return

      // Verify problem belongs to this assessment
      const problem = await prisma.problem.findUnique({
        where: { id: problemId },
        select: { id: true, assessmentId: true },
      })

      if (!problem || problem.assessmentId !== assessmentId) {
        return sendError(reply, 'NOT_FOUND', 'Problem not found')
      }

      const result = CreateTestCaseRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const { input, expected, isHidden, category, weight, isCritical } = result.data

      const testCase = await prisma.testCase.create({
        data: { problemId, input, expected, isHidden, category, weight, isCritical },
      })

      return reply.status(201).send({ data: serializeTestCase(testCase) })
    },
  )
}
