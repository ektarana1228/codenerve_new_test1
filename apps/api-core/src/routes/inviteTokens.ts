import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { GenerateInviteTokenRequestSchema } from '@platform/types'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'
import { sendInviteEmail } from '../lib/email'
import { isMaster } from '../lib/roles'

const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000 // 72 hours
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

type TokenStatus = 'active' | 'expired'

function getTokenStatus(token: {
  expiresAt: Date
}): TokenStatus {
  if (token.expiresAt < new Date()) return 'expired'
  return 'active'
}

export async function inviteTokenRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  /**
   * POST /api/v1/auth/invite-tokens
   * Admin only. Creates a reusable invite token for a candidate slot.
   */
  fastify.post(
    '/api/v1/auth/invite-tokens',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const result = GenerateInviteTokenRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const { assessment_id, candidate_name, candidate_email } = result.data
      const payload = request.jwtPayload!

      // Verify the assessment exists and belongs to the requesting admin.
      // api-auth owns invite_tokens; the assessments table is owned by
      // api-assessment, but we share the same DB so a direct read is acceptable
      // at this stage. A stricter arch would call api-assessment via HTTP.
      const assessment = await prisma.assessment.findUnique({
        where: { id: assessment_id },
        select: { id: true, createdBy: true, title: true, timeLimitMinutes: true, status: true },
      })

      if (!assessment) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      if (!isMaster(payload) && assessment.createdBy !== payload.sub) {
        return sendError(reply, 'FORBIDDEN', 'You do not own this assessment')
      }

      if (assessment.status !== 'ACTIVE') {
        return sendError(reply, 'FORBIDDEN', 'Invite links can only be generated for active assessments')
      }

      const inviteToken = await prisma.inviteToken.create({
        data: {
          assessmentId: assessment_id,
          candidateName: candidate_name,
          candidateEmail: candidate_email ?? null,
          expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
        },
      })

      const inviteUrl = new URL('/start', opts.env.APP_BASE_URL)
      inviteUrl.searchParams.set('token', inviteToken.token)
      let emailSent = false
      try {
        emailSent = await sendInviteEmail(opts.env, {
          candidateName: candidate_name,
          candidateEmail: candidate_email,
          assessmentTitle: assessment.title,
          timeLimitMinutes: assessment.timeLimitMinutes,
          inviteUrl: inviteUrl.toString(),
          expiresAt: inviteToken.expiresAt,
        })
      } catch (emailError) {
        request.log.error({ err: emailError }, 'Assessment invitation email failed')
      }

      return reply.status(201).send({
        data: {
          token: inviteToken.token,
          invite_url: inviteUrl.toString(),
          email_sent: emailSent,
        },
      })
    },
  )

  /**
   * GET /api/v1/auth/invite-tokens/:assessment_id
   * Admin only. Lists all invite tokens for an assessment with computed status.
   * Cursor-based pagination via ?cursor=<token_id>&limit=<n>.
   */
  fastify.get<{
    Params: { assessment_id: string }
    Querystring: { cursor?: string; limit?: string }
  }>(
    '/api/v1/auth/invite-tokens/:assessment_id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = z
        .object({ assessment_id: z.string().uuid() })
        .safeParse(request.params)

      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'assessment_id must be a valid UUID')
      }

      const { assessment_id } = paramsResult.data
      const payload = request.jwtPayload!

      // Ensure the assessment exists and belongs to this admin
      const assessment = await prisma.assessment.findUnique({
        where: { id: assessment_id },
        select: { id: true, createdBy: true },
      })

      if (!assessment) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      if (!isMaster(payload) && assessment.createdBy !== payload.sub) {
        return sendError(reply, 'FORBIDDEN', 'You do not own this assessment')
      }

      const { cursor, limit: limitStr } = request.query
      const limit = Math.min(
        Math.max(1, parseInt(limitStr ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
        MAX_PAGE_SIZE,
      )

      const rows = await prisma.inviteToken.findMany({
        where: { assessmentId: assessment_id },
        orderBy: { createdAt: 'asc' },
        take: limit + 1, // fetch one extra to determine if there's a next page
        ...(cursor
          ? { cursor: { id: cursor }, skip: 1 }
          : {}),
      })

      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

      const data = page.map((t: {
        id: string
        token: string
        candidateName: string
        candidateEmail: string | null
        usedAt: Date | null
        expiresAt: Date
        createdAt: Date
      }) => ({
        id: t.id,
        token: t.token,
        candidate_name: t.candidateName,
        candidate_email: t.candidateEmail ?? null,
        used_at: t.usedAt?.toISOString() ?? null,
        expires_at: t.expiresAt.toISOString(),
        created_at: t.createdAt.toISOString(),
        status: getTokenStatus(t),
      }))

      return reply.status(200).send({
        data,
        next_cursor: nextCursor,
      })
    },
  )
}
