import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { Queue } from 'bullmq'
import { prisma, Prisma } from '@platform/db'
import {
  AIU_SCORING_JOB,
  AIU_SCORING_QUEUE,
  SaveCodeRequestSchema,
  StartSessionRequestSchema,
  getCommentPrefix,
  getFileExtension,
} from '@platform/types'
import type { SandboxLanguage } from '@platform/types'
import { sendError } from '../lib/errors'
import { signCandidateToken } from '../lib/jwt'
import { isAdminRole } from '../lib/roles'
import { getRedis } from '../lib/redis'
import { runCode } from '../lib/sandbox'
import { averageProblemCorrectness, scoreCodingProblem, scoreTechnicalEvaluation, type CodingStrictness } from '../lib/codingCorrectness'
import type { RouteOptions } from '../types'
import { mergeSessionRecordings } from '../lib/recordingMerger'

// ─── Param schema ─────────────────────────────────────────────────────────────

const sessionIdParam = z.object({ id: z.string().uuid() })
const PROCTOR_RETENTION_MS = 72 * 60 * 60 * 1000
const EXIT_RESUME_GRACE_MS = 30 * 60 * 1000

const rating5 = z.coerce.number().int().min(1).max(5)
const feedbackSchema = z.object({
  overall_experience: rating5,
  instructions_clarity: rating5,
  difficulty_relevance: rating5,
  platform_usability: rating5.optional(),
  technical_performance: rating5,
  coding_environment: rating5,
  ai_assistant_usefulness: rating5,
  ai_assistant_usage: z.enum(['VERY_USEFUL', 'SOMEWHAT_USEFUL', 'NOT_USEFUL', 'DID_NOT_USE', 'WAS_NOT_AVAILABLE']).optional(),
  proctoring_experience: rating5,
  fairness: rating5.optional(),
  recommendation_score: z.coerce.number().int().min(0).max(10).optional(),
  assessment_name: z.string().trim().max(160).optional(),
  task_where_issue_occurred: z.string().trim().max(160).optional(),
  technical_issue_type: z.string().trim().max(160).optional(),
  may_contact: z.boolean().optional(),
  comments: z.string().trim().max(2000).optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSandboxLanguage(lang: string): SandboxLanguage {
  return lang.toLowerCase() as SandboxLanguage
}

function serializeVisibleTestCase(tc: { id: string; input: string; expected: string }) {
  return { id: tc.id, input: tc.input, expected: tc.expected }
}

// Parses the code payload sent by the client. When the candidate has multiple
// open files the client serializes them as:
//   { __multifile__: true, main: "solution.py", files: { "solution.py": "...", "helpers.py": "..." } }
// Single-file sessions just send the raw code string.
function parseCodePayload(raw: string): { main: string; files: Record<string, string> } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      parsed.__multifile__ === true &&
      typeof parsed.files === 'object' &&
      parsed.files !== null
    ) {
      const files = parsed.files as Record<string, string>
      const mainName =
        typeof parsed.main === 'string' ? parsed.main : (Object.keys(files)[0] ?? '')
      return { main: mainName, files }
    }
  } catch {
    // not JSON - treat as plain code string
  }
  return { main: '', files: { '': raw } }
}

function problemFilename(index: number, language: string): string {
  const extension = getFileExtension(toSandboxLanguage(language))
  return `problem-${String(index + 1).padStart(2, '0')}.${extension}`
}

function solutionFilename(language: string): string {
  return `solution.${getFileExtension(toSandboxLanguage(language))}`
}

function assessmentProblemFilename(index: number, problemCount: number, language: string): string {
  return problemCount > 1 ? problemFilename(index, language) : solutionFilename(language)
}

function seedProblemWorkspace(problemCount: number, language: string): string {
  if (problemCount <= 1) {
    return `${getCommentPrefix(toSandboxLanguage(language))} Solution for problem 1\n`
  }
  const files = Object.fromEntries(Array.from({ length: problemCount }, (_, index) => {
    const filename = problemFilename(index, language)
    const comment = getCommentPrefix(toSandboxLanguage(language))
    return [filename, `${comment} Solution for problem ${index + 1}\n`]
  }))
  const main = problemFilename(0, language)
  return JSON.stringify({ __multifile__: true, main, files })
}

