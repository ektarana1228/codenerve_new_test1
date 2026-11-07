import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { sendError } from '../lib/errors'
import {
  generatePdf,
  buildCandidateReportHtml,
  type CandidateReportData,
} from '../lib/pdf'
import { isMaster } from '../lib/roles'
import { projectCriteriaScores } from './reportAssessments'
import type { RouteOptions } from '../types'

// ─── Param schema ─────────────────────────────────────────────────────────────

const sessionIdParam = z.object({ session_id: z.string().uuid() })

const TECHNICAL_KEYS = ['correctness', 'efficiency', 'robustness', 'code_quality'] as const

function disabledTechnicalScores(aiuScores: unknown, scoreEvidence: unknown): Record<string, number> {
  const stored = aiuScores && typeof aiuScores === 'object' && !Array.isArray(aiuScores)
    ? aiuScores as Record<string, unknown>
    : {}
  if (TECHNICAL_KEYS.every((key) => Number.isFinite(Number(stored[key])))) {
    return Object.fromEntries(TECHNICAL_KEYS.map((key) => [key, Number(stored[key])]))
  }

  const evidence = scoreEvidence && typeof scoreEvidence === 'object' && !Array.isArray(scoreEvidence)
    ? scoreEvidence as Record<string, unknown>
    : {}
  const coding = evidence.coding_test_evidence && typeof evidence.coding_test_evidence === 'object'
    ? evidence.coding_test_evidence as Record<string, unknown>
    : {}
  const problems = Array.isArray(coding.problems) ? coding.problems : []
  const categories = problems.map((problem) => {
    if (!problem || typeof problem !== 'object' || Array.isArray(problem)) return null
    const value = (problem as Record<string, unknown>).category_scores
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  }).filter((value): value is Record<string, unknown> => value !== null)

  return Object.fromEntries(TECHNICAL_KEYS.map((key) => {
    const values = categories.map((category) => Number(category[key])).filter(Number.isFinite)
    const score = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    return [key, Math.round(score * 100) / 100]
  }))
}

type ProjectEvaluation = {
  tasks: Array<{
    task_id: string
    difficulty: string
    base_score: number
    final_score: number
    criteria: Array<{ name: string; score: number; weight: number }>
    rationale: string
    evidence_references: string[]
    missing_requirements: string[]
    applied_caps: Array<{ reason: string; cap: number }>
  }>
  assistant_evidence_state: string
  manual_review_required: boolean
  manual_review_reasons: string[]
}

