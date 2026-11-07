jest.mock('puppeteer', () => ({ launch: jest.fn() }))

import { buildBatchReportHtml, buildCandidateReportHtml } from './pdf'

test('candidate PDF keeps its print header and dashboard score data', () => {
  const html = buildCandidateReportHtml({
    candidateName: 'Candidate <One>',
    assessmentTitle: 'SDE & Python',
    language: 'PYTHON',
    totalScore: 7.5,
    codeCorrectnessScore: 100,
    aiuScores: {
      correctness: 0,
      efficiency: 0,
      robustness: 15,
      code_quality: 15,
    },
    aiuTotalScore: 7.5,
    timeTakenSeconds: 59,
    turnCount: 1,
    submittedAt: '2026-07-19T00:00:00.000Z',
    generatedAt: '2026-07-19T00:01:00.000Z',
    aiAssistantMode: 'DISABLED',
    kind: 'CODING',
    codeWeight: 60,
    aiuWeight: 40,
    aiuMetricWeights: {
      prompt_quality: 25,
      independent_editing: 25,
      contextual_relevance: 25,
      iteration_efficiency: 25,
    },
    scoreEvidence: {
      scoring_strictness: 'MEDIUM',
      aiu_evidence_state: 'TECHNICAL_EVALUATION',
      enabled_aiu_metrics: ['correctness', 'efficiency', 'robustness', 'code_quality'],
      coding_test_evidence: {
        problems: [{
          problem_index: 1,
          problem_title: 'Count Values Above Limit',
          execution_status: 'completed',
          visible_passed: 2,
          visible_total: 2,
          hidden_passed: 8,
          hidden_total: 8,
          total_passed: 10,
          total_tests: 10,
          critical_failed: 0,
          problem_score: 100,
        }],
      },
    },
  })

  expect(html).toContain('<section class="cover">')
  expect(html).toContain('Candidate Score Summary')
  expect(html).toContain('<span>ApexCoder</span>')
  expect(html).toContain('Candidate Assessment Report')
  expect(html).not.toContain('01 Report')
  expect(html).not.toContain('02 Calculation')
  expect(html).toContain('Candidate &lt;One&gt;')
  expect(html).toContain('SDE &amp; Python')
  expect(html).toContain('<span class="number">7.5</span><span class="denominator">/100</span>')
  expect(html).toContain('<div class="unit">Total Score</div>')
  expect(html).toContain('<div class="value">7.5<span class="score-denominator">/100</span></div>')
  expect(html).not.toContain('Code Correctness')
  expect(html).not.toContain('<div class="label">Technical Evaluation</div><div class="value">7.5</div>')
  expect(html).toContain('Score (/100)')
  expect(html).toContain('score-progress-cell')
  expect(html).not.toContain('<th>Visual</th>')
  expect(html).not.toContain('Prompt Quality')
  expect(html).not.toContain('Independent Editing')
  expect(html).not.toContain('<div class="info-label">AI Assistant</div><div class="info-value">Agentic</div>')
  expect(html).toContain('How the score was calculated')
  expect(html).toContain('Correctness')
  expect(html).toContain('Efficiency')
  expect(html).toContain('Robustness')
  expect(html).toContain('Code Quality')
  expect(html).toContain('Total score calculation')
  expect(html).toContain('The total score is the average of all criteria scores')
  expect(html).toContain('Measures whether the solution compiles successfully')
  expect(html).toContain('Measures how effectively the solution uses computational resources')
  expect(html).not.toContain('Technical Evaluation = Total Score')
  expect(html).not.toContain('Values on this page are rendered from the same persisted score record')
  expect(html).not.toContain('Candidate Feedback')
})

test('batch PDF warns when leaderboard mixes scoring rubric versions', () => {
  const html = buildBatchReportHtml({
    assessmentTitle: 'SDE Batch',
    language: 'PYTHON',
    timeLimitMinutes: 60,
    codeWeight: 60,
    aiuWeight: 40,
    llmModel: 'openai/gpt-4o-mini',
    generatedAt: '2026-07-22T00:00:00.000Z',
    rubricVersions: ['DISABLED_TECHNICAL_V1', 'DISABLED_TECHNICAL_V2'],
    candidates: [
      {
        rank: 1,
        candidateName: 'V1 Candidate',
        totalScore: 80,
        codeCorrectnessScore: 80,
        aiuTotalScore: 80,
        aiuScores: { correctness: 80 },
        rubricVersion: 'DISABLED_TECHNICAL_V1',
        language: 'PYTHON',
        timeTakenSeconds: 120,
        turnCount: 0,
        submittedAt: '2026-07-22T00:00:00.000Z',
        aiAssistantMode: 'DISABLED',
      },
      {
        rank: 2,
        candidateName: 'V2 Candidate',
        totalScore: 75,
        codeCorrectnessScore: 75,
        aiuTotalScore: 75,
        aiuScores: { correctness: 75 },
        rubricVersion: 'DISABLED_TECHNICAL_V2',
        language: 'PYTHON',
        timeTakenSeconds: 180,
        turnCount: 0,
        submittedAt: '2026-07-22T00:01:00.000Z',
        aiAssistantMode: 'DISABLED',
      },
    ],
  })

  expect(html).toContain('Rubric Versions')
  expect(html).toContain('DISABLED_TECHNICAL_V1, DISABLED_TECHNICAL_V2')
  expect(html).toContain('This batch report includes multiple scoring rubrics')
})

