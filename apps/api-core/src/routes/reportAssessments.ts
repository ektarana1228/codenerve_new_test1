import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { sendError } from '../lib/errors'
import { generatePdf, buildBatchReportHtml, type BatchReportData } from '../lib/pdf'
import { isMaster } from '../lib/roles'
import type { RouteOptions } from '../types'

// ─── Param / query schemas ────────────────────────────────────────────────────

const assessmentIdParam = z.object({ assessment_id: z.string().uuid() })

const leaderboardQuery = z.object({
  top_x: z.coerce.number().int().min(1).max(100).default(10),
  cursor: z.string().optional(),
})

// ─── Prisma result shapes ─────────────────────────────────────────────────────
// Hand-written shapes that match the Prisma include clauses below.
// These prevent TypeScript from widening to `any` when it can't infer the result
// type from complex orderBy-on-relation expressions.

type SessionScore = {
  totalScore: number
  codeCorrectnessScore: number
  aiuTotalScore: number
  aiuScores: unknown
  projectScores: unknown
  rubricVersion: string
}

// Flattens the nested PROJECT score ({ tasks: [{ criteriaScores: [...] }] }) into
// per-criterion averages across tasks, for the leaderboard's Scoring Criteria column.
export function projectCriteriaScores(projectScores: unknown): Array<{ name: string; score: number; weight: number }> | null {
  const tasks = (projectScores as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(tasks)) return null
  const acc = new Map<string, { name: string; weightedScore: number; difficultyWeight: number; criterionWeight: number }>()
  for (const task of tasks) {
    const difficultyWeight = Number((task as { difficultyWeight?: unknown }).difficultyWeight ?? 1)
    const safeDifficultyWeight = Number.isFinite(difficultyWeight) && difficultyWeight > 0 ? difficultyWeight : 1
    const criteria = (task as { criteriaScores?: unknown }).criteriaScores
    if (!Array.isArray(criteria)) continue
    for (const c of criteria) {
      const key = String((c as { key?: unknown }).key ?? '')
      const name = String((c as { name?: unknown }).name ?? key)
      const score = Number((c as { score?: unknown }).score)
      const weight = Number((c as { weight?: unknown }).weight)
      if (!key || !Number.isFinite(score)) continue
      const cur = acc.get(key) ?? { name, weightedScore: 0, difficultyWeight: 0, criterionWeight: Number.isFinite(weight) ? weight : 0 }
      cur.weightedScore += score * safeDifficultyWeight
      cur.difficultyWeight += safeDifficultyWeight
      if (Number.isFinite(weight)) cur.criterionWeight = weight
      acc.set(key, cur)
    }
  }
  if (acc.size === 0) return null
  return [...acc.values()].map((v) => ({
    name: v.name,
    score: Math.round((v.weightedScore / Math.max(v.difficultyWeight, 1)) * 100) / 100,
    weight: v.criterionWeight,
  }))
}

type LeaderboardRow = {
  id: string
  assessmentId: string
  candidateName: string | null
  language: string
  startedAt: Date | null
  submittedAt: Date | null
  score: SessionScore | null
  feedback?: {
    overallExperience: number
    instructionsClarity: number
    difficultyRelevance: number
    platformUsability: number
    technicalPerformance: number
    codingEnvironment: number
    aiAssistantUsefulness: number
    proctoringExperience: number
    fairness: number
    recommendationScore: number
  } | null
  candidate: { email: string }
}

type BatchRow = LeaderboardRow & {
  _count: { logs: number }
  aiAssistantMode: string
}

// ─── Cursor codec ─────────────────────────────────────────────────────────────
// Cursor encodes the full composite sort key so we can resume a sorted query
// without offset arithmetic (satisfies NFR-08: cursor-based pagination).

type LeaderboardCursor = {
  totalScore: number
  secondaryScore: number
  submittedAt: string | null
  sessionId: string
  nextRank: number
}

