import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import {
  CreateLibraryProblemRequestSchema,
  UpdateLibraryProblemRequestSchema,
  CreateLibraryTaskRequestSchema,
  UpdateLibraryTaskRequestSchema,
  DifficultySchema,
  LanguageSchema,
} from '@platform/types'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'

// ─── Serialisers ──────────────────────────────────────────────────────────────

function serializeLibraryProblem(p: {
  id: string
  title: string
  topic: string | null
  difficulty: string
  description: string
  allowCopyPaste: boolean
  createdAt: Date
  testCases: Array<{ isHidden: boolean }>
}) {
  return {
    id: p.id,
    title: p.title,
    topic: p.topic,
    difficulty: p.difficulty,
    description: p.description,
    allow_copy_paste: p.allowCopyPaste,
    test_case_count: p.testCases.length,
    created_at: p.createdAt.toISOString(),
  }
}

function serializeLibraryProblemDetail(p: {
  id: string
  title: string
  topic: string | null
  difficulty: string
  description: string
  allowCopyPaste: boolean
  createdAt: Date
  testCases: Array<{ id: string; input: string; expected: string; isHidden: boolean; category?: string; weight?: number; isCritical?: boolean }>
}) {
  return {
    ...serializeLibraryProblem(p),
    test_cases: p.testCases.map((tc) => ({
      id: tc.id,
      input: tc.input,
      expected: tc.expected,
      is_hidden: tc.isHidden,
      category: tc.category ?? 'STANDARD',
      weight: tc.weight ?? 1,
      is_critical: tc.isCritical ?? false,
    })),
  }
}

function serializeLibraryTask(t: {
  id: string
  title: string
  difficulty: string
  language: string | null
  description: string
  doneWhen: unknown
  referenceFiles: unknown
  solutionFiles: unknown
  createdAt: Date
}) {
  return {
    id: t.id,
    title: t.title,
    difficulty: t.difficulty,
    language: t.language,
    description: t.description,
    done_when: Array.isArray(t.doneWhen) ? (t.doneWhen as string[]) : [],
    files: (t.referenceFiles as Array<{ path: string; contentBase64: string }> | null) ?? [],
    solution_files: (t.solutionFiles as Array<{ path: string; contentBase64: string }> | null) ?? [],
    created_at: t.createdAt.toISOString(),
  }
}

const idParam = z.object({ id: z.string().uuid() })

