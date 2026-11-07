jest.mock('./llmJudgeClient', () => ({
  callJudge: jest.fn(),
}))

import { aggregateProjectTaskScores, applyProjectScoreGates, buildProjectEvidence, calculateCriterionScore, mapEvidenceLevel, projectDifficultyWeight, scoreProject, type ProjectEvidence, type TaskScore } from './projectScorer'
import { callJudge } from './llmJudgeClient'

const mockedCallJudge = jest.mocked(callJudge)

beforeEach(() => {
  jest.clearAllMocks()
})

test('scores PROJECT tasks with custom criteria weights', async () => {
  mockedCallJudge.mockResolvedValueOnce(JSON.stringify({
    tasks: [{
      task_id: 'task-1',
      evidence_levels: { custom_a: 3, custom_b: 1 },
      rationale: 'Changed the requested behavior in src/app.ts.',
      evidence_references: ['src/app.ts'],
      missing_requirements: [],
      critical_failures: [],
    }],
  }))

  const result = await scoreProject({
    gatewayUrl: 'http://llm-gateway',
    jwtSecret: 'secret',
    model: 'openai/gpt-4o-mini',
    tasks: [{
      id: 'task-1',
      title: 'Fix search',
      description: 'Fix stale search results.',
      doneWhen: ['latest query wins'],
      difficulty: 'MEDIUM',
      bugBankId: null,
    }],
    currentCode: JSON.stringify({ __multifile__: true, main: 'src/app.ts', files: { 'src/app.ts': 'fixed' } }),
    referenceFilesRaw: [{ path: 'src/app.ts', contentBase64: Buffer.from('buggy').toString('base64') }],
    solutionFilesRaw: [{ path: 'src/app.ts', contentBase64: Buffer.from('solution').toString('base64') }],
    projectScoringCriteriaRaw: [
      { key: 'custom_a', name: 'Custom A', description: 'Score A.', weight: 75 },
      { key: 'custom_b', name: 'Custom B', description: 'Score B.', weight: 25 },
    ],
  })

  expect(result.codeCorrectnessScore).toBe(61.25)
  expect(result.projectScores.tasks[0]?.difficultyWeight).toBe(1.5)
  expect(result.projectScores.aggregation).toEqual({
    totalDifficultyWeight: 1.5,
    weightedScoreSum: 91.88,
    finalProjectScore: 61.25,
  })
  expect(result.projectScores.tasks[0]?.criteriaScores).toEqual([
    { key: 'custom_a', name: 'Custom A', evidenceLevel: 3, score: 75, weight: 75, weightedContribution: 56.25 },
    { key: 'custom_b', name: 'Custom B', evidenceLevel: 1, score: 20, weight: 25, weightedContribution: 5 },
  ])
  expect(result.projectScores.tasks[0]?.baseScore).toBe(61.25)
  expect(result.projectScores.tasks[0]?.finalScore).toBe(61.25)
  expect(result.projectScores.tasks[0]?.weightedTotal).toBe(61.25)
  expect(result.projectScores.tasks[0]?.appliedCaps).toEqual([
    { reason: 'No verification evidence', cap: 70 },
  ])
  expect(result.projectScores.tasks[0]?.evidenceReferences).toEqual(['src/app.ts'])
  expect(result.projectScores.tasks[0]?.missingRequirements).toEqual([])
  expect(mockedCallJudge.mock.calls[0]?.[2].systemPrompt).toContain('custom_a')
  expect(mockedCallJudge.mock.calls[0]?.[2].systemPrompt).toContain('evidence_references')
})

