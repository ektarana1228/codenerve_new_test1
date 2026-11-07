import { prisma, Prisma } from '@platform/db'
import { AIU_METRIC_KEYS, type AiuMetricKey, type Difficulty } from '@platform/types'
import {
  scoreContextualRelevance,
  scoreIndependentEditing,
  scoreIterationEfficiency,
  scorePromptQualityByProblem,
} from './scorers'
import { scoreProject } from './projectScorer'

export type ScoreJobData = {
  session_id: string
}

// Only required when scoring a PROJECT-kind session (the LLM-judge call).
// Kept as an explicit param rather than reading env at module scope so this
// module stays free of config-parsing side effects (and importable in tests
// that never exercise the PROJECT path).
export type ScoreJobConfig = {
  gatewayUrl: string
  jwtSecret: string
}

type AiuScores = Record<AiuMetricKey, number>

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeWeightKey(key: string): AiuMetricKey | undefined {
  const normalized = key.trim().toUpperCase()
  if (normalized in AIU_METRIC_KEYS) {
    return AIU_METRIC_KEYS[normalized as keyof typeof AIU_METRIC_KEYS]
  }

  const snakeCase = key.trim().toLowerCase()
  return Object.values(AIU_METRIC_KEYS).find((metricKey) => metricKey === snakeCase)
}