function feedbackAverage(feedback: {
  overallExperience: number
  instructionsClarity: number
  difficultyRelevance: number
  platformUsability: number
  technicalPerformance: number
  codingEnvironment: number
  aiAssistantUsefulness: number
  proctoringExperience: number
  fairness: number
}): number {
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
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

function serializeFeedback(feedback: null | {
  overallExperience: number
  instructionsClarity: number
  difficultyRelevance: number
  platformUsability: number
  technicalPerformance: number
  codingEnvironment: number
  aiAssistantUsefulness: number
  aiAssistantUsage: string | null
  proctoringExperience: number
  fairness: number
  assessmentName: string | null
  taskWhereIssueOccurred: string | null
  technicalIssueType: string | null
  mayContact: boolean
  comments: string | null
  submittedAt: Date
}) {
  if (!feedback) return null
  return {
    average_rating: feedbackAverage(feedback),
    overall_experience: feedback.overallExperience,
    instructions_clarity: feedback.instructionsClarity,
    difficulty_relevance: feedback.difficultyRelevance,
    platform_usability: feedback.platformUsability,
    technical_performance: feedback.technicalPerformance,
    coding_environment: feedback.codingEnvironment,
    ai_assistant_usefulness: feedback.aiAssistantUsefulness,
    ai_assistant_usage: feedback.aiAssistantUsage,
    proctoring_experience: feedback.proctoringExperience,
    fairness: feedback.fairness,
    assessment_name: feedback.assessmentName,
    task_where_issue_occurred: feedback.taskWhereIssueOccurred,
    technical_issue_type: feedback.technicalIssueType,
    may_contact: feedback.mayContact,
    comments: feedback.comments,
    submitted_at: feedback.submittedAt.toISOString(),
  }
}

async function fetchSessionFeedback(sessionId: string) {
  const rows = await prisma.$queryRaw<Array<{
    overallExperience: number
    instructionsClarity: number
    difficultyRelevance: number
    platformUsability: number
    technicalPerformance: number
    codingEnvironment: number
    aiAssistantUsefulness: number
    aiAssistantUsage: string | null
    proctoringExperience: number
    fairness: number
    assessmentName: string | null
    taskWhereIssueOccurred: string | null
    technicalIssueType: string | null
    mayContact: boolean
    comments: string | null
    submittedAt: Date
  }>>`
    SELECT
      "overallExperience", "instructionsClarity", "difficultyRelevance", "platformUsability",
      "technicalPerformance", "codingEnvironment", "aiAssistantUsefulness", "aiAssistantUsage",
      "proctoringExperience", "fairness", "assessmentName",
      "taskWhereIssueOccurred", "technicalIssueType", "mayContact", "comments", "submittedAt"
    FROM "SessionFeedback"
    WHERE "sessionId" = ${sessionId}
    LIMIT 1
  `
  return serializeFeedback(rows[0] ?? null)
}

function projectEvaluation(projectScores: unknown): ProjectEvaluation | null {
  if (!projectScores || typeof projectScores !== 'object') return null
  const raw = projectScores as { tasks?: unknown; evidence?: unknown }
  if (!Array.isArray(raw.tasks)) return null
  const evidence = raw.evidence && typeof raw.evidence === 'object'
    ? raw.evidence as { prechecks?: { assistantEvidenceState?: unknown } }
    : null
  const tasks = raw.tasks.map((value) => {
    const task = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const criteria = Array.isArray(task.criteriaScores) ? task.criteriaScores : []
    const caps = Array.isArray(task.appliedCaps) ? task.appliedCaps : []
    return {
      task_id: String(task.taskId ?? ''),
      difficulty: String(task.difficulty ?? 'EASY'),
      base_score: Number(task.baseScore ?? 0),
      final_score: Number(task.finalScore ?? task.weightedTotal ?? 0),
      criteria: criteria.map((item) => {
        const criterion = item as Record<string, unknown>
        return { name: String(criterion.name ?? criterion.key ?? ''), score: Number(criterion.score ?? 0), weight: Number(criterion.weight ?? 0) }
      }),
      rationale: String(task.rationale ?? ''),
      evidence_references: Array.isArray(task.evidenceReferences) ? task.evidenceReferences.map(String) : [],
      missing_requirements: Array.isArray(task.missingRequirements) ? task.missingRequirements.map(String) : [],
      applied_caps: caps.map((item) => {
        const cap = item as Record<string, unknown>
        return { reason: String(cap.reason ?? ''), cap: Number(cap.cap ?? 0) }
      }),
    }
  })
  const assistantEvidenceState = String(evidence?.prechecks?.assistantEvidenceState ?? 'UNKNOWN')
  const reviewReasons = new Set<string>()
  if (assistantEvidenceState === 'PLATFORM_UNAVAILABLE') reviewReasons.add('Candidate AI assistant had a recorded platform outage')
  for (const task of tasks) {
    if (task.missing_requirements.length > 0) reviewReasons.add('One or more task requirements were reported missing')
    if (task.applied_caps.some((cap) => cap.cap <= 40)) reviewReasons.add('A severe deterministic score cap was applied')
  }
  return {
    tasks,
    assistant_evidence_state: assistantEvidenceState,
    manual_review_required: reviewReasons.size > 0,
    manual_review_reasons: [...reviewReasons],
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCandidateName(session: {
  candidateName?: string | null
  assessmentId: string
  candidate: { email: string }
}): Promise<string> {
  if (session.candidateName) return session.candidateName

  const { email } = session.candidate

  // Email generated from invite token:
  // candidate-{token_uuid}@noemail.candidate
  // or candidate-{token_uuid}-{session_uuid}@noemail.candidate
  const generatedMatch = /^candidate-([0-9a-f-]{36})(?:-[0-9a-f-]{36})?@noemail\.candidate$/.exec(email)
  if (generatedMatch) {
    const tokenId = generatedMatch[1]!
    const inviteToken = await prisma.inviteToken.findUnique({
      where: { id: tokenId },
      select: { candidateName: true },
    })
    return inviteToken?.candidateName ?? email
  }

  // Real email - find the invite token by assessment + email
  const inviteToken = await prisma.inviteToken.findFirst({
    where: { assessmentId: session.assessmentId, candidateEmail: email },
    select: { candidateName: true },
  })
  return inviteToken?.candidateName ?? email
}

async function fetchReportData(sessionId: string, adminId: string, master = false) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      candidate: { select: { email: true } },
      assessment: {
        select: {
          title: true,
          createdBy: true,
          kind: true,
          codeWeight: true,
          aiuWeight: true,
          aiuMetricWeights: true,
          timeLimitMinutes: true,
          language: true,
          llmModel: true,
        },
      },
      score: true,
      _count: { select: { logs: true } },
    },
  })

  if (!session) return { error: 'NOT_FOUND' as const, data: null }
  if (!master && session.assessment.createdBy !== adminId) return { error: 'NOT_FOUND' as const, data: null }
  if (!session.score) return { error: 'SCORE_MISSING' as const, data: null }
  const candidateName = await resolveCandidateName({
    candidateName: session.candidateName,
    assessmentId: session.assessmentId,
    candidate: session.candidate,
  })

  const timeTakenSeconds =
    session.startedAt && session.submittedAt
      ? Math.floor((session.submittedAt.getTime() - session.startedAt.getTime()) / 1000)
      : null

  const feedback = await fetchSessionFeedback(session.id)

  const normalizedAiuScores = session.aiAssistantMode === 'DISABLED'
    ? disabledTechnicalScores(session.score.aiuScores, session.score.scoreEvidence)
    : session.score.aiuScores as Record<string, number>
  const normalizedAiuTotal = session.score.aiuTotalScore

  const reportData: CandidateReportData = {
    candidateName,
    assessmentTitle: session.assessment.title,
    language: session.language,
    totalScore: session.score.totalScore,
    codeCorrectnessScore: session.score.codeCorrectnessScore,
    aiuScores: normalizedAiuScores,
    aiuTotalScore: normalizedAiuTotal,
    timeTakenSeconds,
    turnCount: session._count.logs,
    submittedAt: session.submittedAt?.toISOString() ?? null,
    generatedAt: new Date().toISOString(),
    // Read from the session snapshot, not the live assessment - the report must
    // state the conditions this attempt actually ran under, even if the
    // assessment's mode was changed afterwards.
    aiAssistantMode: session.aiAssistantMode,
    kind: session.assessment.kind,
    codeWeight: session.assessment.codeWeight,
    aiuWeight: session.assessment.aiuWeight,
    aiuMetricWeights: session.assessment.aiuMetricWeights as Record<string, number>,
    scoreEvidence: session.score.scoreEvidence,
    projectScores: session.score.projectScores,
    feedback,
  }

  return {
    error: null,
    data: {
      reportData,
      candidateName,
      sessionId: session.id,
      candidateEmail: session.candidate.email.endsWith('@noemail.candidate') ? null : session.candidate.email,
      startedAt: session.startedAt?.toISOString() ?? null,
      aiuWeights: session.assessment.aiuMetricWeights as Record<string, number>,
      kind: session.assessment.kind,
      projectScores: session.score.projectScores,
      rubricVersion: session.score.rubricVersion,
      feedback,
    },
  }
}

