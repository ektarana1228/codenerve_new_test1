import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma, prisma } from '@platform/db'
import {
  CreateAssessmentRequestSchema,
  UpdateAssessmentRequestSchema,
  AssessmentStatusSchema,
} from '@platform/types'
import { sendError } from '../lib/errors'
import { isMaster } from '../lib/roles'
import type { RouteOptions } from '../types'

// ─── Serialisers ──────────────────────────────────────────────────────────────
// Converts Prisma Date objects to ISO strings and maps camelCase fields to
// the snake_case convention used throughout the API.

type PrismaTestCase = {
  id: string
  problemId: string
  input: string
  expected: string
  isHidden: boolean
  category?: string
  weight?: number
  isCritical?: boolean
  createdAt: Date
}

type PrismaProblem = {
  id: string
  assessmentId: string
  title: string
  description: string
  difficulty: string
  allowCopyPaste?: boolean
  createdAt: Date
  testCases?: PrismaTestCase[]
}


function serializeTestCase(tc: PrismaTestCase) {
  return {
    id: tc.id,
    problem_id: tc.problemId,
    input: tc.input,
    expected: tc.expected,
    is_hidden: tc.isHidden,
    category: tc.category ?? 'STANDARD',
    weight: tc.weight ?? 1,
    is_critical: tc.isCritical ?? false,
    created_at: tc.createdAt.toISOString(),
  }
}

function serializeProblem(p: PrismaProblem) {
  return {
    id: p.id,
    assessment_id: p.assessmentId,
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    allow_copy_paste: p.allowCopyPaste ?? false,
    created_at: p.createdAt.toISOString(),
    ...(p.testCases !== undefined && {
      test_cases: p.testCases.map(serializeTestCase),
    }),
  }
}

type PrismaTask = {
  id: string
  assessmentId: string
  order: number
  title: string
  description: string
  doneWhen: unknown
  createdAt: Date
}

function serializeTask(t: PrismaTask) {
  return {
    id: t.id,
    assessment_id: t.assessmentId,
    order: t.order,
    title: t.title,
    description: t.description,
    done_when: Array.isArray(t.doneWhen) ? (t.doneWhen as string[]) : [],
    created_at: t.createdAt.toISOString(),
  }
}

function serializeAssessment(a: {
  id: string
  title: string
  description: string | null
  createdBy: string
  kind?: string
  timeLimitMinutes: number
  language: string
  llmModel: string
  allowedModels?: string[]
  templateInfo?: string | null
  connectionDetails?: unknown
  submissionFiles?: unknown
  referenceFiles?: unknown
  projectScoringCriteria?: unknown
  scoringStrictness?: string
  codeWeight: number
  aiuWeight: number
  aiuMetrics: string[]
  aiuMetricWeights: unknown
  allowCopyPaste?: boolean
  aiAssistantMode?: string
  screenRecording?: string
  videoProctoring?: string
  microphoneRecording?: string
  secondCamera?: string
  status: string
  scheduledStart: Date | null
  expiresAt: Date | null
  createdAt: Date
  problems?: PrismaProblem[]
  tasks?: PrismaTask[]
  feedbackSummary?: { responses: number; average_rating: number | null }
}) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    created_by: a.createdBy,
    kind: a.kind ?? 'CODING',
    time_limit_minutes: a.timeLimitMinutes,
    language: a.language,
    llm_model: a.llmModel,
    allowed_models: (a.kind ?? 'CODING') === 'PROJECT' ? [a.llmModel] : [],
    template_info: a.templateInfo ?? null,
    connection_details: (a.connectionDetails as Array<{ label: string; value: string }> | null) ?? [],
    submission_files: (a.submissionFiles as Array<{ name: string; description: string }> | null) ?? [],
    // Reference file CONTENT is never returned to clients (payload bloat); only
    // the path + decoded size for display in the admin UI.
    reference_files:
      ((a.referenceFiles as Array<{ path: string; contentBase64: string }> | null) ?? []).map((f) => ({
        path: f.path,
        size: Math.floor((f.contentBase64.length * 3) / 4),
      })),
    project_scoring_criteria:
      (a.projectScoringCriteria as Array<{ key: string; name: string; description: string; weight: number }> | null) ?? [],
    scoring_strictness: a.scoringStrictness ?? 'MEDIUM',
    code_weight: a.codeWeight,
    aiu_weight: a.aiuWeight,
    aiu_metrics: a.aiuMetrics,
    aiu_metric_weights: a.aiuMetricWeights as Record<string, number>,
    allow_copy_paste: a.allowCopyPaste ?? false,
    ai_assistant_mode: a.aiAssistantMode ?? 'DISABLED',
    screen_recording: a.screenRecording ?? 'OFF',
    video_proctoring: a.videoProctoring ?? 'OFF',
    microphone_recording: a.microphoneRecording ?? 'OFF',
    second_camera: a.secondCamera ?? 'OFF',
    status: a.status,
    scheduled_start: a.scheduledStart?.toISOString() ?? null,
    expires_at: a.expiresAt?.toISOString() ?? null,
    created_at: a.createdAt.toISOString(),
    ...(a.problems !== undefined && { problems: a.problems.map(serializeProblem) }),
    ...(a.tasks !== undefined && { tasks: a.tasks.map(serializeTask) }),
    ...(a.feedbackSummary !== undefined && { feedback_summary: a.feedbackSummary }),
  }
}