function encodeCursor(c: LeaderboardCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

function feedbackAverage(feedback: NonNullable<LeaderboardRow['feedback']>): number {
  const values = [
    feedback.overallExperience,
    feedback.instructionsClarity,
    feedback.difficultyRelevance,
    feedback.platformUsability,
    feedback.technicalPerformance,
    feedback.codingEnvironment,
    feedback.aiAssistantUsefulness,
    feedback.proctoringExperience,
    feedback.fairness,
  ]
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

async function fetchAssessmentFeedbackSummary(assessmentId: string) {
  const rows = await prisma.$queryRaw<Array<{
    responses: bigint
    averageRating: number | null
  }>>`
    SELECT
      COUNT(*)::bigint AS "responses",
      AVG((
        "overallExperience" + "instructionsClarity" + "difficultyRelevance" +
        "platformUsability" + "technicalPerformance" + "codingEnvironment" +
        "aiAssistantUsefulness" + "proctoringExperience" + "fairness"
      ) / 9.0) AS "averageRating"
    FROM "SessionFeedback" f
    JOIN "Session" s ON s."id" = f."sessionId"
    WHERE s."assessmentId" = ${assessmentId}
  `
  const row = rows[0]
  return {
    responses: Number(row?.responses ?? 0),
    average_rating: row?.averageRating == null ? null : Math.round(Number(row.averageRating) * 10) / 10,
  }
}

function decodeCursor(raw: string): LeaderboardCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      typeof obj.totalScore !== 'number'
      || typeof obj.secondaryScore !== 'number'
      || typeof obj.sessionId !== 'string'
      || typeof obj.nextRank !== 'number'
    ) {
      return null
    }
    return obj as LeaderboardCursor
  } catch {
    return null
  }
}

// ─── Candidate name resolution ────────────────────────────────────────────────