async function fetchSubmission(sessionId: string, adminId: string, master = false) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      assessmentId: true,
      candidateName: true,
      currentCode: true,
      candidate: { select: { email: true } },
      assessment: { select: { createdBy: true } },
    },
  })

  if (!session) return { error: 'NOT_FOUND' as const, data: null }
  if (!master && session.assessment.createdBy !== adminId) return { error: 'NOT_FOUND' as const, data: null }

  const candidateName = await resolveCandidateName({
    candidateName: session.candidateName,
    assessmentId: session.assessmentId,
    candidate: session.candidate,
  })
  return { error: null, data: { candidateName, code: session.currentCode } }
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function sessionReportRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { requireAdmin } = opts.authHooks

  // ── GET /api/v1/reports/sessions/:session_id ─────────────────────────────────
  // Returns a full candidate report as JSON. 404 if session not scored yet.

  fastify.get<{ Params: { session_id: string } }>(
    '/api/v1/reports/sessions/:session_id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'session_id must be a valid UUID')
      }

      const { session_id } = paramsResult.data
      const payload = request.jwtPayload!

      const { error, data } = await fetchReportData(session_id, payload.sub, isMaster(payload))

      if (error === 'NOT_FOUND') {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }
      if (error === 'SCORE_MISSING') {
        return sendError(reply, 'NOT_FOUND', 'Session has not been scored yet')
      }

      const { reportData, sessionId, candidateEmail, startedAt, aiuWeights, kind, projectScores, rubricVersion, feedback } = data!
      const aiuScores = reportData.aiuScores as Record<string, number>

      return reply.status(200).send({
        data: {
          session_id: sessionId,
          candidate_name: reportData.candidateName,
          candidate_email: candidateEmail,
          assessment_title: reportData.assessmentTitle,
          kind,
          language: reportData.language,
          total_score: reportData.totalScore,
          code_correctness_score: reportData.codeCorrectnessScore,
          hidden_tests_passed: null,
          hidden_tests_total: null,
          aiu_scores: Object.entries(aiuScores).map(([metric, score]) => ({
            metric,
            score,
            weight: reportData.aiAssistantMode === 'DISABLED' ? 25 : (aiuWeights[metric] ?? 0),
          })),
          aiu_total_score: reportData.aiuTotalScore,
          rubric_version: rubricVersion,
          // PROJECT-kind: per-criterion breakdown for the detail panel. Null for CODING.
          project_scores: kind === 'PROJECT' ? projectCriteriaScores(projectScores) : null,
          project_evaluation: kind === 'PROJECT' ? projectEvaluation(projectScores) : null,
          feedback,
          time_taken_seconds: reportData.timeTakenSeconds,
          interaction_count: reportData.turnCount,
          ai_assistant_mode: reportData.aiAssistantMode,
          started_at: startedAt,
          submitted_at: reportData.submittedAt,
        },
      })
    },
  )

  // ── GET /api/v1/reports/sessions/:session_id/pdf ──────────────────────────────
  // Renders an individual candidate PDF report via Puppeteer.

  fastify.get<{ Params: { session_id: string } }>(
    '/api/v1/reports/sessions/:session_id/interactions',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) return sendError(reply, 'VALIDATION_ERROR', 'session_id must be a valid UUID')

      const payload = request.jwtPayload!
      const session = await prisma.session.findUnique({
        where: { id: paramsResult.data.session_id },
        select: { assessment: { select: { createdBy: true } } },
      })
      if (!session || (!isMaster(payload) && session.assessment.createdBy !== payload.sub)) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      const interactions = await prisma.interactionLog.findMany({
        where: { sessionId: paramsResult.data.session_id },
        orderBy: [{ turnNumber: 'asc' }, { timestamp: 'asc' }],
      })
      return reply.send({ data: interactions.map((item) => ({
        turn_number: item.turnNumber,
        prompt_text: item.promptText,
        response_text: item.responseText,
        timestamp: item.timestamp.toISOString(),
      })) })
    },
  )

  fastify.get<{ Params: { session_id: string } }>(
    '/api/v1/reports/sessions/:session_id/pdf',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'session_id must be a valid UUID')
      }

      const { session_id } = paramsResult.data
      const payload = request.jwtPayload!

      const { error, data } = await fetchReportData(session_id, payload.sub, isMaster(payload))

      if (error === 'NOT_FOUND') {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }
      if (error === 'SCORE_MISSING') {
        return sendError(reply, 'NOT_FOUND', 'Session has not been scored yet')
      }

      const { reportData, candidateName } = data!

      const html = buildCandidateReportHtml(reportData)
      const pdf = await generatePdf(html)

      const safeName = candidateName.replace(/[^a-zA-Z0-9_-]/g, '_')

      return reply
        .status(200)
        .header('Cache-Control', 'no-store, no-cache, must-revalidate')
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="report-${safeName}.pdf"`)
        .send(pdf)
    },
  )

  fastify.get<{ Params: { session_id: string } }>(
    '/api/v1/reports/sessions/:session_id/submission',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const paramsResult = sessionIdParam.safeParse(request.params)
      if (!paramsResult.success) return sendError(reply, 'VALIDATION_ERROR', 'session_id must be a valid UUID')

      const payload = request.jwtPayload!
      const { error, data } = await fetchSubmission(paramsResult.data.session_id, payload.sub, isMaster(payload))
      if (error === 'NOT_FOUND') return sendError(reply, 'NOT_FOUND', 'Session not found')

      const safeName = data!.candidateName.replace(/[^a-zA-Z0-9_-]/g, '_')
      const isJson = data!.code.trim().startsWith('{')
      return reply
        .status(200)
        .header('Content-Type', isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="submission-${safeName}.${isJson ? 'json' : 'txt'}"`)
        .send(data!.code)
    },
  )
}
