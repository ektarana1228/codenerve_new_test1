import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'
import { projectBugBank } from '../projectBugBank'

// ── GET /api/v1/project-bug-bank ────────────────────────────────────────────
// Admin only. Returns the full bug-fix bank - including buggy files and the
// reference solution - so the admin can preview and pick entries while
// authoring a PROJECT assessment. Only 10 small hand-authored entries exist,
// so no pagination/search is needed (unlike the generated CODING bank).

export async function projectBugBankRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  fastify.get<{ Querystring: { language?: string } }>(
    '/api/v1/project-bug-bank',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const query = z
        .object({ language: z.enum(['PYTHON', 'JAVASCRIPT', 'TYPESCRIPT']).optional() })
        .safeParse(request.query)
      if (!query.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid language filter')

      const filtered = query.data.language
        ? projectBugBank.filter((entry) => entry.language === query.data.language)
        : projectBugBank

      return reply.send({
        data: filtered.map((entry) => ({
          id: entry.id,
          title: entry.title,
          difficulty: entry.difficulty,
          language: entry.language,
          description: entry.description,
          done_when: entry.doneWhen,
          files: entry.files,
          solution_files: entry.solutionFiles,
        })),
      })
    },
  )
}