async function resolveCandidateName(session: {
  id: string
  assessmentId: string
  candidateName: string | null
  candidate: { email: string }
}): Promise<string> {
  if (session.candidateName) return session.candidateName

  const { email } = session.candidate

  const generatedMatch = /^candidate-([0-9a-f-]{36})(?:-[0-9a-f-]{36})?@noemail\.candidate$/.exec(email)
  if (generatedMatch) {
    const tokenId = generatedMatch[1]!
    const inviteToken = await prisma.inviteToken.findUnique({
      where: { id: tokenId },
      select: { candidateName: true },
    })
    return inviteToken?.candidateName ?? email
  }

  const inviteToken = await prisma.inviteToken.findFirst({
    where: { assessmentId: session.assessmentId, candidateEmail: email },
    select: { candidateName: true },
  })
  return inviteToken?.candidateName ?? email
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function assessmentReportRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  // ── GET /api/v1/reports/assessments/:assessment_id/leaderboard ────────────────
  // Returns scored sessions for an assessment ranked by total score.
  // Tie-break: higher project score for PROJECT assessments or technical evaluation
  // for CODING assessments; then earlier submittedAt.
  // Query param: top_x (default 10, max 100). Cursor-paginated.

  fastify.get<{
    Params: { assessment_id: string }
    Querystring: { top_x?: string; cursor?: string }
  }>(
    '/api/v1/reports/assessments/:assessment_id/leaderboard',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = assessmentIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'assessment_id must be a valid UUID')
      }

      const queryResult = leaderboardQuery.safeParse(request.query)
      if (!queryResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid query parameters')
      }

      const { assessment_id } = paramsResult.data
      const { top_x, cursor: rawCursor } = queryResult.data
      const payload = request.jwtPayload!

      const assessment = await prisma.assessment.findUnique({
        where: { id: assessment_id },
        select: { createdBy: true, kind: true },
      })

      if (!assessment) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }
      if (!isMaster(payload) && assessment.createdBy !== payload.sub) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      // Parse cursor if provided
      let cursorObj: LeaderboardCursor | null = null
      if (rawCursor) {
        cursorObj = decodeCursor(rawCursor)
        if (!cursorObj) {
          return sendError(reply, 'VALIDATION_ERROR', 'Invalid cursor')
        }
      }

      const startRank = cursorObj?.nextRank ?? 1

      // Build cursor WHERE clause for composite sort continuation.
      const secondaryScoreField = assessment.kind === 'PROJECT' ? 'codeCorrectnessScore' : 'aiuTotalScore'

      // Sort order is: totalScore DESC, secondary score DESC, submittedAt ASC, id ASC.
      // A row is "after the cursor" if its composite sort key comes later in this ordering.
      const cursorWhere = cursorObj
        ? {
            OR: [
              { score: { totalScore: { lt: cursorObj.totalScore } } },
              {
                score: {
                  totalScore: cursorObj.totalScore,
                  [secondaryScoreField]: { lt: cursorObj.secondaryScore },
                },
              },
              {
                score: {
                  totalScore: cursorObj.totalScore,
                  [secondaryScoreField]: cursorObj.secondaryScore,
                },
                submittedAt: cursorObj.submittedAt
                  ? { gt: new Date(cursorObj.submittedAt) }
                  : { not: null },
              },
              {
                score: {
                  totalScore: cursorObj.totalScore,
                  [secondaryScoreField]: cursorObj.secondaryScore,
                },
                submittedAt: cursorObj.submittedAt ? new Date(cursorObj.submittedAt) : null,
                id: { gt: cursorObj.sessionId },
              },
            ],
          }
        : {}

      const rows = await prisma.session.findMany({
        where: {
          assessmentId: assessment_id,
          status: 'SUBMITTED',
          score: { isNot: null },
          ...cursorWhere,
        },
        include: {
          score: true,
          candidate: { select: { email: true } },
        },
        orderBy: [
          { score: { totalScore: 'desc' } },
          { score: { [secondaryScoreField]: 'desc' } },
          { submittedAt: 'asc' },
          { id: 'asc' },
        ],
        take: top_x + 1,
      }) as LeaderboardRow[]

      const hasMore = rows.length > top_x
      const page = hasMore ? rows.slice(0, top_x) : rows

      // Resolve candidate names in parallel
      const candidateNames = await Promise.all(
        page.map((s) =>
          resolveCandidateName({ id: s.id, assessmentId: s.assessmentId, candidateName: s.candidateName, candidate: s.candidate }),
        ),
      )

      const data = page.map((s, i) => ({
        rank: startRank + i,
        session_id: s.id,
        candidate_name: candidateNames[i]!,
        candidate_email: s.candidate.email.endsWith('@noemail.candidate') ? null : s.candidate.email,
        total_score: s.score!.totalScore,
        code_correctness_score: s.score!.codeCorrectnessScore,
        aiu_total_score: s.score!.aiuTotalScore,
        rubric_version: s.score!.rubricVersion,
        // PROJECT-kind: per-criterion breakdown for the Scoring Criteria column. Null for CODING.
        project_criteria: assessment.kind === 'PROJECT' ? projectCriteriaScores(s.score!.projectScores) : null,
        submitted_at: s.submittedAt?.toISOString() ?? null,
      }))

      let nextCursor: string | null = null
      if (hasMore) {
        const last = page[page.length - 1]!
        nextCursor = encodeCursor({
          totalScore: last.score!.totalScore,
          secondaryScore: assessment.kind === 'PROJECT' ? last.score!.codeCorrectnessScore : last.score!.aiuTotalScore,
          submittedAt: last.submittedAt?.toISOString() ?? null,
          sessionId: last.id,
          nextRank: startRank + top_x,
        })
      }

      const feedbackSummary = await fetchAssessmentFeedbackSummary(assessment_id)
      const rubricVersions = [...new Set(page.map((s) => s.score!.rubricVersion ?? 'LEGACY'))]
      return reply.status(200).send({
        data,
        next_cursor: nextCursor,
        feedback_summary: feedbackSummary,
        rubric_versions: rubricVersions,
        mixed_rubric_versions: rubricVersions.length > 1,
      })
    },
  )

  // ── GET /api/v1/reports/assessments/:assessment_id/batch/pdf ─────────────────
  // Generates a batch PDF: assessment summary page + one page per candidate.
  // Includes all scored sessions in leaderboard order.

  fastify.get<{ Params: { assessment_id: string } }>(
    '/api/v1/reports/assessments/:assessment_id/batch/pdf',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = assessmentIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'assessment_id must be a valid UUID')
      }

      const { assessment_id } = paramsResult.data
      const payload = request.jwtPayload!

      const assessment = await prisma.assessment.findUnique({
        where: { id: assessment_id },
        select: {
          title: true,
          createdBy: true,
          language: true,
          timeLimitMinutes: true,
          codeWeight: true,
          aiuWeight: true,
          llmModel: true,
          kind: true,
        },
      })

      if (!assessment) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }
      if (!isMaster(payload) && assessment.createdBy !== payload.sub) {
        return sendError(reply, 'NOT_FOUND', 'Assessment not found')
      }

      // Fetch all scored, submitted sessions in leaderboard order
      const sessions = await prisma.session.findMany({
        where: {
          assessmentId: assessment_id,
          status: 'SUBMITTED',
          score: { isNot: null },
        },
        include: {
          score: true,
          candidate: { select: { email: true } },
          _count: { select: { logs: true } },
        },
        orderBy: [
          { score: { totalScore: 'desc' } },
          { score: { [assessment.kind === 'PROJECT' ? 'codeCorrectnessScore' : 'aiuTotalScore']: 'desc' } },
          { submittedAt: 'asc' },
          { id: 'asc' },
        ],
      }) as BatchRow[]

      // Resolve all candidate names in parallel
      const candidateNames = await Promise.all(
        sessions.map((s) =>
          resolveCandidateName({ id: s.id, assessmentId: s.assessmentId, candidateName: s.candidateName, candidate: s.candidate }),
        ),
      )

      const candidates: BatchReportData['candidates'] = sessions.map((s, i) => {
        const timeTakenSeconds =
          s.startedAt && s.submittedAt
            ? Math.floor((s.submittedAt.getTime() - s.startedAt.getTime()) / 1000)
            : null

        return {
          rank: i + 1,
          candidateName: candidateNames[i]!,
          totalScore: s.score!.totalScore,
          codeCorrectnessScore: s.score!.codeCorrectnessScore,
          aiuTotalScore: s.score!.aiuTotalScore,
          aiuScores: s.score!.aiuScores as Record<string, number>,
          rubricVersion: s.score!.rubricVersion ?? 'LEGACY',
          language: s.language,
          timeTakenSeconds,
          turnCount: s._count.logs,
          submittedAt: s.submittedAt?.toISOString() ?? null,
          // Session snapshot, so each row states the conditions that candidate
          // was actually evaluated under.
          aiAssistantMode: s.aiAssistantMode,
        }
      })

      const batchData: BatchReportData = {
        assessmentTitle: assessment.title,
        language: assessment.language,
        timeLimitMinutes: assessment.timeLimitMinutes,
        codeWeight: assessment.codeWeight,
        aiuWeight: assessment.aiuWeight,
        llmModel: assessment.llmModel,
        generatedAt: new Date().toISOString(),
        rubricVersions: [...new Set(sessions.map((s) => s.score!.rubricVersion ?? 'LEGACY'))],
        kind: assessment.kind,
        candidates,
      }

      const html = buildBatchReportHtml(batchData)
      const pdf = await generatePdf(html)

      const safeTitle = assessment.title.replace(/[^a-zA-Z0-9_-]/g, '_')

      return reply
        .status(200)
        .header('Cache-Control', 'no-store, no-cache, must-revalidate')
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="batch-report-${safeTitle}.pdf"`)
        .send(pdf)
    },
  )
}
