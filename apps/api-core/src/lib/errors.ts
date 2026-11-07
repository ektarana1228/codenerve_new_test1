import type { FastifyReply } from 'fastify'
import type { ApiErrorCode } from '@platform/types'

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  UNDER_REVIEW: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  SESSION_EXPIRED: 401,
  TOKEN_USED: 401,
  TOKEN_EXPIRED: 401,
  RATE_LIMITED: 429,
  EXECUTION_TIMEOUT: 408,
  SUBMISSION_LOCKED: 409,
  LLM_TIMEOUT: 504,
  STORAGE_UNAVAILABLE: 503,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
}

/**
 * Sends an error response in the canonical API error shape and returns the
 * reply so callers can `return sendError(...)` to satisfy TypeScript control
 * flow in async handlers.
 */
export function sendError(
  reply: FastifyReply,
  code: ApiErrorCode,
  message: string,
): FastifyReply {
  return reply.status(HTTP_STATUS[code]).send({ error: { code, message } })
}
