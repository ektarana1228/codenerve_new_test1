import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { AddTaskRequestSchema } from '@platform/types'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'
import { requireOwnedAssessment } from './problems'
import { isMaster } from '../lib/roles'

// ── POST /api/v1/assessments/:id/tasks ──────────────────────────────────────
// Adds a Task to an already-created PROJECT assessment - the post-creation
// counterpart to authoring tasks inline at assessment-creation time. Any
// referenceFiles/solutionFiles supplied (e.g. from the bug-fix bank or the
// library) are appended onto the assessment's existing arrays.

function serializeTask(t: {
  id: string
  assessmentId: string
  order: number
  title: string
  description: string
  doneWhen: unknown
  createdAt: Date
}) {
  return {
    id: t.id,
    assessment_id: t.assessmentId,
    order: t.order,
    title: t.title,
    description: t.description,
    done_when: Array.isArray(t.doneWhen) ? (t.doneWhen as string[]) : [],
    created_at: t.createdAt.toISOString(),
  }
}

const assessmentIdParam = z.object({ id: z.string().uuid() })

export async function taskRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/assessments/:id/tasks',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = assessmentIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }
      const { id: assessmentId } = paramsResult.data
      const adminId = request.jwtPayload!.sub

      const owned = await requireOwnedAssessment(reply, assessmentId, adminId, isMaster(request.jwtPayload))
      if (!owned) return

      const assessment = await prisma.assessment.findUniqueOrThrow({
        where: { id: assessmentId },
        select: { kind: true, referenceFiles: true, solutionFiles: true },
      })
      if (assessment.kind !== 'PROJECT') {
        return sendError(reply, 'VALIDATION_ERROR', 'Tasks can only be added to PROJECT assessments')
      }

      const result = AddTaskRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }
      const data = result.data

      const task = await prisma.$transaction(async (tx) => {
        if (data.referenceFiles.length > 0 || data.solutionFiles.length > 0) {
          const currentReferenceFiles = (assessment.referenceFiles as Array<{ path: string; contentBase64: string }> | null) ?? []
          const currentSolutionFiles = (assessment.solutionFiles as Array<{ path: string; contentBase64: string }> | null) ?? []
          await tx.assessment.update({
            where: { id: assessmentId },
            data: {
              referenceFiles: [...currentReferenceFiles, ...data.referenceFiles],
              solutionFiles: [...currentSolutionFiles, ...data.solutionFiles],
            },
          })
        }

        const order = await tx.task.count({ where: { assessmentId } })
        return tx.task.create({
          data: {
            assessmentId,
            order,
            title: data.title,
            description: data.description,
            doneWhen: data.doneWhen,
            difficulty: data.difficulty,
            bugBankId: data.bugBankId,
          },
        })
      })

      return reply.status(201).send({ data: serializeTask(task) })
    },
  )
}