export async function libraryRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  // ── CODING problems ─────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { search?: string; difficulty?: string; page?: string; limit?: string } }>(
    '/api/v1/library/problems',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const query = z
        .object({
          search: z.string().max(100).default(''),
          difficulty: DifficultySchema.optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        })
        .safeParse(request.query)
      if (!query.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid library filters')

      const search = query.data.search.trim()
      const where = {
        kind: 'CODING' as const,
        ...(query.data.difficulty ? { difficulty: query.data.difficulty } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' as const } },
                { topic: { contains: search, mode: 'insensitive' as const } },
                { description: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      }

      const [total, rows] = await Promise.all([
        prisma.libraryProblem.count({ where }),
        prisma.libraryProblem.findMany({
          where,
          include: { testCases: { select: { isHidden: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (query.data.page - 1) * query.data.limit,
          take: query.data.limit,
        }),
      ])

      return reply.send({
        data: rows.map(serializeLibraryProblem),
        total,
        page: query.data.page,
        pages: Math.max(1, Math.ceil(total / query.data.limit)),
      })
    },
  )

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/library/problems/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const entry = await prisma.libraryProblem.findUnique({
        where: { id: params.data.id },
        include: { testCases: { orderBy: { createdAt: 'asc' } } },
      })
      if (!entry || entry.kind !== 'CODING') return sendError(reply, 'NOT_FOUND', 'Library problem not found')
      return reply.send({ data: serializeLibraryProblemDetail(entry) })
    },
  )

  fastify.post(
    '/api/v1/library/problems',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const result = CreateLibraryProblemRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }
      const data = result.data
      const adminId = request.jwtPayload!.sub

      const created = await prisma.$transaction(async (tx) => {
        const problem = await tx.libraryProblem.create({
          data: {
            createdBy: adminId,
            kind: 'CODING',
            title: data.title,
            topic: data.topic ?? null,
            difficulty: data.difficulty,
            description: data.description,
            allowCopyPaste: data.allowCopyPaste,
          },
        })
        await tx.libraryTestCase.createMany({
          data: data.testCases.map((tc) => ({
            libraryProblemId: problem.id,
            input: tc.input,
            expected: tc.expected,
            isHidden: tc.isHidden,
            category: tc.category,
            weight: tc.weight,
            isCritical: tc.isCritical,
          })),
        })
        return tx.libraryProblem.findUniqueOrThrow({
          where: { id: problem.id },
          include: { testCases: { select: { isHidden: true } } },
        })
      })

      return reply.status(201).send({ data: serializeLibraryProblem(created) })
    },
  )

  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/library/problems/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const existing = await prisma.libraryProblem.findUnique({ where: { id: params.data.id } })
      if (!existing || existing.kind !== 'CODING') return sendError(reply, 'NOT_FOUND', 'Library problem not found')

      const result = UpdateLibraryProblemRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }
      const data = result.data

      const updated = await prisma.$transaction(async (tx) => {
        await tx.libraryProblem.update({
          where: { id: params.data.id },
          data: {
            ...(data.title !== undefined && { title: data.title }),
            ...(data.topic !== undefined && { topic: data.topic }),
            ...(data.description !== undefined && { description: data.description }),
            ...(data.difficulty !== undefined && { difficulty: data.difficulty }),
            ...(data.allowCopyPaste !== undefined && { allowCopyPaste: data.allowCopyPaste }),
          },
        })
        if (data.testCases !== undefined) {
          await tx.libraryTestCase.deleteMany({ where: { libraryProblemId: params.data.id } })
          await tx.libraryTestCase.createMany({
            data: data.testCases.map((tc) => ({
              libraryProblemId: params.data.id,
              input: tc.input,
              expected: tc.expected,
              isHidden: tc.isHidden,
              category: tc.category,
              weight: tc.weight,
              isCritical: tc.isCritical,
            })),
          })
        }
        return tx.libraryProblem.findUniqueOrThrow({
          where: { id: params.data.id },
          include: { testCases: { select: { isHidden: true } } },
        })
      })

      return reply.send({ data: serializeLibraryProblem(updated) })
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/library/problems/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const existing = await prisma.libraryProblem.findUnique({ where: { id: params.data.id } })
      if (!existing || existing.kind !== 'CODING') return sendError(reply, 'NOT_FOUND', 'Library problem not found')

      await prisma.$transaction([
        prisma.libraryTestCase.deleteMany({ where: { libraryProblemId: params.data.id } }),
        prisma.libraryProblem.delete({ where: { id: params.data.id } }),
      ])

      return reply.status(204).send()
    },
  )

  // ── PROJECT tasks ────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { search?: string; language?: string; difficulty?: string } }>(
    '/api/v1/library/tasks',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const query = z
        .object({
          search: z.string().max(100).default(''),
          language: LanguageSchema.optional(),
          difficulty: DifficultySchema.optional(),
        })
        .safeParse(request.query)
      if (!query.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid library filters')

      const search = query.data.search.trim()
      const rows = await prisma.libraryProblem.findMany({
        where: {
          kind: 'PROJECT',
          ...(query.data.language ? { language: query.data.language } : {}),
          ...(query.data.difficulty ? { difficulty: query.data.difficulty } : {}),
          ...(search
            ? {
                OR: [
                  { title: { contains: search, mode: 'insensitive' as const } },
                  { description: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send({ data: rows.map(serializeLibraryTask) })
    },
  )

  fastify.post(
    '/api/v1/library/tasks',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const result = CreateLibraryTaskRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }
      const data = result.data
      const adminId = request.jwtPayload!.sub

      const created = await prisma.libraryProblem.create({
        data: {
          createdBy: adminId,
          kind: 'PROJECT',
          title: data.title,
          difficulty: data.difficulty,
          language: data.language,
          description: data.description,
          doneWhen: data.doneWhen,
          referenceFiles: data.referenceFiles,
          solutionFiles: data.solutionFiles,
        },
      })

      return reply.status(201).send({ data: serializeLibraryTask(created) })
    },
  )

  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/library/tasks/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const existing = await prisma.libraryProblem.findUnique({ where: { id: params.data.id } })
      if (!existing || existing.kind !== 'PROJECT') return sendError(reply, 'NOT_FOUND', 'Library task not found')

      const result = UpdateLibraryTaskRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }
      const data = result.data

      const updated = await prisma.libraryProblem.update({
        where: { id: params.data.id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.difficulty !== undefined && { difficulty: data.difficulty }),
          ...(data.language !== undefined && { language: data.language }),
          ...(data.doneWhen !== undefined && { doneWhen: data.doneWhen }),
          ...(data.referenceFiles !== undefined && { referenceFiles: data.referenceFiles }),
          ...(data.solutionFiles !== undefined && { solutionFiles: data.solutionFiles }),
        },
      })

      return reply.send({ data: serializeLibraryTask(updated) })
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/library/tasks/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const existing = await prisma.libraryProblem.findUnique({ where: { id: params.data.id } })
      if (!existing || existing.kind !== 'PROJECT') return sendError(reply, 'NOT_FOUND', 'Library task not found')

      await prisma.libraryProblem.delete({ where: { id: params.data.id } })

      return reply.status(204).send()
    },
  )
}
