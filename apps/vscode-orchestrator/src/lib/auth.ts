import jwt from 'jsonwebtoken'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { JwtPayloadSchema, type JwtPayload } from '@platform/types'

declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload: JwtPayload | undefined
  }
}

function sendError(reply: FastifyReply, status: number, code: string, message: string): void {
  reply.status(status).send({ error: { code, message } })
}

// Candidate-JWT auth for the /api/v1/vscode/* control endpoints (mirrors
// api-assessment's authenticate hook).
export function makeAuthenticate(jwtSecret: string) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header')
      return
    }
    try {
      request.jwtPayload = JwtPayloadSchema.parse(jwt.verify(header.slice(7), jwtSecret))
    } catch {
      sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired token')
    }
  }
}

export { sendError }
