import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { decryptApiKey } from '../lib/crypto'
import type { RouteOptions } from '../types'

const OPENROUTER_TIMEOUT_MS = 20000
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const JudgeBodySchema = z.object({
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
})

// ── POST /api/v1/llm/judge ──────────────────────────────────────────────────
// Internal service-to-service only (worker-aiu), never candidate-facing. Not
// rate-limited by session and not written to interaction_logs - this is
// server-side grading, not a candidate chat turn. Auth is a shared secret
// (JWT_SECRET, already provisioned to every backend service) rather than a
// candidate/admin JWT, since the caller is a background worker, not a user.
// Reuses the same decrypt-key-in-memory + sanitised-error posture as
// /api/v1/llm/chat - this route stays the single place that ever talks to
// OpenRouter.

export async function judgeRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  async function requireInternalSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const secret = request.headers['x-internal-secret']
    if (secret !== opts.env.JWT_SECRET) {
      reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal secret' } })
    }
  }

  fastify.post(
    '/api/v1/llm/judge',
    { preHandler: [requireInternalSecret] },
    async (request, reply) => {
      const bodyResult = JudgeBodySchema.safeParse(request.body)
      if (!bodyResult.success) {
        const msg = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: msg } })
      }
      const { model, systemPrompt, userPrompt } = bodyResult.data

      const config = await prisma.systemConfig.findUnique({ where: { id: 'singleton' } })
      if (!config?.openrouterKeyEncrypted) {
        fastify.log.error('OpenRouter key is not configured in SystemConfig')
        return reply.status(503).send({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'AI grading is not available' },
        })
      }

      let apiKey: string
      try {
        apiKey = decryptApiKey(config.openrouterKeyEncrypted, opts.env.OPENROUTER_ENCRYPTION_KEY)
      } catch {
        fastify.log.error('Failed to decrypt OpenRouter API key')
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message: 'AI grading configuration error' },
        })
      }

      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS)

      try {
        const res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
            body: JSON.stringify({
              model,
              temperature: 0,
              seed: 0,
              response_format: { type: 'json_object' },
              messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutHandle)

        if (!res.ok) {
          // Hard rule: never expose OpenRouter error details or endpoint.
          fastify.log.error({ status: res.status }, 'OpenRouter returned non-OK status for a judge call')
          return reply.status(502).send({
            error: { code: 'AI_ASSISTANT_ERROR', message: 'AI grading error' },
          })
        }

        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
        const content = data.choices?.[0]?.message?.content ?? ''

        if (!content) {
          fastify.log.error('OpenRouter returned an empty completion for a judge call')
          return reply.status(502).send({
            error: { code: 'AI_ASSISTANT_ERROR', message: 'AI grading error' },
          })
        }

        return reply.status(200).send({ data: { content } })
      } catch (err: unknown) {
        clearTimeout(timeoutHandle)
        if (err instanceof Error && err.name === 'AbortError') {
          return reply.status(504).send({ error: { code: 'LLM_TIMEOUT', message: 'AI grading request timed out' } })
        }
        fastify.log.error('OpenRouter judge request failed')
        return reply.status(502).send({
          error: { code: 'AI_ASSISTANT_ERROR', message: 'AI grading error' },
        })
      } finally {
        apiKey = ''
      }
    },
  )
}
