import type { FastifyInstance } from 'fastify'
import { Prisma, prisma } from '@platform/db'
import { z } from 'zod'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'
import { isMaster } from '../lib/roles'

const paramsSchema = z.object({ id: z.string().uuid() })
const connectivitySchema = z.object({ payload: z.string().max(400_000) })
const checkResultSchema = z.object({
  checks: z.object({
    browser: z.enum(['passed', 'failed']),
    connection: z.enum(['passed', 'failed']),
    camera: z.enum(['passed', 'failed', 'skipped']),
    microphone: z.enum(['passed', 'failed', 'skipped']),
    screen: z.enum(['passed', 'failed', 'skipped']),
    mobile: z.enum(['passed', 'failed', 'skipped']),
  }),
  batch_id: z.string().max(80).optional(),
})
const eventSchema = z
  .object({
    source: z.enum(['SYSTEM', 'DESKTOP', 'MOBILE']).default('DESKTOP'),
    type: z.enum([
      'SYSTEM_CHECK_STARTED',
      'SYSTEM_CHECK_PASSED',
      'SYSTEM_CHECK_FAILED',
      'CAMERA_STARTED',
      'CAMERA_STOPPED',
      'MICROPHONE_STARTED',
      'MICROPHONE_STOPPED',
      'SCREEN_STARTED',
      'SCREEN_STOPPED',
      'TAB_HIDDEN',
      'TAB_VISIBLE',
      'FULLSCREEN_EXITED',
      'NETWORK_LOST',
      'NETWORK_RESTORED',
      'MOBILE_CONNECTED',
      'MOBILE_DISCONNECTED',
      'EVIDENCE_UPLOAD_FAILED',
      'AI_ASSISTANT_UNAVAILABLE',
    ]),
    metadata: z.record(z.unknown()).default({}),
  })
  .refine((value) => JSON.stringify(value.metadata).length <= 8192, {
    message: 'metadata must be 8 KB or smaller',
  })

export async function eventRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
) {
  fastify.post(
    '/api/v1/proctoring/connectivity',
    { preHandler: [opts.authHooks.authenticate] },
    async (request, reply) => {
      if (request.jwtPayload?.role !== 'STUDENT') return sendError(reply, 'FORBIDDEN', 'Candidate access required')
      const body = connectivitySchema.safeParse(request.body)
      if (!body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid connectivity payload')
      return reply.send({ data: { received_bytes: body.data.payload.length } })
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/proctoring/sessions/:id/checks/complete',
    { preHandler: [opts.authHooks.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      const body = checkResultSchema.safeParse(request.body)
      if (!params.success || !body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid system check result')

      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== params.data.id) {
        return sendError(reply, 'FORBIDDEN', 'Access denied')
      }

      const session = await prisma.session.findUnique({
        where: { id: params.data.id },
        select: {
          id: true,
          expiresAt: true,
          assessment: {
            select: {
              screenRecording: true,
              videoProctoring: true,
              microphoneRecording: true,
              secondCamera: true,
            },
          },
        },
      })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')

      const checks = body.data.checks
      const policy = session.assessment
      if (policy.secondCamera !== 'OFF') {
        const pairing = await prisma.mobilePairing.findUnique({ where: { sessionId: session.id }, select: { lastSeenAt: true } })
        checks.mobile = pairing?.lastSeenAt && pairing.lastSeenAt.getTime() > Date.now() - 45_000 ? 'passed' : 'failed'
      }
      const canProceed =
        checks.browser === 'passed' &&
        checks.connection === 'passed' &&
        (policy.screenRecording !== 'REQUIRED' || checks.screen === 'passed') &&
        (policy.videoProctoring !== 'REQUIRED' || checks.camera === 'passed') &&
        (policy.microphoneRecording !== 'REQUIRED' || checks.microphone === 'passed') &&
        (policy.secondCamera !== 'REQUIRED' || checks.mobile === 'passed')

      await prisma.proctorEvent.create({
        data: {
          sessionId: session.id,
          source: 'SYSTEM',
          eventType: canProceed ? 'SYSTEM_CHECK_PASSED' : 'SYSTEM_CHECK_FAILED',
          metadata: body.data.batch_id ? { ...checks, batch_id: body.data.batch_id } : checks,
          expiresAt: new Date((session.expiresAt?.getTime() ?? Date.now()) + opts.env.PROCTOR_RETENTION_HOURS * 60 * 60 * 1000),
        },
      })
      return reply.send({ data: { can_proceed: canProceed } })
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/proctoring/sessions/:id/events',
    { preHandler: [opts.authHooks.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      const body = eventSchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return sendError(reply, 'VALIDATION_ERROR', body.success ? 'Invalid session id' : body.error.errors[0]?.message ?? 'Invalid event')
      }

      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== params.data.id) {
        return sendError(reply, 'FORBIDDEN', 'Access denied')
      }

      const session = await prisma.session.findUnique({ where: { id: params.data.id }, select: { id: true, expiresAt: true } })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')

      const created = await prisma.proctorEvent.create({
        data: {
          sessionId: session.id,
          source: body.data.source,
          eventType: body.data.type,
          metadata: body.data.metadata as Prisma.InputJsonObject,
          expiresAt: new Date((session.expiresAt?.getTime() ?? Date.now()) + opts.env.PROCTOR_RETENTION_HOURS * 60 * 60 * 1000),
        },
      })

      return reply.status(201).send({ data: { id: created.id, created_at: created.createdAt.toISOString() } })
    },
  )

  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/v1/proctoring/sessions/:id/events',
    { preHandler: [opts.authHooks.requireAdmin] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).safeParse(request.query)
      if (!params.success || !query.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid request')

      const session = await prisma.session.findUnique({
        where: { id: params.data.id },
        select: { assessment: { select: { createdBy: true } } },
      })
      const payload = request.jwtPayload!
      if (!session || (!isMaster(payload) && session.assessment.createdBy !== payload.sub)) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      const events = await prisma.proctorEvent.findMany({
        where: { sessionId: params.data.id },
        orderBy: { createdAt: 'desc' },
        take: query.data.limit,
      })
      return reply.send({
        data: events.map((event) => ({
          id: event.id,
          source: event.source,
          type: event.eventType,
          metadata: event.metadata,
          created_at: event.createdAt.toISOString(),
        })),
      })
    },
  )
}
