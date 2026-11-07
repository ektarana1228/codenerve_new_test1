import type { FastifyRequest, FastifyReply } from 'fastify'
import type { JwtPayload } from '@platform/types'
import { prisma } from '@platform/db'
import { verifyAndParseToken } from '../lib/jwt'
import { sendError } from '../lib/errors'
import { isAdminRole } from '../lib/roles'

// Extend FastifyRequest so every route file can access request.jwtPayload
// without additional imports. This augmentation is picked up by TypeScript
// as long as this module is part of the compilation.
declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload: JwtPayload | undefined
  }
}

/**
 * Returns two Fastify preHandler functions bound to the given JWT secret.
 * Create once in index.ts and pass to route plugins via options.
 *
 * `authenticate`  - verifies the Bearer token and attaches jwtPayload
 * `requireAdmin`  - verifies the token AND asserts admin/master role
 */
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

    if (!isAdminRole(request.jwtPayload?.role)) {
      sendError(reply, 'FORBIDDEN', 'Admin access required')
      return
    }

    const user = await prisma.user.findUnique({ where: { id: request.jwtPayload!.sub }, select: { role: true } })
    if (!isAdminRole(user?.role)) {
      sendError(reply, 'FORBIDDEN', 'Admin access revoked')
    }
  }

  async function requireMaster(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticate(request, reply)
    if (reply.sent) return

    if (request.jwtPayload?.role !== 'MASTER') {
      sendError(reply, 'FORBIDDEN', 'Master access required')
      return
    }

    const user = await prisma.user.findUnique({ where: { id: request.jwtPayload.sub }, select: { role: true } })
    if (user?.role !== 'MASTER') {
      sendError(reply, 'FORBIDDEN', 'Master access required')
    }
  }

  return { authenticate, requireAdmin, requireMaster }
}

export type AuthHooks = ReturnType<typeof makeAuthHooks>
