import type { FastifyInstance } from 'fastify'
import { prisma } from '@platform/db'
import { z } from 'zod'
import { encryptApiKey } from '../lib/crypto'
import type { RouteOptions } from '../types'

const SaveOpenRouterKeyBodySchema = z.object({
  key: z.string().min(1),
})

export async function adminConfigRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  fastify.get('/api/v1/admin/config', { preHandler: [requireAdmin] }, async (_request, reply) => {
    const config = await prisma.systemConfig.findUnique({ where: { id: 'singleton' } })
    return reply.send({
      data: { openrouter_key_configured: config?.openrouterKeyEncrypted != null },
    })
  })

  fastify.post(
    '/api/v1/admin/config/openrouter-key',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const bodyResult = SaveOpenRouterKeyBodySchema.safeParse(request.body)
      if (!bodyResult.success) {
        const message = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message } })
      }

      const encrypted = encryptApiKey(bodyResult.data.key, opts.env.OPENROUTER_ENCRYPTION_KEY)

      await prisma.systemConfig.upsert({
        where: { id: 'singleton' },
        update: { openrouterKeyEncrypted: encrypted },
        create: { id: 'singleton', openrouterKeyEncrypted: encrypted },
      })

      return reply.status(200).send({ data: { message: 'API key saved' } })
    },
  )
}