function parseMetricWeights(value: unknown): Partial<Record<AiuMetricKey, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const weights: Partial<Record<AiuMetricKey, number>> = {}

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const metricKey = normalizeWeightKey(rawKey)
    if (!metricKey || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      continue
    }
    weights[metricKey] = rawValue
  }

  return weights
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function processScoreJob(data: ScoreJobData, config?: ScoreJobConfig) {
  const session = await prisma.session.findUnique({
    where: { id: data.session_id },
    include: {
      logs: {
        orderBy: { turnNumber: 'asc' },
      },
      runEvents: {
        orderBy: { createdAt: 'asc' },
      },
      proctorEvents: {
        where: { eventType: 'AI_ASSISTANT_UNAVAILABLE' },
        select: { id: true },
      },
      score: true,
      assessment: {
        include: {
          problems: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, difficulty: true, description: true },
          },
          tasks: {
            orderBy: { order: 'asc' },
            select: { id: true, title: true, description: true, doneWhen: true, difficulty: true, bugBankId: true },
          },
        },
      },
    },
  })

  if (!session || !session.score) {
    throw new Error(`Session ${data.session_id} is missing its score record`)
  }

  const isProject = session.assessment.kind === 'PROJECT'

  let codeCorrectnessScore: number
  let totalScore: number
  let difficulty: Difficulty
  let projectScores: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull

  if (isProject) {
    const tasks = session.assessment.tasks
    if (tasks.length === 0) {
      throw new Error(`Session ${data.session_id} has no assessment task configured`)
    }
    if (!config) {
      throw new Error('processScoreJob requires gatewayUrl/jwtSecret config to score a PROJECT session')
    }
    const result = await scoreProject({
      gatewayUrl: config.gatewayUrl,
      jwtSecret: config.jwtSecret,
      model: session.assessment.llmModel,
      tasks,
      currentCode: session.currentCode,
      referenceFilesRaw: session.assessment.referenceFiles,
      solutionFilesRaw: session.assessment.solutionFiles,
      submissionFilesRaw: session.assessment.submissionFiles,
      projectScoringCriteriaRaw: session.assessment.projectScoringCriteria,
      scoringStrictness: session.scoringStrictness,
      interactions: session.logs,
      runEvents: session.runEvents,
      assistantUnavailableCount: session.proctorEvents.length,
    })
    codeCorrectnessScore = result.codeCorrectnessScore
    projectScores = result.projectScores
    totalScore = codeCorrectnessScore
    difficulty = tasks[0]?.difficulty ?? 'MEDIUM'
  } else {
    const primaryProblem = session.assessment.problems[0]
    if (!primaryProblem) {
      throw new Error(`Session ${data.session_id} has no assessment problem configured`)
    }
    codeCorrectnessScore = session.score.codeCorrectnessScore
    totalScore = codeCorrectnessScore
    difficulty = primaryProblem.difficulty
  }

  let aiuScores: AiuScores = {
    [AIU_METRIC_KEYS.PROMPT_QUALITY]: 0,
    [AIU_METRIC_KEYS.ITERATION_EFFICIENCY]: 0,
    [AIU_METRIC_KEYS.INDEPENDENT_EDITING]: 0,
    [AIU_METRIC_KEYS.CONTEXTUAL_RELEVANCE]: 0,
  }
  let aiuTotalScore = 0
  const existingScoreEvidence = jsonRecord(session.score.scoreEvidence)
  let scoreEvidence: Prisma.InputJsonValue = {
    ...existingScoreEvidence,
    rubric_version: session.score.rubricVersion ?? 'LEGACY',
    scoring_strictness: session.scoringStrictness ?? 'MEDIUM',
    assistant_mode: session.aiAssistantMode,
    aiu_evidence_state: isProject ? 'NOT_APPLICABLE' : 'NO_AI_USED',
    enabled_aiu_metrics: [],
  }

  if (!isProject) {
    if (session.aiAssistantMode === 'DISABLED') {
      const technicalScores = jsonRecord(session.score.aiuScores)
      aiuScores = technicalScores as AiuScores
      aiuTotalScore = session.score.aiuTotalScore
      totalScore = aiuTotalScore
      scoreEvidence = {
        ...existingScoreEvidence,
        rubric_version: session.score.rubricVersion ?? 'DISABLED_TECHNICAL_V1',
        scoring_strictness: session.scoringStrictness ?? 'MEDIUM',
        assistant_mode: 'DISABLED',
        aiu_evidence_state: 'TECHNICAL_EVALUATION',
        enabled_aiu_metrics: ['correctness', 'efficiency', 'robustness', 'code_quality'],
      }
    } else {
    const logs = session.logs
    const [promptQuality, iterationEfficiency, independentEditing, contextualRelevance] =
      await Promise.all([
        Promise.resolve(scorePromptQualityByProblem(
          logs,
          session.assessment.problems.map((problem) => problem.description),
          session.aiAssistantMode,
          session.scoringStrictness as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH',
        )),
        Promise.resolve(scoreIterationEfficiency(
          logs,
          session.runEvents,
          session.assessment.problems,
          session.aiAssistantMode,
          session.scoringStrictness as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH',
        )),
        Promise.resolve(scoreIndependentEditing(
          logs,
          session.currentCode,
          session.aiAssistantMode,
          session.scoringStrictness as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH',
        )),
        Promise.resolve(scoreContextualRelevance(
          logs,
          session.assessment.problems,
          session.runEvents,
          session.aiAssistantMode,
          session.scoringStrictness as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH',
        )),
      ])

    aiuScores = {
      [AIU_METRIC_KEYS.PROMPT_QUALITY]: promptQuality,
      [AIU_METRIC_KEYS.ITERATION_EFFICIENCY]: iterationEfficiency,
      [AIU_METRIC_KEYS.INDEPENDENT_EDITING]: independentEditing,
      [AIU_METRIC_KEYS.CONTEXTUAL_RELEVANCE]: contextualRelevance,
    }

    const configuredMetrics = Array.isArray(session.assessment.aiuMetrics)
      ? session.assessment.aiuMetrics.map((metric) => normalizeWeightKey(metric)).filter((metric): metric is AiuMetricKey => metric !== undefined)
      : []
    const enabledMetrics = configuredMetrics.length > 0
      ? [...new Set(configuredMetrics)]
      : Object.values(AIU_METRIC_KEYS)
    const hasAiUsage = logs.length > 0
    scoreEvidence = {
      ...existingScoreEvidence,
      rubric_version: session.score.rubricVersion ?? 'LEGACY',
      scoring_strictness: session.scoringStrictness ?? 'MEDIUM',
      assistant_mode: session.aiAssistantMode,
      aiu_evidence_state: hasAiUsage ? 'SCORED' : 'NO_AI_USED',
      enabled_aiu_metrics: enabledMetrics,
    }

    if (hasAiUsage) {
      const weights = parseMetricWeights(session.assessment.aiuMetricWeights)
      const activeWeight = enabledMetrics.reduce((sum, metric) => sum + Math.max(0, weights[metric] ?? 0), 0)
      aiuTotalScore = roundToTwo(activeWeight > 0
        ? enabledMetrics.reduce((total, metric) => total + aiuScores[metric] * ((weights[metric] ?? 0) / activeWeight), 0)
        : enabledMetrics.reduce((total, metric) => total + aiuScores[metric], 0) / enabledMetrics.length)
      const totalConfiguredWeight = session.assessment.codeWeight + session.assessment.aiuWeight
      totalScore = totalConfiguredWeight > 0 ? roundToTwo(
        (codeCorrectnessScore * session.assessment.codeWeight + aiuTotalScore * session.assessment.aiuWeight)
          / totalConfiguredWeight,
      ) : codeCorrectnessScore
    } else {
      aiuTotalScore = 0
      totalScore = codeCorrectnessScore
    }
    }
  }

  const updatedScore = await prisma.sessionScore.upsert({
    where: { sessionId: data.session_id },
    update: {
      codeCorrectnessScore,
      aiuScores,
      aiuTotalScore,
      projectScores,
      totalScore,
      scoreEvidence,
      scoredAt: new Date(),
    },
    create: {
      sessionId: data.session_id,
      codeCorrectnessScore,
      aiuScores,
      aiuTotalScore,
      projectScores,
      totalScore,
      scoreEvidence,
    },
    select: { sessionId: true, aiuTotalScore: true, totalScore: true },
  })

  return updatedScore
}
