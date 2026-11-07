// jest.mock calls are hoisted before imports by ts-jest
jest.mock('@platform/db', () => ({
  prisma: {
    session: { findUnique: jest.fn() },
    sessionScore: { upsert: jest.fn() },
  },
  Prisma: { JsonNull: 'JsonNull' },
}))

jest.mock('./scorers', () => ({
  scorePromptQualityByProblem: jest.fn().mockReturnValue(75),
  scoreIterationEfficiency: jest.fn().mockReturnValue(80),
  scoreIndependentEditing: jest.fn().mockReturnValue(65),
  scoreContextualRelevance: jest.fn().mockReturnValue(70),
}))

import { processScoreJob } from './processor'
import { prisma } from '@platform/db'
import * as scorers from './scorers'

const mockFindUnique = jest.mocked(prisma.session.findUnique)
const mockUpsert = jest.mocked(prisma.sessionScore.upsert)

// With mocked scorers: prompt_quality=75, iteration_efficiency=80, independent_editing=65,
// contextual_relevance=70, each weight=25 → aiuTotalScore = 72.5, totalScore = (80*0.5 + 72.5*0.5) = 76.25
const VALID_SESSION = {
  id: 'test-session-id',
  aiAssistantMode: 'NON_AGENTIC' as const,
  scoringStrictness: 'MEDIUM',
  currentCode: 'function solve() { return 42 }',
  logs: [{ promptText: 'How do I approach this?', responseText: 'Try this approach...', turnNumber: 1 }],
  score: { codeCorrectnessScore: 80 },
  assessment: {
    problems: [{ difficulty: 'EASY' as const, description: 'Return the requested result.' }],
    aiuMetricWeights: {
      prompt_quality: 25,
      iteration_efficiency: 25,
      independent_editing: 25,
      contextual_relevance: 25,
    },
    codeWeight: 50,
    aiuWeight: 50,
  },
}

const UPSERT_RESULT = {
  sessionId: 'test-session-id',
  aiuTotalScore: 72.5,
  totalScore: 76.25,
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('processScoreJob', () => {
  test('writes computed AIU scores to the DB for a valid session', async () => {
    mockFindUnique.mockResolvedValueOnce(VALID_SESSION as any)
    mockUpsert.mockResolvedValueOnce(UPSERT_RESULT as any)

    const result = await processScoreJob({ session_id: 'test-session-id' })

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 'test-session-id' },
        update: expect.objectContaining({
          codeCorrectnessScore: 80,
          aiuScores: {
            prompt_quality: 75,
            iteration_efficiency: 80,
            independent_editing: 65,
            contextual_relevance: 70,
          },
          aiuTotalScore: 72.5,
          totalScore: 76.25,
        }),
      }),
    )
    expect(result).toEqual(UPSERT_RESULT)
  })

  test('throws when session_id is not found in the database', async () => {
    mockFindUnique.mockResolvedValueOnce(null)

    await expect(processScoreJob({ session_id: 'missing-id' })).rejects.toThrow('missing-id')
  })

  test('throws when session exists but has no score record yet', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...VALID_SESSION, score: null } as any)

    await expect(processScoreJob({ session_id: 'test-session-id' })).rejects.toThrow()
  })

  test('propagates DB write errors so BullMQ can retry the job', async () => {
    mockFindUnique.mockResolvedValueOnce(VALID_SESSION as any)
    mockUpsert.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(processScoreJob({ session_id: 'test-session-id' })).rejects.toThrow(
      'DB connection lost',
    )
  })

  test('invokes all four scorers via Promise.all for every job', async () => {
    mockFindUnique.mockResolvedValueOnce(VALID_SESSION as any)
    mockUpsert.mockResolvedValueOnce(UPSERT_RESULT as any)

    await processScoreJob({ session_id: 'test-session-id' })

    expect(jest.mocked(scorers.scorePromptQualityByProblem)).toHaveBeenCalledTimes(1)
    expect(jest.mocked(scorers.scoreIterationEfficiency)).toHaveBeenCalledTimes(1)
    expect(jest.mocked(scorers.scoreIterationEfficiency)).toHaveBeenCalledWith(
      VALID_SESSION.logs,
      undefined,
      VALID_SESSION.assessment.problems,
      'NON_AGENTIC',
      'MEDIUM',
    )
    expect(jest.mocked(scorers.scorePromptQualityByProblem)).toHaveBeenCalledWith(
      VALID_SESSION.logs,
      VALID_SESSION.assessment.problems.map((problem) => problem.description),
      'NON_AGENTIC',
      'MEDIUM',
    )
    expect(jest.mocked(scorers.scoreIndependentEditing)).toHaveBeenCalledTimes(1)
    expect(jest.mocked(scorers.scoreIndependentEditing)).toHaveBeenCalledWith(
      VALID_SESSION.logs,
      VALID_SESSION.currentCode,
      'NON_AGENTIC',
      'MEDIUM',
    )
    expect(jest.mocked(scorers.scoreContextualRelevance)).toHaveBeenCalledTimes(1)
    expect(jest.mocked(scorers.scoreContextualRelevance)).toHaveBeenCalledWith(
      VALID_SESSION.logs,
      VALID_SESSION.assessment.problems,
      undefined,
      'NON_AGENTIC',
      'MEDIUM',
    )
  })

  test('normalizes only enabled AIU metrics', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...VALID_SESSION,
      assessment: { ...VALID_SESSION.assessment, aiuMetrics: ['PROMPT_QUALITY'] },
    } as any)
    mockUpsert.mockResolvedValueOnce(UPSERT_RESULT as any)
    await processScoreJob({ session_id: 'test-session-id' })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ aiuTotalScore: 75, totalScore: 77.5 }),
    }))
  })

  test('does not penalize a coding session where no AI was used', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...VALID_SESSION, logs: [] } as any)
    mockUpsert.mockResolvedValueOnce(UPSERT_RESULT as any)
    await processScoreJob({ session_id: 'test-session-id' })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        aiuTotalScore: 0,
        totalScore: 80,
        scoreEvidence: expect.objectContaining({ aiu_evidence_state: 'NO_AI_USED' }),
      }),
    }))
  })

  test('preserves deterministic technical criteria for Disabled mode', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...VALID_SESSION,
      aiAssistantMode: 'DISABLED',
      score: {
        codeCorrectnessScore: 80,
        aiuScores: { correctness: 90, efficiency: 70, robustness: 80, code_quality: 100 },
        aiuTotalScore: 85,
        scoreEvidence: {},
        rubricVersion: 'DISABLED_TECHNICAL_V1',
      },
    } as any)
    mockUpsert.mockResolvedValueOnce(UPSERT_RESULT as any)

    await processScoreJob({ session_id: 'test-session-id' })

    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        codeCorrectnessScore: 80,
        aiuScores: { correctness: 90, efficiency: 70, robustness: 80, code_quality: 100 },
        aiuTotalScore: 85,
        totalScore: 85,
        scoreEvidence: expect.objectContaining({ aiu_evidence_state: 'TECHNICAL_EVALUATION' }),
      }),
    }))
    expect(jest.mocked(scorers.scorePromptQualityByProblem)).not.toHaveBeenCalled()
  })
})