async function feedbackSummariesByAssessment(assessmentIds: string[]) {
  if (assessmentIds.length === 0) return new Map<string, { responses: number; average_rating: number | null }>()
  const rows = await prisma.$queryRaw<Array<{
    assessmentId: string
    responses: bigint
    averageRating: number | null
  }>>`
    SELECT
      s."assessmentId" AS "assessmentId",
      COUNT(*)::bigint AS "responses",
      AVG((
        f."overallExperience" + f."instructionsClarity" + f."difficultyRelevance" +
        f."platformUsability" + f."technicalPerformance" + f."codingEnvironment" +
        f."aiAssistantUsefulness" + f."proctoringExperience" + f."fairness"
      ) / 9.0) AS "averageRating"
    FROM "SessionFeedback" f
    JOIN "Session" s ON s."id" = f."sessionId"
    WHERE s."assessmentId" IN (${Prisma.join(assessmentIds)})
    GROUP BY s."assessmentId"
  `
  return new Map(rows.map((row) => [row.assessmentId, {
    responses: Number(row.responses),
    average_rating: row.averageRating == null ? null : Math.round(Number(row.averageRating) * 10) / 10,
  }]))
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

const uuidParam = z.object({ id: z.string().uuid() })

export async function assessmentRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  // ── POST /api/v1/assessments ────────────────────────────────────────────────
  // Create a new assessment in DRAFT status. codeWeight + aiuWeight = 100 and
  // aiuMetricWeights sum = 100 are enforced by the Zod schema (.refine).

  fastify.post(
    '/api/v1/assessments',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const result = CreateAssessmentRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const data = result.data
      const adminId = request.jwtPayload!.sub

      const assessment = await prisma.assessment.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          createdBy: adminId,
          kind: data.kind,
          timeLimitMinutes: data.timeLimitMinutes,
          language: data.language,
          llmModel: data.llmModel,
          // PROJECT-kind fields (empty/null for CODING).
          allowedModels: data.kind === 'PROJECT' ? [data.llmModel] : [],
          templateInfo: data.templateInfo ?? null,
          connectionDetails: data.connectionDetails ?? [],
          submissionFiles: data.submissionFiles ?? [],
          referenceFiles: data.referenceFiles ?? [],
          solutionFiles: data.solutionFiles ?? [],
          projectScoringCriteria: data.kind === 'PROJECT' ? data.projectScoringCriteria : undefined,
          scoringStrictness: data.scoringStrictness,
          codeWeight: data.codeWeight,
          aiuWeight: data.aiuWeight,
          aiuMetrics: { set: data.aiuMetrics },
          aiuMetricWeights: data.aiuMetricWeights,
          allowCopyPaste: data.allowCopyPaste,
          // Coding assessments are Disabled-only; Project/Migration assessments
          // keep the recruiter-selected mode, defaulting to Agentic.
          aiAssistantMode: data.kind === 'PROJECT' ? (data.aiAssistantMode ?? 'AGENTIC') : 'DISABLED',
          screenRecording: data.screenRecording,
          videoProctoring: data.videoProctoring,
          microphoneRecording: data.microphoneRecording,
          secondCamera: data.secondCamera,
          status: 'DRAFT',
          scheduledStart: data.scheduledStart ? new Date(data.scheduledStart) : null,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          // Tasks are authored inline for PROJECT assessments (unlike problems,
          // which are added separately). Empty for CODING.
          ...(data.tasks.length > 0 && {
            tasks: {
              create: data.tasks.map((t, i) => ({
                order: i,
                title: t.title,
                description: t.description,
                doneWhen: t.doneWhen,
                difficulty: t.difficulty,
                bugBankId: t.bugBankId,
              })),
            },
          }),
        },
        include: { tasks: { orderBy: { order: 'asc' } } },
      })

      return reply.status(201).send({ data: serializeAssessment(assessment) })
    },
  )

  // ── GET /api/v1/assessments ─────────────────────────────────────────────────
  // Lists all assessments for this admin. Supports cursor-based pagination and
  // optional status filter.

  fastify.get<{
    Querystring: { status?: string; cursor?: string; limit?: string }
  }>(
    '/api/v1/assessments',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const queryResult = z
        .object({
          status: AssessmentStatusSchema.optional(),
          cursor: z.string().uuid().optional(),
          limit: z.coerce
            .number()
            .int()
            .positive()
            .max(MAX_PAGE_SIZE)
            .default(DEFAULT_PAGE_SIZE),
        })
        .safeParse(request.query)

      if (!queryResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid query parameters')
      }

      const { status, cursor, limit } = queryResult.data
      const payload = request.jwtPayload!

      const rows = await prisma.assessment.findMany({
        where: {
          ...(!isMaster(payload) ? { createdBy: payload.sub } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })

      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null
      const feedbackSummaries = await feedbackSummariesByAssessment(page.map((a) => a.id))

      return reply.status(200).send({
        data: page.map((a: Parameters<typeof serializeAssessment>[0]) => serializeAssessment({
          ...a,
          feedbackSummary: feedbackSummaries.get(a.id) ?? { responses: 0, average_rating: null },
        })),
        next_cursor: nextCursor,
      })
    },
  )

  // ── GET /api/v1/assessments/:id ─────────────────────────────────────────────
  // Full assessment detail including all problems and all test cases.
  // Admin sees hidden test case content - no stripping here.

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/assessments/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = uuidParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }

      const { id } = paramsResult.data
      const payload = request.jwtPayload!

      const assessment = await prisma.assessment.findUnique({
        where: { id },
        include: {
          problems: {
            orderBy: { createdAt: 'asc' },
            include: {
              testCases: { orderBy: { createdAt: 'asc' } },
            },
          },
          tasks: { orderBy: { order: 'asc' } },
        },
      })

      if (!assessment) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      if (!isMaster(payload) && assessment.createdBy !== payload.sub) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      return reply.status(200).send({ data: serializeAssessment(assessment) })
    },
  )

  // ── PATCH /api/v1/assessments/:id ───────────────────────────────────────────
  // Partial update. Blocked if any session is ACTIVE or SUBMITTED (FR-02:
  // "cannot edit once any candidate has started").
  // Weight constraints are re-validated against the merged (current + incoming)
  // values - prevents partial updates from silently breaking the invariant.

  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/assessments/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = uuidParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')
      }

      const { id } = paramsResult.data
      const payload = request.jwtPayload!

      const assessment = await prisma.assessment.findUnique({ where: { id } })

      if (!assessment) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      if (!isMaster(payload) && assessment.createdBy !== payload.sub) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      const result = UpdateAssessmentRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      const data = result.data
      if (
        assessment.kind !== 'PROJECT' &&
        data.aiAssistantMode !== undefined &&
        data.aiAssistantMode !== 'DISABLED'
      ) {
        return sendError(reply, 'VALIDATION_ERROR', 'Coding assessments require AI assistant mode to be disabled')
      }

      const mutableFieldKeys: Array<keyof typeof data> = [
        'title',
        'description',
        'timeLimitMinutes',
        'language',
        'llmModel',
        'codeWeight',
        'aiuWeight',
        'aiuMetrics',
        'aiuMetricWeights',
        'allowCopyPaste',
        'aiAssistantMode',
        'scoringStrictness',
        'projectScoringCriteria',
        'scheduledStart',
        'expiresAt',
      ]
      const hasNonStatusEdits = mutableFieldKeys.some((key) => data[key] !== undefined)
      const isStatusOnlyClose = data.status === 'CLOSED' && !hasNonStatusEdits

      // Block edits if any candidate has an active or submitted session, but
      // still allow closing an active assessment from the host UI.
      const blockedCount = await prisma.session.count({
        where: { assessmentId: id, status: { in: ['ACTIVE', 'SUBMITTED'] } },
      })

      if (blockedCount > 0 && !isStatusOnlyClose) {
        return sendError(
          reply,
          'FORBIDDEN',
          'Assessment cannot be edited after candidates have started',
        )
      }

      // Re-validate weight constraints against the merged values to catch
      // partial updates that would silently violate the 100-sum invariant.
      const mergedCodeWeight = data.codeWeight ?? assessment.codeWeight
      const mergedAiuWeight = data.aiuWeight ?? assessment.aiuWeight
      if (mergedCodeWeight + mergedAiuWeight !== 100) {
        return sendError(reply, 'VALIDATION_ERROR', 'codeWeight and aiuWeight must sum to 100')
      }

      if (data.aiuMetricWeights !== undefined) {
        const sum = Object.values(data.aiuMetricWeights).reduce((a, b) => a + b, 0)
        if (sum !== 100) {
          return sendError(reply, 'VALIDATION_ERROR', 'AIU metric weights must sum to 100')
        }
      }

      const updated = await prisma.assessment.update({
        where: { id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.timeLimitMinutes !== undefined && {
            timeLimitMinutes: data.timeLimitMinutes,
          }),
          ...(data.language !== undefined && { language: data.language }),
          ...(data.llmModel !== undefined && {
            llmModel: data.llmModel,
            ...(assessment.kind === 'PROJECT' && { allowedModels: [data.llmModel] }),
          }),
          ...(data.codeWeight !== undefined && { codeWeight: data.codeWeight }),
          ...(data.aiuWeight !== undefined && { aiuWeight: data.aiuWeight }),
          ...(data.aiuMetrics !== undefined && { aiuMetrics: { set: data.aiuMetrics } }),
          ...(data.aiuMetricWeights !== undefined && {
            aiuMetricWeights: data.aiuMetricWeights,
          }),
          ...(data.allowCopyPaste !== undefined && { allowCopyPaste: data.allowCopyPaste }),
          ...(data.aiAssistantMode !== undefined && {
            aiAssistantMode: assessment.kind === 'PROJECT' ? data.aiAssistantMode : 'DISABLED',
          }),
          ...(data.scoringStrictness !== undefined && { scoringStrictness: data.scoringStrictness }),
          ...(data.projectScoringCriteria !== undefined && {
            projectScoringCriteria: data.projectScoringCriteria,
          }),
          ...(data.screenRecording !== undefined && { screenRecording: data.screenRecording }),
          ...(data.videoProctoring !== undefined && { videoProctoring: data.videoProctoring }),
          ...(data.microphoneRecording !== undefined && { microphoneRecording: data.microphoneRecording }),
          ...(data.secondCamera !== undefined && { secondCamera: data.secondCamera }),
          ...(data.scheduledStart !== undefined && {
            scheduledStart: data.scheduledStart ? new Date(data.scheduledStart) : null,
          }),
          ...(data.expiresAt !== undefined && {
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          }),
          ...(data.status !== undefined && { status: data.status }),
        },
      })

      return reply.status(200).send({ data: serializeAssessment(updated) })
    },
  )
}