function codeForProblem(raw: string, index: number, language: string) {
  const workspace = parseCodePayload(raw)
  const filename = problemFilename(index, language)
  const mainCode = workspace.files[filename] ?? (index === 0 ? workspace.files[workspace.main] ?? '' : '')
  const problemFilePattern = /^problem-\d+\.(?:py|js|ts)$/
  const extraFiles = Object.entries(workspace.files)
    .filter(([name]) => {
      const normalized = name.replace(/\\/g, '/')
      const parts = normalized.split('/')
      return normalized.length > 0 && normalized !== '.' && !normalized.startsWith('/') &&
        !parts.includes('') && !parts.includes('.') && !parts.includes('..') &&
        name !== filename && !problemFilePattern.test(name)
    })
    .map(([filename, content]) => ({ filename, content }))
  return { mainCode, extraFiles }
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function sessionRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { authenticate } = opts.authHooks

  const redis = getRedis(opts.env.REDIS_URL)

  // BullMQ requires a dedicated connection - must not share with regular Redis
  // commands because it may use blocking commands internally.
  const redisUrl = new URL(opts.env.REDIS_URL)
  const aiuQueue = new Queue(AIU_SCORING_QUEUE, {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      username: redisUrl.username || undefined,
      password: redisUrl.password || undefined,
      db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1) || 0) : 0,
      maxRetriesPerRequest: null,
    },
  })

  // ── POST /api/v1/sessions/start ─────────────────────────────────────────────
  // No auth. Candidate presents an invite token UUID.
  // Creates a candidate User/session pair for that link. Invite links are
  // reusable until they expire, so a shared link can be used multiple times.

  fastify.post('/api/v1/sessions/start', async (request, reply) => {
    const bodyResult = StartSessionRequestSchema.safeParse(request.body)
    if (!bodyResult.success) {
      const msg = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
      return sendError(reply, 'VALIDATION_ERROR', msg)
    }

    const { token, candidate_name, candidate_email } = bodyResult.data

    const inviteToken = await prisma.inviteToken.findUnique({
      where: { token },
      include: {
        assessment: {
          include: {
            problems: {
              orderBy: { createdAt: 'asc' },
              include: {
                testCases: { orderBy: { createdAt: 'asc' } },
              },
            },
            tasks: { orderBy: { order: 'asc' } },
          },
        },
      },
    })

    if (!inviteToken) {
      return sendError(reply, 'NOT_FOUND', 'Invalid invite token')
    }

    if (inviteToken.expiresAt < new Date()) {
      return sendError(reply, 'TOKEN_EXPIRED', 'This invite token has expired')
    }

    // Email is the real credential here - the invite link alone isn't enough
    // if it leaks. Name is just a display label and is never checked.
    if (
      inviteToken.candidateEmail &&
      inviteToken.candidateEmail.trim().toLowerCase() !== candidate_email.trim().toLowerCase()
    ) {
      return sendError(reply, 'FORBIDDEN', 'This invite is tied to a different email address.')
    }

    const assessment = inviteToken.assessment
    const isProject = assessment.kind === 'PROJECT'
    const problem = assessment.problems[0]

    // Readiness differs by kind: CODING needs a problem, PROJECT needs tasks.
    if (isProject ? assessment.tasks.length === 0 : !problem) {
      return sendError(reply, 'NOT_FOUND', 'This assessment is not ready yet. Please contact the hiring team.')
    }

    const resolvedCandidateName = candidate_name?.trim() || inviteToken.candidateName
    const candidateEmail = candidate_email.trim().toLowerCase()

    const precheckExpiresAt = new Date(Math.min(inviteToken.expiresAt.getTime(), Date.now() + 60 * 60 * 1000))
    let txResult: { session: { id: string; candidateId: string; currentCode: string; status: string; expiresAt: Date | null }; accessToken: string; timeRemainingOverride?: number | null }
    txResult = await prisma.$transaction(async (tx) => {
      // Upsert the candidate user. A P2002 (unique constraint) here means a
      // concurrent request's transaction already created the user and committed
      // just before our own upsert ran - fall back to a plain lookup.
      let candidate: { id: string }
      try {
        candidate = await tx.user.upsert({
          where: { email: candidateEmail },
          update: {},
          create: { email: candidateEmail, passwordHash: null, role: 'STUDENT' },
          select: { id: true },
        })
      } catch (upsertErr) {
        if (
          upsertErr instanceof Prisma.PrismaClientKnownRequestError &&
          upsertErr.code === 'P2002'
        ) {
          candidate = await tx.user.findUniqueOrThrow({
            where: { email: candidateEmail },
            select: { id: true },
          })
        } else {
          throw upsertErr
        }
      }

      const existingSession = await tx.session.findFirst({
        where: {
          // An invite represents one attempt. Reopening the same link resumes
          // that attempt, while a newly generated link starts a fresh one even
          // for the same candidate and assessment.
          inviteTokenId: inviteToken.id,
          status: { in: ['PENDING', 'ACTIVE', 'SUBMITTED', 'EXPIRED'] },
        },
        orderBy: { startedAt: 'desc' },
        select: { id: true, candidateId: true, currentCode: true, status: true, expiresAt: true },
      })

      if (existingSession) {
        if (existingSession.status === 'SUBMITTED' || existingSession.status === 'EXPIRED') {
          return { session: existingSession, accessToken: '' }
        }
        const exitEvent = await tx.proctorEvent.findFirst({
          where: { sessionId: existingSession.id, eventType: 'CANDIDATE_EXITED' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, metadata: true },
        })
        const resumeEvent = await tx.proctorEvent.findFirst({
          where: { sessionId: existingSession.id, eventType: 'CANDIDATE_RESUMED' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
        if (exitEvent && (!resumeEvent || resumeEvent.createdAt < exitEvent.createdAt)) {
          const metadata = exitEvent.metadata as { remainingSeconds?: unknown } | null
          const remainingSeconds = typeof metadata?.remainingSeconds === 'number' ? metadata.remainingSeconds : null
          if (Date.now() - exitEvent.createdAt.getTime() > EXIT_RESUME_GRACE_MS || remainingSeconds === null || remainingSeconds <= 0) {
            const expiredSession = await tx.session.update({
              where: { id: existingSession.id },
              data: { status: 'EXPIRED' },
              select: { id: true, candidateId: true, currentCode: true, status: true, expiresAt: true },
            })
            return { session: expiredSession, accessToken: '' }
          }
          const accessToken = signCandidateToken(candidate.id, existingSession.id, existingSession.expiresAt ?? precheckExpiresAt, opts.env.JWT_SECRET)
          return { session: existingSession, accessToken, timeRemainingOverride: remainingSeconds }
        }
        if (existingSession.status === 'ACTIVE' && existingSession.expiresAt && existingSession.expiresAt <= new Date()) {
          const expiredSession = await tx.session.update({
            where: { id: existingSession.id },
            data: { status: 'EXPIRED' },
            select: { id: true, candidateId: true, currentCode: true, status: true, expiresAt: true },
          })
          return { session: expiredSession, accessToken: '' }
        }
        const tokenExpiresAt = existingSession.status === 'ACTIVE' && existingSession.expiresAt
          ? existingSession.expiresAt
          : precheckExpiresAt
        const accessToken = signCandidateToken(
          candidate.id,
          existingSession.id,
          tokenExpiresAt,
          opts.env.JWT_SECRET,
        )
        return { session: existingSession, accessToken }
      }

        const session = await tx.session.create({
          data: {
            assessmentId: assessment.id,
            candidateId: candidate.id,
            inviteTokenId: inviteToken.id,
            candidateName: resolvedCandidateName,
            language: assessment.language,
            // Snapshot the assistant mode for this attempt. Enforcement and the
            // report read this rather than the live assessment value, so editing
            // the assessment later cannot retroactively change the conditions an
            // in-flight or already-scored candidate was evaluated under.
            aiAssistantMode: isProject ? assessment.aiAssistantMode : 'DISABLED',
            scoringStrictness: assessment.scoringStrictness,
            currentCode: isProject
              ? ''
              : seedProblemWorkspace(assessment.problems.length, assessment.language),
            status: 'PENDING',
            startedAt: null,
            expiresAt: null,
        },
        select: { id: true, candidateId: true, currentCode: true, status: true, expiresAt: true },
      })

      const accessToken = signCandidateToken(
        candidate.id,
        session.id,
        precheckExpiresAt,
        opts.env.JWT_SECRET,
      )

      return { session, accessToken }
    })

    const { session, accessToken } = txResult

    if (session.status === 'SUBMITTED' || session.status === 'EXPIRED') {
      return sendError(
        reply,
        'SESSION_EXPIRED',
        session.status === 'SUBMITTED' ? 'This assessment has already been submitted.' : 'This assessment has expired.',
      )
    }

    return reply.status(201).send({
      data: {
        access_token: accessToken,
        session_id: session.id,
        time_remaining: session.expiresAt
        ? (txResult.timeRemainingOverride ?? Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)))
          : null,
        current_code: session.currentCode,
        kind: assessment.kind,
        problems: isProject
          ? []
          : assessment.problems.map((item, index) => ({
              id: item.id,
              title: item.title,
              description: item.description,
              difficulty: item.difficulty,
              allow_copy_paste: (item as { allowCopyPaste?: boolean }).allowCopyPaste ?? false,
              solution_file: assessmentProblemFilename(index, assessment.problems.length, assessment.language),
              visible_test_cases: item.testCases
                .filter((tc: { isHidden: boolean }) => !tc.isHidden)
                .map(serializeVisibleTestCase),
            })),
        // Kept for compatibility with clients that predate multi-problem assessments.
        problem: isProject
          ? null
          : {
              id: problem!.id,
              title: problem!.title,
              description: problem!.description,
              difficulty: problem!.difficulty,
              allow_copy_paste: (problem as { allowCopyPaste?: boolean }).allowCopyPaste ?? false,
              // Hard rule: hidden test cases never reach the client.
              visible_test_cases: problem!.testCases
                .filter((tc: { isHidden: boolean }) => !tc.isHidden)
                .map(serializeVisibleTestCase),
            },
        // PROJECT: the brief - tasks, provided template/models, connection details,
        // and required submission files. Null for CODING.
        project: isProject
          ? {
              template_info: assessment.templateInfo ?? null,
              allowed_models: [assessment.llmModel],
              connection_details:
                (assessment.connectionDetails as Array<{ label: string; value: string }> | null) ?? [],
              submission_files:
                (assessment.submissionFiles as Array<{ name: string; description: string }> | null) ?? [],
              tasks: assessment.tasks.map((t) => ({
                id: t.id,
                order: t.order,
                title: t.title,
                description: t.description,
                done_when: Array.isArray(t.doneWhen) ? (t.doneWhen as string[]) : [],
              })),
            }
          : null,
        assessment: {
          title: assessment.title,
          time_limit_minutes: assessment.timeLimitMinutes,
          language: assessment.language,
          llm_model: assessment.llmModel,
          allowed_models: [assessment.llmModel],
          allow_copy_paste: assessment.allowCopyPaste,
          // Advisory only - the client renders the assistant to match this, but
          // the gateway enforces it independently from the session snapshot.
          ai_assistant_mode: isProject ? assessment.aiAssistantMode : 'DISABLED',
          proctoring: {
            screen_recording: assessment.screenRecording,
            video_proctoring: assessment.videoProctoring,
            microphone_recording: assessment.microphoneRecording,
            second_camera: assessment.secondCamera,
          },
        },
      },
    })
  })

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/activate',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const params = sessionIdParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')

      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== params.data.id) {
        return sendError(reply, 'FORBIDDEN', 'Access denied')
      }

      const session = await prisma.session.findUnique({
        where: { id: params.data.id },
        include: { assessment: { select: { timeLimitMinutes: true } } },
      })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')
      if (session.status === 'SUBMITTED' || session.status === 'EXPIRED') {
        return sendError(reply, 'SESSION_EXPIRED', 'Session can no longer be activated')
      }

      const passedCheck = await prisma.proctorEvent.findFirst({
        where: {
          sessionId: session.id,
          eventType: 'SYSTEM_CHECK_PASSED',
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      })
      if (!passedCheck) return sendError(reply, 'FORBIDDEN', 'Complete the system check before starting')

      const startedAt = session.startedAt ?? new Date()
      const exitEvent = await prisma.proctorEvent.findFirst({
        where: { sessionId: session.id, eventType: 'CANDIDATE_EXITED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, metadata: true },
      })
      const resumeEvent = await prisma.proctorEvent.findFirst({
        where: { sessionId: session.id, eventType: 'CANDIDATE_RESUMED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      const pendingResume = exitEvent && (!resumeEvent || resumeEvent.createdAt < exitEvent.createdAt)
      const remainingSeconds = pendingResume && typeof (exitEvent.metadata as { remainingSeconds?: unknown } | null)?.remainingSeconds === 'number'
        ? (exitEvent.metadata as { remainingSeconds: number }).remainingSeconds
        : null
      const expiresAt = remainingSeconds !== null
        ? new Date(Date.now() + remainingSeconds * 1000)
        : session.expiresAt ?? new Date(startedAt.getTime() + session.assessment.timeLimitMinutes * 60 * 1000)
      if (session.status === 'PENDING') {
        await prisma.session.update({
          where: { id: session.id },
          data: { status: 'ACTIVE', startedAt, expiresAt },
        })
        const evidenceExpiresAt = new Date(expiresAt.getTime() + PROCTOR_RETENTION_MS)
        await prisma.proctorEvent.updateMany({ where: { sessionId: session.id }, data: { expiresAt: evidenceExpiresAt } })
        await prisma.proctorMedia.updateMany({ where: { sessionId: session.id }, data: { expiresAt: evidenceExpiresAt } })
      } else if (remainingSeconds !== null) {
        await prisma.$transaction(async (tx) => {
          await tx.session.update({ where: { id: session.id }, data: { expiresAt } })
          const evidenceExpiresAt = new Date(expiresAt.getTime() + PROCTOR_RETENTION_MS)
          await tx.proctorEvent.create({
            data: {
              sessionId: session.id,
              source: 'DESKTOP',
              eventType: 'CANDIDATE_RESUMED',
              metadata: { remainingSeconds },
              expiresAt: evidenceExpiresAt,
            },
          })
          await tx.proctorEvent.updateMany({ where: { sessionId: session.id }, data: { expiresAt: evidenceExpiresAt } })
          await tx.proctorMedia.updateMany({ where: { sessionId: session.id }, data: { expiresAt: evidenceExpiresAt } })
        })
      }

      return reply.send({
        data: {
          access_token: signCandidateToken(session.candidateId, session.id, expiresAt, opts.env.JWT_SECRET),
          started_at: startedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
      })
    },
  )

  // ── GET /api/v1/sessions/:id ─────────────────────────────────────────────────
  // Candidate (own session) or Admin. Primary reconnection endpoint - returns
  // the last saved code so the editor can restore state on reconnect.

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/sessions/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }

      const { id } = paramsResult.data
      const payload = request.jwtPayload!

      // Candidates are scoped to their own session via the JWT claim.
      if (payload.role === 'STUDENT' && payload.session_id !== id) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      const session = await prisma.session.findUnique({ where: { id } })

      if (!session) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      // Admins can only view sessions belonging to their own assessments.
      if (isAdminRole(payload.role)) {
        const assessment = await prisma.assessment.findUnique({
          where: { id: session.assessmentId },
          select: { createdBy: true },
        })
        if (!assessment || (payload.role !== 'MASTER' && assessment.createdBy !== payload.sub)) {
          return sendError(reply, 'NOT_FOUND', 'Session not found')
        }
      }

      const now = Date.now()
      const timeRemaining = session.expiresAt
        ? Math.max(0, Math.floor((session.expiresAt.getTime() - now) / 1000))
        : null

      return reply.status(200).send({
        data: {
          session_id: session.id,
          assessment_id: session.assessmentId,
          status: session.status,
          current_code: session.currentCode,
          time_remaining: timeRemaining,
          language: session.language,
          ai_assistant_mode: session.aiAssistantMode,
          started_at: session.startedAt?.toISOString() ?? null,
          expires_at: session.expiresAt?.toISOString() ?? null,
        },
      })
    },
  )

  // ── PATCH /api/v1/sessions/:id/code ─────────────────────────────────────────
  // Candidate only. Triggered by interval save (10s) and debounced save (2s).
  // Writes to DB first (durable), then to Redis (live cache with TTL).
  // On reconnection, DB is the source of truth - never Redis alone.

  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/code',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }

      const { id } = paramsResult.data
      const payload = request.jwtPayload!

      if (payload.role !== 'STUDENT') {
        return sendError(reply, 'FORBIDDEN', 'Candidate access required')
      }

      if (payload.session_id !== id) {
        return sendError(reply, 'FORBIDDEN', 'Access denied')
      }

      const bodyResult = SaveCodeRequestSchema.safeParse(request.body)
      if (!bodyResult.success) {
        const msg = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const { code } = bodyResult.data

      const session = await prisma.session.findUnique({
        where: { id },
        select: { status: true, expiresAt: true },
      })

      if (!session) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      if (session.status === 'SUBMITTED') {
        return sendError(reply, 'SUBMISSION_LOCKED', 'Session has already been submitted')
      }

      if (session.status !== 'ACTIVE') {
        return sendError(reply, 'SESSION_EXPIRED', 'Session is not active')
      }

      if (session.expiresAt && session.expiresAt < new Date()) {
        await prisma.session.update({ where: { id }, data: { status: 'EXPIRED' } })
        return sendError(reply, 'SESSION_EXPIRED', 'Session time limit has been exceeded')
      }

      const savedAt = new Date()

      await prisma.session.update({ where: { id }, data: { currentCode: code } })

      const ttlSeconds = session.expiresAt
        ? Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))
        : 3600

      await redis.set(`session:${id}:code`, code, 'EX', ttlSeconds)

      return reply.status(200).send({ data: { saved_at: savedAt.toISOString() } })
    },
  )


  fastify.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/exit',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const { id } = paramsResult.data
      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== id) return sendError(reply, 'FORBIDDEN', 'Access denied')

      const bodyResult = SaveCodeRequestSchema.safeParse(request.body)
      if (!bodyResult.success) return sendError(reply, 'VALIDATION_ERROR', bodyResult.error.errors[0]?.message ?? 'Invalid request body')

      const session = await prisma.session.findUnique({ where: { id }, select: { status: true, expiresAt: true } })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')
      if (session.status === 'SUBMITTED') return sendError(reply, 'SUBMISSION_LOCKED', 'Session has already been submitted')
      if (session.status !== 'ACTIVE') return sendError(reply, 'SESSION_EXPIRED', 'Session is not active')

      const now = new Date()
      const remainingSeconds = typeof bodyResult.data.remaining_seconds === 'number'
        ? bodyResult.data.remaining_seconds
        : session.expiresAt ? Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000)) : null
      if (remainingSeconds !== null && remainingSeconds <= 0) {
        await prisma.session.update({ where: { id }, data: { status: 'EXPIRED' } })
        return sendError(reply, 'SESSION_EXPIRED', 'Session time limit has been exceeded')
      }

      const resumeUntil = new Date(now.getTime() + EXIT_RESUME_GRACE_MS)
      await prisma.$transaction(async (tx) => {
        await tx.session.update({ where: { id }, data: { currentCode: bodyResult.data.code, expiresAt: resumeUntil } })
        await tx.proctorEvent.create({
          data: {
            sessionId: id,
            source: 'DESKTOP',
            eventType: 'CANDIDATE_EXITED',
            metadata: { remainingSeconds },
            expiresAt: new Date(resumeUntil.getTime() + PROCTOR_RETENTION_MS),
          },
        })
      })

      return reply.status(200).send({ data: { remaining_seconds: remainingSeconds, resume_until: resumeUntil.toISOString() } })
    },
  )
  // ── POST /api/v1/sessions/:id/submit ─────────────────────────────────────────
  // Candidate only. Runs all test cases (hidden + visible), calculates code
  // correctness score, persists it, transitions session to SUBMITTED, and
  // enqueues an AIU scoring job. Response never includes scores or hidden results.

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/submit',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }

      const { id } = paramsResult.data
      const payload = request.jwtPayload!

      if (payload.role !== 'STUDENT') {
        return sendError(reply, 'FORBIDDEN', 'Candidate access required')
      }

      if (payload.session_id !== id) {
        return sendError(reply, 'FORBIDDEN', 'Access denied')
      }

      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          assessment: {
            include: {
              problems: {
                orderBy: { createdAt: 'asc' },
                include: { testCases: true },
              },
            },
          },
        },
      })

      if (!session) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      if (session.status === 'SUBMITTED') {
        return sendError(reply, 'SUBMISSION_LOCKED', 'Session has already been submitted')
      }

      if (session.status !== 'ACTIVE') {
        return sendError(reply, 'SESSION_EXPIRED', 'Session is not active')
      }

      if (session.expiresAt && session.expiresAt < new Date()) {
        await prisma.session.update({ where: { id }, data: { status: 'EXPIRED' } })
        return sendError(reply, 'SESSION_EXPIRED', 'Session time limit has been exceeded')
      }

      const problemScores: number[] = []
      const technicalScores: Array<ReturnType<typeof scoreTechnicalEvaluation>> = []
      const codingTestEvidence: Array<{
        problem_index: number
        problem_title: string
        execution_status: string
        visible_passed: number
        visible_total: number
        hidden_passed: number
        hidden_total: number
        total_passed: number
        total_tests: number
        critical_failed: number
        category_scores: { correctness: number; efficiency: number; robustness: number; code_quality: number }
        category_states: Record<string, string>
        technical_evidence: Record<string, unknown>
        problem_score: number
      }> = []
      for (const [index, problem] of session.assessment.problems.entries()) {
        const testCases = problem.testCases.map((tc) => ({
          id: tc.id,
          input: tc.input,
          expected: tc.expected,
          isHidden: tc.isHidden,
        }))
        const { mainCode, extraFiles } = codeForProblem(session.currentCode, index, session.language)
        const result = await runCode(opts.env.SANDBOX_URL, {
          language: toSandboxLanguage(session.language),
          code: mainCode,
          testCases,
          ...(extraFiles.length > 0 ? { extraFiles } : {}),
        })
        const technical = scoreTechnicalEvaluation(problem.testCases, result, mainCode, problem.description)
        technicalScores.push(technical)
        const problemScore = scoreCodingProblem(
          problem.testCases,
          result,
          (session.scoringStrictness ?? 'MEDIUM') as CodingStrictness,
        )
        problemScores.push(problemScore)
        const statusById = new Map(result.results.map((item) => [item.testCaseId, item.status]))
        const passed = (tc: { id: string }) => statusById.get(tc.id) === 'pass'
        const visible = problem.testCases.filter((tc) => !tc.isHidden)
        const hidden = problem.testCases.filter((tc) => tc.isHidden)
        codingTestEvidence.push({
          problem_index: index + 1,
          problem_title: problem.title,
          execution_status: result.status,
          visible_passed: visible.filter(passed).length,
          visible_total: visible.length,
          hidden_passed: hidden.filter(passed).length,
          hidden_total: hidden.length,
          total_passed: result.passed,
          total_tests: problem.testCases.length,
          critical_failed: problem.testCases.filter((tc) => tc.isCritical && statusById.get(tc.id) !== 'pass').length,
          category_scores: { correctness: technical.correctness, efficiency: technical.efficiency, robustness: technical.robustness, code_quality: technical.codeQuality },
          category_states: technical.states,
          technical_evidence: technical.evidence,
          problem_score: problemScore,
        })
      }
      const codeCorrectnessScore = averageProblemCorrectness(problemScores)
      const averageTechnical = (key: 'correctness' | 'efficiency' | 'robustness' | 'codeQuality' | 'total') =>
        averageProblemCorrectness(technicalScores.map((score) => score[key]))
      const technicalCriteriaScores = {
        correctness: averageTechnical('correctness'),
        efficiency: averageTechnical('efficiency'),
        robustness: averageTechnical('robustness'),
        code_quality: averageTechnical('codeQuality'),
      }
      const technicalTotalScore = averageTechnical('total')
      const scoreEvidence = JSON.parse(JSON.stringify({
        scoring_strictness: session.scoringStrictness ?? 'MEDIUM',
        coding_test_evidence: { problems: codingTestEvidence },
      }))

      // Persist score and transition session atomically. AIU scores start at 0
      // and will be populated by the worker once the job is processed.
      const submittedAt = new Date()
      const evidenceExpiresAt = new Date(submittedAt.getTime() + PROCTOR_RETENTION_MS)
      await prisma.$transaction(async (tx) => {
        await tx.sessionScore.upsert({
          where: { sessionId: id },
          create: {
            sessionId: id,
            codeCorrectnessScore,
            aiuScores: technicalCriteriaScores,
            aiuTotalScore: technicalTotalScore,
            totalScore: technicalTotalScore,
            rubricVersion: 'DISABLED_TECHNICAL_V2',
            scoreEvidence,
          },
          update: {
            codeCorrectnessScore,
            aiuScores: technicalCriteriaScores,
            aiuTotalScore: technicalTotalScore,
            totalScore: technicalTotalScore,
            scoreEvidence,
          },
        })
        await tx.session.update({
          where: { id },
          data: { status: 'SUBMITTED', submittedAt },
        })
        await tx.proctorEvent.updateMany({ where: { sessionId: id }, data: { expiresAt: evidenceExpiresAt } })
        await tx.proctorMedia.updateMany({ where: { sessionId: id }, data: { expiresAt: evidenceExpiresAt } })
      })

      // Enqueue AIU job after the transaction commits. If this fails we log and
      // continue - the session is already submitted and can be re-queued manually.
      try {
        await aiuQueue.add(AIU_SCORING_JOB, { session_id: id }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        })
      } catch (err) {
        fastify.log.error({ err, sessionId: id }, 'Failed to enqueue AIU scoring job')
      }

      void mergeSessionRecordings(opts.env, id).catch((err) => {
        fastify.log.error({ err, sessionId: id }, 'Failed to merge proctor recordings')
      })

      return reply.status(200).send({
        data: { message: 'Assessment submitted. Results are being processed.' },
      })
    },
  )

  // ── POST /api/v1/sessions/:id/feedback ─────────────────────────────────────
  // Candidate only. Required by the completion page before the candidate exits.
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/feedback',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')

      const { id } = paramsResult.data
      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT' || payload.session_id !== id) return sendError(reply, 'FORBIDDEN', 'Candidate access required')

      const bodyResult = feedbackSchema.safeParse(request.body)
      if (!bodyResult.success) {
        const msg = bodyResult.error.errors[0]?.message ?? 'Invalid feedback'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const session = await prisma.session.findUnique({ where: { id }, select: { id: true, status: true } })
      if (!session) return sendError(reply, 'NOT_FOUND', 'Session not found')
      if (session.status !== 'SUBMITTED' && session.status !== 'EXPIRED') {
        return sendError(reply, 'SESSION_EXPIRED', 'Feedback can be submitted after assessment completion')
      }

      const feedback = bodyResult.data
      await prisma.$executeRaw`
        INSERT INTO "SessionFeedback" (
          "id", "sessionId", "overallExperience", "instructionsClarity", "difficultyRelevance",
          "platformUsability", "technicalPerformance", "codingEnvironment", "aiAssistantUsefulness",
          "aiAssistantUsage", "proctoringExperience", "fairness", "recommendationScore",
          "assessmentName", "taskWhereIssueOccurred", "technicalIssueType", "mayContact", "comments", "submittedAt"
        ) VALUES (
          ${randomUUID()}, ${id}, ${feedback.overall_experience}, ${feedback.instructions_clarity}, ${feedback.difficulty_relevance},
          ${feedback.platform_usability ?? feedback.overall_experience}, ${feedback.technical_performance}, ${feedback.coding_environment}, ${feedback.ai_assistant_usefulness},
          ${feedback.ai_assistant_usage ?? null}, ${feedback.proctoring_experience}, ${feedback.fairness ?? feedback.overall_experience}, ${feedback.recommendation_score ?? feedback.overall_experience * 2},
          ${feedback.assessment_name ?? null}, ${feedback.task_where_issue_occurred ?? null}, ${feedback.technical_issue_type ?? null}, ${feedback.may_contact ?? false}, ${feedback.comments ?? null}, ${new Date()}
        )
        ON CONFLICT ("sessionId") DO UPDATE SET
          "overallExperience" = EXCLUDED."overallExperience",
          "instructionsClarity" = EXCLUDED."instructionsClarity",
          "difficultyRelevance" = EXCLUDED."difficultyRelevance",
          "platformUsability" = EXCLUDED."platformUsability",
          "technicalPerformance" = EXCLUDED."technicalPerformance",
          "codingEnvironment" = EXCLUDED."codingEnvironment",
          "aiAssistantUsefulness" = EXCLUDED."aiAssistantUsefulness",
          "aiAssistantUsage" = EXCLUDED."aiAssistantUsage",
          "proctoringExperience" = EXCLUDED."proctoringExperience",
          "fairness" = EXCLUDED."fairness",
          "recommendationScore" = EXCLUDED."recommendationScore",
          "assessmentName" = EXCLUDED."assessmentName",
          "taskWhereIssueOccurred" = EXCLUDED."taskWhereIssueOccurred",
          "technicalIssueType" = EXCLUDED."technicalIssueType",
          "mayContact" = EXCLUDED."mayContact",
          "comments" = EXCLUDED."comments",
          "submittedAt" = EXCLUDED."submittedAt"
      `

      return reply.status(200).send({ data: { saved: true } })
    },
  )

  // ── POST /api/v1/sessions/:id/run ────────────────────────────────────────────
  // Candidate only. Executes the provided code against visible test cases only.
  // Hidden test cases are never sent to the sandbox or returned to the client.
  // Does not affect session status or score.

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/run',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }

      const { id } = paramsResult.data
      const payload = request.jwtPayload!

      if (payload.role !== 'STUDENT') {
        return sendError(reply, 'FORBIDDEN', 'Candidate access required')
      }

      if (payload.session_id !== id) {
        return sendError(reply, 'FORBIDDEN', 'Access denied')
      }

      const bodyResult = SaveCodeRequestSchema.extend({ problem_id: z.string().uuid() }).safeParse(request.body)
      if (!bodyResult.success) {
        const msg = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const { code, problem_id: problemId } = bodyResult.data

      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          assessment: {
            include: {
              problems: {
                orderBy: { createdAt: 'asc' },
                include: {
                  // Fetch only visible test cases - hidden content never leaves the server.
                  testCases: {
                    where: { isHidden: false },
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
            },
          },
        },
      })

      if (!session) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      if (session.status === 'SUBMITTED') {
        return sendError(reply, 'SUBMISSION_LOCKED', 'Session has already been submitted')
      }

      if (session.status !== 'ACTIVE') {
        return sendError(reply, 'SESSION_EXPIRED', 'Session is not active')
      }

      if (session.expiresAt && session.expiresAt < new Date()) {
        return sendError(reply, 'SESSION_EXPIRED', 'Session time limit has been exceeded')
      }

      const problemIndex = session.assessment.problems.findIndex((problem) => problem.id === problemId)
      if (problemIndex < 0) return sendError(reply, 'NOT_FOUND', 'Problem not found')
      const visibleTestCases = session.assessment.problems[problemIndex].testCases.map((tc) => ({
        id: tc.id,
        input: tc.input,
        expected: tc.expected,
        isHidden: false as const,
      }))

      const { mainCode, extraFiles } = codeForProblem(code, problemIndex, session.language)
      const executionResult = await runCode(opts.env.SANDBOX_URL, {
        language: toSandboxLanguage(session.language),
        code: mainCode,
        testCases: visibleTestCases,
        ...(extraFiles.length > 0 ? { extraFiles } : {}),
      })

      await prisma.runEvent.create({
        data: {
          sessionId: id,
          problemId,
          status: executionResult.status,
          passed: executionResult.passed,
          failed: executionResult.failed,
          codeSnapshot: code,
        },
      })

      return reply.status(200).send({
        data: {
          status: executionResult.status,
          passed: executionResult.passed,
          failed: executionResult.failed,
          results: executionResult.results.map((r) => ({
            test_case_id: r.testCaseId,
            status: r.status,
            stdout: r.stdout,
            stderr: r.stderr,
          })),
        },
      })
    },
  )
}
