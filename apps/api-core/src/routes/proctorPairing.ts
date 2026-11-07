import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@platform/db'
import { z } from 'zod'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'
import { deleteEvidenceFile, uploadEvidenceFile } from '../lib/storage'

const paramsSchema = z.object({ id: z.string().uuid() })
const imageSchema = z.object({ image: z.string().min(4).max(1_500_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) })
const recordingSchema = z.object({
  mime_type: z.enum(['video/webm', 'video/webm;codecs=vp8']),
  data: z.string().min(4).max(11_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
})

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

async function mobilePairing(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization
  if (!header?.startsWith('Pairing ')) return sendError(reply, 'UNAUTHORIZED', 'Missing pairing token')
  const pairing = await prisma.mobilePairing.findFirst({
    where: { tokenHash: hash(header.slice(8)), expiresAt: { gt: new Date() } },
    select: {
      id: true,
      sessionId: true,
      pairedAt: true,
      lastSeenAt: true,
      session: { select: { id: true, candidateId: true, expiresAt: true, assessment: { select: { secondCamera: true } } } },
    },
  })
  if (!pairing || pairing.session.assessment.secondCamera === 'OFF') return sendError(reply, 'UNAUTHORIZED', 'Invalid or expired pairing token')
  return pairing
}

export async function pairingRoutes(fastify: FastifyInstance, opts: RouteOptions) {
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/proctoring/sessions/:id/mobile-pairing',
    { preHandler: [opts.authHooks.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid session id')
      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== params.data.id) return sendError(reply, 'FORBIDDEN', 'Access denied')
      const session = await prisma.session.findUnique({
        where: { id: params.data.id },
        select: { id: true, assessment: { select: { secondCamera: true, timeLimitMinutes: true } } },
      })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')
      if (session.assessment.secondCamera === 'OFF') return sendError(reply, 'FORBIDDEN', 'Second camera is not enabled')
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + (session.assessment.timeLimitMinutes + 60) * 60_000)
      await prisma.mobilePairing.upsert({
        where: { sessionId: session.id },
        create: { sessionId: session.id, tokenHash: hash(token), expiresAt },
        update: { tokenHash: hash(token), pairedAt: null, lastSeenAt: null, expiresAt },
      })
      return reply.status(201).send({ data: { pairing_url: `${opts.env.CANDIDATE_BASE_URL}/mobile-proctor?pair=${encodeURIComponent(token)}` } })
    },
  )

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/proctoring/sessions/:id/mobile-pairing',
    { preHandler: [opts.authHooks.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid session id')
      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== params.data.id) return sendError(reply, 'FORBIDDEN', 'Access denied')
      const pairing = await prisma.mobilePairing.findUnique({ where: { sessionId: params.data.id } })
      const connected = Boolean(pairing?.lastSeenAt && pairing.lastSeenAt.getTime() > Date.now() - 45_000)
      return reply.send({ data: { paired: Boolean(pairing?.pairedAt), connected, last_seen_at: pairing?.lastSeenAt?.toISOString() ?? null } })
    },
  )

  fastify.post('/api/v1/proctoring/mobile/connect', async (request, reply) => {
    const pairing = await mobilePairing(request, reply)
    if (!pairing || reply.sent) return

    const now = new Date()
    try {
      await prisma.mobilePairing.update({ where: { id: pairing.id }, data: { pairedAt: pairing.pairedAt ?? now, lastSeenAt: now } })
    } catch (error) {
      fastify.log.error({ err: error }, 'Could not connect mobile proctoring device')
      return sendError(reply, 'INTERNAL_SERVER_ERROR', 'Could not connect this phone. Try refreshing the QR code.')
    }
    void prisma.proctorEvent.create({
      data: { sessionId: pairing.sessionId, source: 'MOBILE', eventType: 'MOBILE_CONNECTED', expiresAt: new Date((pairing.session.expiresAt?.getTime() ?? Date.now()) + opts.env.PROCTOR_RETENTION_HOURS * 60 * 60 * 1000) },
    }).catch((error) => fastify.log.warn({ err: error }, 'Could not log mobile proctoring connection'))
    return reply.send({ data: { session_id: pairing.sessionId } })
  })

  fastify.post('/api/v1/proctoring/mobile/heartbeat', async (request, reply) => {
    const pairing = await mobilePairing(request, reply)
    if (!pairing || reply.sent) return
    await prisma.mobilePairing.update({ where: { id: pairing.id }, data: { lastSeenAt: new Date() } })
    return reply.status(204).send()
  })

  fastify.post('/api/v1/proctoring/mobile/screenshots', async (request, reply) => {
    const pairing = await mobilePairing(request, reply)
    if (!pairing || reply.sent) return
    const body = imageSchema.safeParse(request.body)
    if (!body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid mobile screenshot')
    const recent = await prisma.proctorMedia.findFirst({
      where: { sessionId: pairing.sessionId, kind: 'MOBILE', capturedAt: { gt: new Date(Date.now() - 20_000) } },
      select: { id: true },
    })
    if (recent) return sendError(reply, 'RATE_LIMITED', 'Mobile screenshot captured too recently')
    const image = Buffer.from(body.data.image, 'base64')
    if (image.length > 1_000_000 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) return sendError(reply, 'VALIDATION_ERROR', 'Screenshot must be a JPEG smaller than 1 MB')
    let objectName: string
    try {
      objectName = await uploadEvidenceFile(opts.env, `candidates/${pairing.session.candidateId}/sessions/${pairing.sessionId}/screenshots/mobile-${Date.now()}.jpg`, 'image/jpeg', image)
    } catch (error) {
      fastify.log.error({ err: error }, 'Mobile screenshot upload failed')
      return sendError(reply, 'STORAGE_UNAVAILABLE', 'Mobile evidence storage is unavailable')
    }
    try {
      const media = await prisma.proctorMedia.create({
        data: {
          sessionId: pairing.sessionId,
          kind: 'MOBILE',
          driveFileId: objectName,
          mimeType: 'image/jpeg',
          sizeBytes: image.length,
          expiresAt: new Date((pairing.session.expiresAt?.getTime() ?? Date.now()) + opts.env.PROCTOR_RETENTION_HOURS * 60 * 60 * 1000),
        },
      })
      return reply.status(201).send({ data: { id: media.id } })
    } catch {
      await deleteEvidenceFile(opts.env, objectName).catch(() => {})
      return sendError(reply, 'INTERNAL_SERVER_ERROR', 'Mobile evidence metadata could not be saved')
    }
  })

  fastify.post('/api/v1/proctoring/mobile/recordings', async (request, reply) => {
    const pairing = await mobilePairing(request, reply)
    if (!pairing || reply.sent) return
    const body = recordingSchema.safeParse(request.body)
    if (!body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid mobile recording chunk')
    const recent = await prisma.proctorMedia.findFirst({
      where: { sessionId: pairing.sessionId, kind: 'MOBILE_RECORDING', capturedAt: { gt: new Date(Date.now() - 3_000) } },
      select: { id: true },
    })
    if (recent) return sendError(reply, 'RATE_LIMITED', 'Mobile recording chunk uploaded too recently')
    const data = Buffer.from(body.data.data, 'base64')
    if (data.length > 8_000_000 || data.length < 4 || !data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return sendError(reply, 'VALIDATION_ERROR', 'Recording must be a WebM chunk smaller than 8 MB')
    }
    let objectName: string
    try {
      objectName = await uploadEvidenceFile(opts.env, `candidates/${pairing.session.candidateId}/sessions/${pairing.sessionId}/chunks/mobile-recording-${Date.now()}.webm`, body.data.mime_type, data)
    } catch (error) {
      fastify.log.error({ err: error }, 'Mobile recording upload failed')
      return sendError(reply, 'STORAGE_UNAVAILABLE', 'Mobile recording storage is unavailable')
    }
    try {
      const media = await prisma.proctorMedia.create({
        data: {
          sessionId: pairing.sessionId,
          kind: 'MOBILE_RECORDING',
          driveFileId: objectName,
          mimeType: body.data.mime_type,
          sizeBytes: data.length,
          expiresAt: new Date((pairing.session.expiresAt?.getTime() ?? Date.now()) + opts.env.PROCTOR_RETENTION_HOURS * 60 * 60 * 1000),
        },
      })
      return reply.status(201).send({ data: { id: media.id } })
    } catch {
      await deleteEvidenceFile(opts.env, objectName).catch(() => {})
      return sendError(reply, 'INTERNAL_SERVER_ERROR', 'Mobile recording metadata could not be saved')
    }
  })
}
