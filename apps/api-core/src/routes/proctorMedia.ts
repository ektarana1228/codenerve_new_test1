import type { FastifyInstance } from 'fastify'
import { prisma } from '@platform/db'
import { z } from 'zod'
import { sendError } from '../lib/errors'
import type { RouteOptions } from '../types'
import { deleteEvidenceFile, downloadEvidenceFile, uploadEvidenceFile } from '../lib/storage'
import { isMaster } from '../lib/roles'
import { mergeSessionRecordings } from '../lib/recordingMerger'

const paramsSchema = z.object({ id: z.string().uuid() })
const screenshotSchema = z.object({
  kind: z.enum(['SCREEN', 'WEBCAM']),
  image: z.string().min(4).max(1_500_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
})
const recordingSchema = z.object({
  kind: z.enum(['SCREEN_RECORDING', 'WEBCAM_RECORDING', 'MICROPHONE_RECORDING']),
  mime_type: z.enum(['video/webm', 'video/webm;codecs=vp8,opus', 'audio/webm', 'audio/webm;codecs=opus']),
  data: z.string().min(4).max(11_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
})

async function mediaSegment(sessionId: string): Promise<{ number: number; label: string; path: string }> {
  const resumedCount = await prisma.proctorEvent.count({
    where: { sessionId, eventType: 'CANDIDATE_RESUMED' },
  })
  const number = resumedCount + 1
  const label = number === 1 ? 'Before exit' : `After exit ${number - 1}`
  const path = number === 1 ? 'segment-1-before-exit' : `segment-${number}-after-exit-${number - 1}`
  return { number, label, path }
}

function segmentLabelFromPath(path: string): string {
  const match = path.match(/segment-(\d+)-(before-exit|after-exit-(\d+))/)
  if (!match) return 'Segment 1 - Before exit'
  const segment = Number(match[1])
  return match[2] === 'before-exit' ? `Segment ${segment} - Before exit` : `Segment ${segment} - After exit ${match[3]}`
}

export async function mediaRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
) {
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/proctoring/sessions/:id/recordings',
    { preHandler: [opts.authHooks.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      const body = recordingSchema.safeParse(request.body)
      if (!params.success || !body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid recording chunk')
      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== params.data.id) return sendError(reply, 'FORBIDDEN', 'Access denied')

      const session = await prisma.session.findUnique({
        where: { id: params.data.id },
        select: { id: true, expiresAt: true, assessment: { select: { screenRecording: true, videoProctoring: true, microphoneRecording: true } } },
      })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')
      const enabled = {
        SCREEN_RECORDING: session.assessment.screenRecording,
        WEBCAM_RECORDING: session.assessment.videoProctoring,
        MICROPHONE_RECORDING: session.assessment.microphoneRecording,
      }
      if (enabled[body.data.kind] === 'OFF') return sendError(reply, 'FORBIDDEN', 'Recording type is not enabled')
      const recent = await prisma.proctorMedia.findFirst({
        where: { sessionId: session.id, kind: body.data.kind, capturedAt: { gt: new Date(Date.now() - 3_000) } },
        select: { id: true },
      })
      if (recent) return sendError(reply, 'RATE_LIMITED', 'Recording chunk uploaded too recently')

      const data = Buffer.from(body.data.data, 'base64')
      if (data.length > 8_000_000 || data.length < 4 || !data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
        return sendError(reply, 'VALIDATION_ERROR', 'Recording must be a WebM chunk smaller than 8 MB')
      }
      let objectName: string
      try {
        const segment = await mediaSegment(session.id)
        objectName = await uploadEvidenceFile(opts.env, `${session.id}/${segment.path}/${body.data.kind.toLowerCase()}-${Date.now()}.webm`, body.data.mime_type, data)
      } catch {
        return sendError(reply, 'STORAGE_UNAVAILABLE', 'Recording storage is unavailable')
      }
      try {
        const media = await prisma.proctorMedia.create({
          data: {
            sessionId: session.id,
            kind: body.data.kind,
            driveFileId: objectName,
            mimeType: body.data.mime_type,
            sizeBytes: data.length,
            expiresAt: new Date((session.expiresAt?.getTime() ?? Date.now()) + opts.env.PROCTOR_RETENTION_HOURS * 60 * 60 * 1000),
          },
        })
        return reply.status(201).send({ data: { id: media.id, captured_at: media.capturedAt.toISOString() } })
      } catch {
        await deleteEvidenceFile(opts.env, objectName).catch(() => {})
        return sendError(reply, 'INTERNAL_SERVER_ERROR', 'Recording metadata could not be saved')
      }
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/proctoring/sessions/:id/screenshots',
    { preHandler: [opts.authHooks.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      const body = screenshotSchema.safeParse(request.body)
      if (!params.success || !body.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid screenshot')

      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== params.data.id) {
        return sendError(reply, 'FORBIDDEN', 'Access denied')
      }

      const session = await prisma.session.findUnique({
        where: { id: params.data.id },
        select: { id: true, expiresAt: true, assessment: { select: { screenRecording: true, videoProctoring: true } } },
      })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')
      if (
        (body.data.kind === 'SCREEN' && session.assessment.screenRecording === 'OFF') ||
        (body.data.kind === 'WEBCAM' && session.assessment.videoProctoring === 'OFF')
      ) {
        return sendError(reply, 'FORBIDDEN', 'Screenshot type is not enabled')
      }

      const recent = await prisma.proctorMedia.findFirst({
        where: {
          sessionId: session.id,
          kind: body.data.kind,
          capturedAt: { gt: new Date(Date.now() - 30_000) },
        },
        select: { id: true },
      })
      if (recent) return sendError(reply, 'RATE_LIMITED', 'Screenshot captured too recently')

      const image = Buffer.from(body.data.image, 'base64')
      if (image.length > 1_000_000 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
        return sendError(reply, 'VALIDATION_ERROR', 'Screenshot must be a JPEG smaller than 1 MB')
      }

      let driveFileId: string
      try {
        const segment = await mediaSegment(session.id)
        driveFileId = await uploadEvidenceFile(opts.env, `${session.id}/${segment.path}/${body.data.kind.toLowerCase()}-${Date.now()}.jpg`, 'image/jpeg', image)
      } catch {
        return sendError(reply, 'STORAGE_UNAVAILABLE', 'Screenshot storage is unavailable')
      }

      try {
        const media = await prisma.proctorMedia.create({
          data: {
            sessionId: session.id,
            kind: body.data.kind,
            driveFileId,
            mimeType: 'image/jpeg',
            sizeBytes: image.length,
            expiresAt: new Date((session.expiresAt?.getTime() ?? Date.now()) + opts.env.PROCTOR_RETENTION_HOURS * 60 * 60 * 1000),
          },
        })
        return reply.status(201).send({ data: { id: media.id, captured_at: media.capturedAt.toISOString() } })
      } catch {
        await deleteEvidenceFile(opts.env, driveFileId).catch(() => {})
        return sendError(reply, 'INTERNAL_SERVER_ERROR', 'Screenshot metadata could not be saved')
      }
    },
  )

  fastify.get<{ Params: { id: string; mediaId: string } }>(
    '/api/v1/proctoring/sessions/:id/media/:mediaId',
    { preHandler: [opts.authHooks.requireAdmin] },
    async (request, reply) => {
      const parsed = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() }).safeParse(request.params)
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid media request')
      const media = await prisma.proctorMedia.findFirst({
        where: { id: parsed.data.mediaId, sessionId: parsed.data.id },
        include: { session: { select: { assessment: { select: { createdBy: true } } } } },
      })
      const payload = request.jwtPayload!
      if (!media || (!isMaster(payload) && media.session.assessment.createdBy !== payload.sub)) return sendError(reply, 'NOT_FOUND', 'Media not found')
      try {
        const file = await downloadEvidenceFile(opts.env, media.driveFileId)
        return reply
          .header('Content-Type', media.mimeType)
          .header('Cache-Control', 'private, max-age=300')
          .send(file)
      } catch (error) {
        fastify.log.error({ err: error, mediaId: media.id }, 'Failed to download proctor media')
        return sendError(reply, 'STORAGE_UNAVAILABLE', 'Media storage is unavailable')
      }
    },
  )

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/proctoring/sessions/:id/media',
    { preHandler: [opts.authHooks.requireAdmin] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid session id')
      const session = await prisma.session.findUnique({
        where: { id: params.data.id },
        select: { assessmentId: true, status: true, assessment: { select: { createdBy: true } } },
      })
      const payload = request.jwtPayload!
      if (!session || (!isMaster(payload) && session.assessment.createdBy !== payload.sub)) return sendError(reply, 'NOT_FOUND', 'Session not found')
      if (session.status !== 'ACTIVE') {
        void mergeSessionRecordings(opts.env, params.data.id).catch((err) => {
          fastify.log.error({ err, sessionId: params.data.id }, 'Failed to merge proctor recordings')
        })
      }
      const media = await prisma.proctorMedia.findMany({ where: { sessionId: params.data.id }, orderBy: { capturedAt: 'desc' }, take: 500 })
      return reply.send({ assessment_id: session.assessmentId, data: media.map((item) => ({
        id: item.id,
        kind: item.kind,
        mime_type: item.mimeType,
        size_bytes: item.sizeBytes,
        captured_at: item.capturedAt.toISOString(),
        segment_label: segmentLabelFromPath(item.driveFileId),
      })) })
    },
  )

  fastify.delete<{ Params: { id: string; mediaId: string } }>(
    '/api/v1/proctoring/sessions/:id/media/:mediaId',
    { preHandler: [opts.authHooks.requireAdmin] },
    async (request, reply) => {
      const parsed = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() }).safeParse(request.params)
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid media request')
      const media = await prisma.proctorMedia.findFirst({ where: { id: parsed.data.mediaId, sessionId: parsed.data.id }, include: { session: { select: { assessment: { select: { createdBy: true } } } } } })
      const payload = request.jwtPayload!
      if (!media || (!isMaster(payload) && media.session.assessment.createdBy !== payload.sub)) return sendError(reply, 'NOT_FOUND', 'Media not found')
      await deleteEvidenceFile(opts.env, media.driveFileId)
      await prisma.proctorMedia.delete({ where: { id: media.id } })
      return reply.send({ data: { deleted: true } })
    },
  )
}
