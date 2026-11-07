import type { FastifyRequest, FastifyReply } from 'fastify'
import type { JwtPayload } from '@platform/types'
import { verifyAndParseToken } from '../lib/jwt'
import { sendError } from '../lib/errors'

declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload: JwtPayload | undefined
  }
}

export function makeAuthHooks(jwtSecret: string) {
  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      sendError(reply, 'UNAUTHORIZED', 'Missing or invalid Authorization header')
      return
    }
    const token = authHeader.slice(7)
    try {
      request.jwtPayload = verifyAndParseToken(token, jwtSecret)
    } catch {
      sendError(reply, 'UNAUTHORIZED', 'Invalid or expired token')
      return
    }
  }

  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticate(request, reply)
    if (reply.sent) return
    if (request.jwtPayload?.role !== 'ADMIN' && request.jwtPayload?.role !== 'MASTER') {
      sendError(reply, 'FORBIDDEN', 'Admin access required')
    }
  }

  return { authenticate, requireAdmin }
}

export type AuthHooks = ReturnType<typeof makeAuthHooks>