test('candidate PDF renders only technical evaluation metrics for coding reports', () => {
  const html = buildCandidateReportHtml({
    candidateName: 'Candidate',
    assessmentTitle: 'Assessment',
    language: 'PYTHON',
    totalScore: 0,
    codeCorrectnessScore: 0,
    aiuScores: { prompt_quality: 150, contextual_relevance: -5 },
    aiuTotalScore: 0,
    timeTakenSeconds: null,
    turnCount: 0,
    submittedAt: null,
    generatedAt: 'now',
    aiAssistantMode: 'NON_AGENTIC',
  })
  expect(html).toContain('width:0%;')
  expect(html).toContain('<div class="score-progress-value">0/100</div>')
  expect(html).toContain('Correctness')
  expect(html).toContain('Efficiency')
  expect(html).toContain('Robustness')
  expect(html).toContain('Code Quality')
  expect(html).not.toContain('Prompt Quality')
  expect(html).not.toContain('Contextual Relevance')
})

test('project PDF explains and reconciles the persisted task aggregation', () => {
  const html = buildCandidateReportHtml({
    candidateName: 'Project Candidate',
    assessmentTitle: 'Migration',
    language: 'PYTHON',
    totalScore: 75,
    codeCorrectnessScore: 75,
    aiuScores: {},
    aiuTotalScore: 0,
    timeTakenSeconds: 600,
    turnCount: 3,
    submittedAt: '2026-07-21T00:00:00.000Z',
    generatedAt: '2026-07-21T00:01:00.000Z',
    aiAssistantMode: 'AGENTIC',
    kind: 'PROJECT',
    projectScores: {
      tasks: [
        {
          difficulty: 'EASY',
          difficultyWeight: 1,
          baseScore: 90,
          finalScore: 90,
          criteriaScores: [{ name: 'Functional correctness', score: 90, weight: 100 }],
          appliedCaps: [],
        },
        {
          difficulty: 'HARD',
          difficultyWeight: 2,
          baseScore: 67.5,
          finalScore: 67.5,
          criteriaScores: [{ name: 'Functional correctness', score: 67.5, weight: 100 }],
          appliedCaps: [{ reason: 'Missing verification', cap: 70 }],
        },
      ],
      aggregation: { baseWeightedScoreSum: 225, baseProjectScore: 75, weightedScoreSum: 225, totalDifficultyWeight: 3, finalProjectScore: 75 },
    },
  })

  expect(html).toContain('Project / Migration')
  expect(html).toContain('Tasks Evaluated</div><div class="value">2/2</div>')
  expect(html).not.toContain('This section expands the project score')
  expect(html).not.toContain('02 Scoring Method')
  expect(html).toContain('Base score - 75.0 /100')
  expect(html).toContain('Task Score - 75.0 /100')
  expect(html).not.toContain('<h3>Task Coverage</h3>')
  expect(html).not.toContain('<h3>Score Controls</h3>')
  expect(html).toContain('Controls considered:<ul>')
  expect(html).toContain('Missing verification cap 70.0 /100')
  expect(html).toContain('Task weighting:')
  expect(html).toContain('Weighted task sum: 225.00')
  expect(html).toContain('project-card-stack')
  expect(html).toContain('<strong>Functional correctness</strong>')
  expect(html).toContain('Considers the persisted evaluator evidence for this configured project criterion.')
  expect(html).toContain('Missing verification')
  expect(html).toContain('Weighted criteria')
  expect(html).toContain('<h3>Weighted criteria calculation</h3>')
  expect(html).toContain('75.0 x 100.0%')
  expect(html).toContain('<h3>Applied score caps</h3>')
  expect(html).not.toContain('Values on this page are rendered from the same persisted score record')
  expect(html).toContain('min(67.5, 70.0)')
  expect(html).toContain('Task 2: min(67.5, 70.0) = 67.5')
  expect(html).toContain('weighted task sum 225.00 / total difficulty weight 3.00')
  expect(html).toContain('75.0 /100 ~= reported Base score 75.0 /100 and Total 75.0 /100')
})
