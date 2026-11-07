import type { FastifyInstance } from 'fastify'
import { VerifyTokenRequestSchema } from '@platform/types'
import { sendError } from '../lib/errors'
import { verifyAndParseToken } from '../lib/jwt'
import type { RouteOptions } from '../types'

export async function verifyRoutes(fastify: FastifyInstance, opts: RouteOptions): Promise<void> {
  /**
   * POST /api/v1/auth/verify
   * Internal service-to-service endpoint. Other services can call this to
   * validate a JWT without holding the secret themselves. In practice most
   * services verify locally (per CLAUDE.md), but this endpoint exists for
   * cases where a service needs explicit validation via the auth service.
   *
   * No authentication guard - the token being verified IS the credential.
   */
  fastify.post('/api/v1/auth/verify', async (request, reply) => {
    const result = VerifyTokenRequestSchema.safeParse(request.body)
    if (!result.success) {
      return sendError(reply, 'VALIDATION_ERROR', 'token is required')
    }

    try {
      const payload = verifyAndParseToken(result.data.token, opts.env.JWT_SECRET)

      return reply.status(200).send({
        data: {
          valid: true,
          payload,
        },
      })
    } catch (err: unknown) {
      // Distinguish expired from other invalid-token errors for clearer logs,
      // but always return UNAUTHORIZED to the caller - never leak token details.
      const message =
        err instanceof Error && err.name === 'TokenExpiredError'
          ? 'Token has expired'
          : 'Invalid token'

      return sendError(reply, 'UNAUTHORIZED', message)
    }
  })
}
