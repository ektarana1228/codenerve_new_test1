import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { sendError } from '../lib/errors'
import { encryptApiKey } from '../lib/crypto'
import type { RouteOptions } from '../types'

const SaveOpenRouterKeyBodySchema = z.object({
  key: z.string().min(1),
})

export async function adminRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  // ── GET /api/v1/admin/config ──────────────────────────────────────────────
  fastify.get(
    '/api/v1/admin/config',
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const config = await prisma.systemConfig.findUnique({ where: { id: 'singleton' } })
      return reply.send({
        data: { openrouter_key_configured: config?.openrouterKeyEncrypted != null },
      })
    },
  )

  // ── POST /api/v1/admin/config/openrouter-key ───────────────────────────────
  // Admin only. Encrypts the provided key with AES-256-GCM and upserts the
  // singleton SystemConfig row. The raw key is never logged or returned.

  fastify.post(
    '/api/v1/admin/config/openrouter-key',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const bodyResult = SaveOpenRouterKeyBodySchema.safeParse(request.body)
      if (!bodyResult.success) {
        const msg = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const { key: api_key } = bodyResult.data

      let encrypted: string
      try {
        encrypted = encryptApiKey(api_key, opts.env.OPENROUTER_ENCRYPTION_KEY)
      } catch {
        fastify.log.error('Failed to encrypt OpenRouter API key')
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save API key' },
        })
      }

      await prisma.systemConfig.upsert({
        where: { id: 'singleton' },
        update: { openrouterKeyEncrypted: encrypted },
        create: { id: 'singleton', openrouterKeyEncrypted: encrypted },
      })

      return reply.status(200).send({ data: { message: 'API key saved' } })
    },
  )
}