test('maps the same evidence deterministically for every strictness profile', () => {
  expect(['LOW', 'MEDIUM', 'HIGH', 'EXTRA_HIGH'].map((strictness) =>
    mapEvidenceLevel(3, strictness as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH'),
  )).toEqual([85, 75, 65, 55])
})

test('calculates auditable weighted criterion contributions', () => {
  expect(calculateCriterionScore(
    { correctness: 4, verification: 2 },
    [
      { key: 'correctness', name: 'Correctness', description: 'Works.', weight: 60 },
      { key: 'verification', name: 'Verification', description: 'Tested.', weight: 40 },
    ],
    'MEDIUM',
  )).toEqual({
    baseScore: 80,
    criteriaScores: [
      { key: 'correctness', name: 'Correctness', evidenceLevel: 4, score: 100, weight: 60, weightedContribution: 60 },
      { key: 'verification', name: 'Verification', evidenceLevel: 2, score: 50, weight: 40, weightedContribution: 20 },
    ],
  })
})

test('applies deterministic project gates without changing the uncapped calculation input', () => {
  const calculation = calculateCriterionScore(
    {
      acceptance_functional_correctness: 4,
      verification_regression_safety: 4,
      independent_engineering_contribution: 4,
    },
    [
      { key: 'acceptance_functional_correctness', name: 'Correctness', description: 'Works.', weight: 50 },
      { key: 'verification_regression_safety', name: 'Verification', description: 'Tested.', weight: 25 },
      { key: 'independent_engineering_contribution', name: 'Contribution', description: 'Independent.', weight: 25 },
    ],
    'MEDIUM',
  )
  const gated = applyProjectScoreGates({
    calculation,
    evidence: {
      requiredSubmissionFiles: [],
      fileChanges: [{ path: 'src/app.ts', status: 'modified' }],
      aiInteractionCount: 1,
      aiEditedFiles: ['src/app.ts'],
      filesChangedAfterAi: [],
      verificationEvents: [],
      prechecks: {
        missingRequiredFiles: [], hasMeaningfulChange: true, changedFileCount: 1,
        acceptanceCriteriaCount: 1, hasVerificationEvidence: false,
        candidateTestFiles: [], exactReferenceMatches: [],
        assistantUnavailableCount: 0, assistantEvidenceState: 'NOT_USED',
      },
    },
    missingRequirements: ['Handles rollback'],
    criticalFailures: [],
  })
  expect(gated.baseScore).toBe(55)
  expect(gated.finalScore).toBe(55)
  expect(gated.appliedCaps).toEqual([
    { reason: 'One or more Done when requirements are unmet', cap: 60 },
    { reason: 'No verification evidence', cap: 70 },
    { reason: 'AI changes accepted without meaningful candidate revision', cap: 75 },
  ])
  expect(calculation.baseScore).toBe(100)
})

test('keeps scope and code quality unchanged while blind AI acceptance limits independent contribution', () => {
  const calculation = calculateCriterionScore(
    {
      acceptance_functional_correctness: 2,
      verification_regression_safety: 0,
      technical_reasoning_ai_direction: 2,
      independent_engineering_contribution: 2,
      architecture_migration_quality: 2,
      scope_code_quality: 2,
    },
    [
      { key: 'acceptance_functional_correctness', name: 'Acceptance and Functional Correctness', description: 'Works.', weight: 30 },
      { key: 'verification_regression_safety', name: 'Verification and Regression Safety', description: 'Tested.', weight: 20 },
      { key: 'technical_reasoning_ai_direction', name: 'Technical Reasoning and AI Direction', description: 'Reasoned.', weight: 20 },
      { key: 'independent_engineering_contribution', name: 'Independent Engineering Contribution', description: 'Independent.', weight: 15 },
      { key: 'architecture_migration_quality', name: 'Architecture and Migration Quality', description: 'Architecture.', weight: 10 },
      { key: 'scope_code_quality', name: 'Scope and Code Quality', description: 'Scoped.', weight: 5 },
    ],
    'MEDIUM',
  )
  const gated = applyProjectScoreGates({
    calculation,
    evidence: {
      requiredSubmissionFiles: [],
      fileChanges: [{ path: 'solution.py', status: 'added' }],
      aiInteractionCount: 1,
      aiEditedFiles: ['solution.py'],
      filesChangedAfterAi: [],
      verificationEvents: [],
      prechecks: {
        missingRequiredFiles: [],
        hasMeaningfulChange: true,
        changedFileCount: 1,
        acceptanceCriteriaCount: 6,
        hasVerificationEvidence: false,
        candidateTestFiles: [],
        exactReferenceMatches: [],
        assistantUnavailableCount: 0,
        assistantEvidenceState: 'AVAILABLE',
      },
    },
    missingRequirements: ['Unmet Done when item'],
    criticalFailures: [],
  })

  expect(gated.criteriaScores.find((criterion) => criterion.key === 'independent_engineering_contribution')?.score).toBe(20)
  expect(gated.criteriaScores.find((criterion) => criterion.key === 'scope_code_quality')?.score).toBe(50)
  expect(gated.baseScore).toBe(35.5)
  expect(gated.finalScore).toBe(35.5)
})

test('aggregates project tasks using difficulty weights', () => {
  const task = (finalScore: number, difficultyWeight: number) => ({ finalScore, difficultyWeight }) as TaskScore
  expect(projectDifficultyWeight('EASY')).toBe(1)
  expect(projectDifficultyWeight('MEDIUM')).toBe(1.5)
  expect(projectDifficultyWeight('HARD')).toBe(2)
  expect(aggregateProjectTaskScores([
    task(90, 1),
    task(60, 2),
  ])).toEqual({
    totalDifficultyWeight: 3,
    weightedScoreSum: 210,
    finalProjectScore: 70,
  })
})

test('reweights observable criteria when the candidate assistant had a platform outage', () => {
  const calculation = calculateCriterionScore(
    {
      acceptance_functional_correctness: 4,
      technical_reasoning_ai_direction: 0,
      independent_engineering_contribution: 0,
    },
    [
      { key: 'acceptance_functional_correctness', name: 'Correctness', description: 'Works.', weight: 65 },
      { key: 'technical_reasoning_ai_direction', name: 'AI Direction', description: 'Directed AI.', weight: 20 },
      { key: 'independent_engineering_contribution', name: 'Contribution', description: 'Independent.', weight: 15 },
    ],
    'MEDIUM',
  )
  const gated = applyProjectScoreGates({
    calculation,
    evidence: {
      requiredSubmissionFiles: [], fileChanges: [{ path: 'src/app.ts', status: 'modified' }],
      aiInteractionCount: 0, aiEditedFiles: [], filesChangedAfterAi: [], verificationEvents: [],
      prechecks: {
        missingRequiredFiles: [], hasMeaningfulChange: true, changedFileCount: 1,
        acceptanceCriteriaCount: 1, hasVerificationEvidence: true,
        candidateTestFiles: ['src/app.test.ts'], exactReferenceMatches: [],
        assistantUnavailableCount: 2, assistantEvidenceState: 'PLATFORM_UNAVAILABLE',
      },
    },
    missingRequirements: [],
    criticalFailures: [],
  })
  expect(gated.baseScore).toBe(100)
  expect(gated.finalScore).toBe(100)
  expect(gated.appliedCaps).toEqual([])
})

test('collects project submission, file-change, AI-edit, and verification evidence', () => {
  expect(buildProjectEvidence({
    starterFiles: { 'src/app.ts': 'before', 'src/removed.ts': 'remove me' },
    candidateFiles: { 'src/app.ts': 'candidate revision', 'src/new.ts': 'new file', 'tests/app.test.ts': 'test' },
    solutionFiles: { 'src/app.ts': 'reference', 'src/new.ts': 'new file' },
    tasks: [{ id: 'task-1', title: 'Fix', description: 'Fix it', doneWhen: ['works', 'tested'], difficulty: 'MEDIUM', bugBankId: null }],
    submissionFilesRaw: [
      { name: 'src/app.ts', description: 'Main implementation' },
      { name: 'README.md', description: 'Documentation' },
    ],
    interactions: [{
      turnNumber: 1,
      activeFile: 'src/app.ts',
      promptText: 'Implement it',
      responseText: 'Implemented',
      aiEdits: { 'src/app.ts': { before: 'before', after: 'AI version' } },
    }],
    runEvents: [{ status: 'completed', passed: 2, failed: 1 }],
  })).toEqual({
    requiredSubmissionFiles: [
      { name: 'src/app.ts', description: 'Main implementation' },
      { name: 'README.md', description: 'Documentation' },
    ],
    fileChanges: [
      { path: 'src/app.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/removed.ts', status: 'deleted' },
      { path: 'tests/app.test.ts', status: 'added' },
    ],
    aiInteractionCount: 1,
    aiEditedFiles: ['src/app.ts'],
    filesChangedAfterAi: ['src/app.ts'],
    verificationEvents: [{ status: 'completed', passed: 2, failed: 1 }],
    prechecks: {
      missingRequiredFiles: ['README.md'],
      hasMeaningfulChange: true,
      changedFileCount: 4,
      acceptanceCriteriaCount: 2,
      hasVerificationEvidence: true,
      candidateTestFiles: ['tests/app.test.ts'],
      exactReferenceMatches: ['src/new.ts'],
      assistantUnavailableCount: 0,
      assistantEvidenceState: 'AVAILABLE',
    },
  })
})

test('fails scoring instead of storing an ordinary zero after invalid judge output', async () => {
  mockedCallJudge.mockResolvedValue('invalid')
  await expect(scoreProject({
    gatewayUrl: 'http://llm-gateway', jwtSecret: 'secret', model: 'model',
    tasks: [{ id: 'task-1', title: 'Fix', description: 'Fix it', doneWhen: ['works'], difficulty: 'MEDIUM', bugBankId: null }],
    currentCode: '', referenceFilesRaw: [], solutionFilesRaw: [],
  })).rejects.toThrow('SCORING_FAILED')
})

const fullCalculation = () => calculateCriterionScore(
  {
    acceptance_functional_correctness: 4,
    verification_regression_safety: 4,
    technical_reasoning_ai_direction: 4,
    independent_engineering_contribution: 4,
    architecture_migration_quality: 4,
    scope_code_quality: 4,
  },
  [
    { key: 'acceptance_functional_correctness', name: 'Correctness', description: 'Works.', weight: 30 },
    { key: 'verification_regression_safety', name: 'Verification', description: 'Tested.', weight: 20 },
    { key: 'technical_reasoning_ai_direction', name: 'AI Direction', description: 'Directed.', weight: 20 },
    { key: 'independent_engineering_contribution', name: 'Contribution', description: 'Reviewed.', weight: 15 },
    { key: 'architecture_migration_quality', name: 'Architecture', description: 'Safe.', weight: 10 },
    { key: 'scope_code_quality', name: 'Scope', description: 'Focused.', weight: 5 },
  ],
  'MEDIUM',
)

const evidenceForGate = (overrides: Partial<ProjectEvidence['prechecks']> = {}, evidenceOverrides: Partial<ProjectEvidence> = {}): ProjectEvidence => ({
  requiredSubmissionFiles: [],
  fileChanges: [{ path: 'src/app.ts', status: 'modified' }],
  aiInteractionCount: 0,
  aiEditedFiles: [],
  filesChangedAfterAi: [],
  verificationEvents: [{ status: 'completed', passed: 2, failed: 0 }],
  ...evidenceOverrides,
  prechecks: {
    missingRequiredFiles: [], hasMeaningfulChange: true, changedFileCount: 1,
    acceptanceCriteriaCount: 1, hasVerificationEvidence: true,
    candidateTestFiles: ['src/app.test.ts'], exactReferenceMatches: [],
    assistantUnavailableCount: 0, assistantEvidenceState: 'NOT_USED',
    ...overrides,
  },
})

test.each([
  ['missing required file', evidenceForGate({ missingRequiredFiles: ['README.md'] }), [], [], 0],
  ['no meaningful change', evidenceForGate({ hasMeaningfulChange: false, changedFileCount: 0 }), [], [], 0],
  ['functionally broken work', evidenceForGate(), [], ['FUNCTIONAL_BROKEN'], 45],
  ['hard-coded work', evidenceForGate(), [], ['HARD_CODED_SOLUTION'], 40],
  ['exact reference copy', evidenceForGate({ exactReferenceMatches: ['src/app.ts'] }), [], [], 40],
  ['security regression', evidenceForGate(), [], ['SECURITY_OR_DESTRUCTIVE_REGRESSION'], 30],
] as const)('caps %s deterministically', (_name, evidence, missingRequirements, criticalFailures, expected) => {
  expect(applyProjectScoreGates({
    calculation: fullCalculation(),
    evidence,
    missingRequirements: [...missingRequirements],
    criticalFailures: [...criticalFailures],
  }).finalScore).toBe(expected)
})

test('limits independent contribution and total score for blindly accepted AI edits', () => {
  const result = applyProjectScoreGates({
    calculation: fullCalculation(),
    evidence: evidenceForGate({}, {
      aiInteractionCount: 1,
      aiEditedFiles: ['src/app.ts'],
      filesChangedAfterAi: [],
    }),
    missingRequirements: [],
    criticalFailures: [],
  })
  expect(result.criteriaScores.find((criterion) => criterion.key === 'independent_engineering_contribution')?.score).toBe(20)
  expect(result.finalScore).toBe(75)
  expect(result.appliedCaps).toContainEqual({ reason: 'AI changes accepted without meaningful candidate revision', cap: 75 })
})

test('retries one invalid judge response and scores the valid response', async () => {
  mockedCallJudge
    .mockResolvedValueOnce('not json')
    .mockResolvedValueOnce(JSON.stringify({
      tasks: [{
        task_id: 'task-1',
        evidence_levels: {
          acceptance_functional_correctness: 4,
          verification_regression_safety: 4,
          technical_reasoning_ai_direction: 4,
          independent_engineering_contribution: 4,
          architecture_migration_quality: 4,
          scope_code_quality: 4,
        },
        rationale: 'Implemented and verified src/app.ts.',
        evidence_references: ['src/app.ts'],
        missing_requirements: [],
        critical_failures: [],
      }],
    }))

  const result = await scoreProject({
    gatewayUrl: 'http://llm-gateway', jwtSecret: 'secret', model: 'model',
    tasks: [{ id: 'task-1', title: 'Fix', description: 'Fix it', doneWhen: ['works'], difficulty: 'EASY', bugBankId: null }],
    currentCode: JSON.stringify({ __multifile__: true, main: 'src/app.ts', files: { 'src/app.ts': 'fixed' } }),
    referenceFilesRaw: [{ path: 'src/app.ts', contentBase64: Buffer.from('buggy').toString('base64') }],
    solutionFilesRaw: [],
    runEvents: [{ status: 'completed', passed: 1, failed: 0 }],
  })

  expect(mockedCallJudge).toHaveBeenCalledTimes(2)
  expect(mockedCallJudge.mock.calls[1]?.[2].userPrompt).toContain('previous response was not valid JSON')
  expect(result.codeCorrectnessScore).toBe(100)
})
