import { averageProblemCorrectness, scoreCodingProblem, scoreTechnicalEvaluation } from './codingCorrectness'

const cases = [
  { id: 'basic', category: 'BASIC', weight: 1, isHidden: false, expected: '' },
  { id: 'edge', category: 'EDGE', weight: 2, isCritical: true, isHidden: true, expected: '' },
  { id: 'perf', category: 'PERFORMANCE', weight: 1, isHidden: true, expected: '' },
]

function result(statuses: Array<'pass' | 'fail' | 'error'>, status: 'completed' | 'timeout' | 'error' = 'completed') {
  return {
    status,
    passed: statuses.filter((item) => item === 'pass').length,
    failed: statuses.filter((item) => item !== 'pass').length,
    results: cases.map((testCase, index) => ({ testCaseId: testCase.id, status: statuses[index]!, stdout: '', stderr: '', durationMs: 10 })),
  }
}

test('gives zero for compile/runtime errors and timeouts', () => {
  expect(scoreCodingProblem(cases, result([], 'error'))).toBe(0)
  expect(scoreCodingProblem(cases, result([], 'timeout'))).toBe(0)
})

test('gives full credit only when all weighted evidence passes', () => {
  expect(scoreCodingProblem(cases, result(['pass', 'pass', 'pass']), 'EXTRA_HIGH')).toBe(100)
})

test('weights categories differently by strictness and gates failed critical cases', () => {
  const execution = result(['pass', 'fail', 'pass'])
  expect(scoreCodingProblem(cases, execution, 'LOW')).toBeLessThanOrEqual(85)
  expect(scoreCodingProblem(cases, execution, 'EXTRA_HIGH')).toBeLessThanOrEqual(50)
})

test('equal-averages problems regardless of their test counts', () => {
  expect(averageProblemCorrectness([100, 25])).toBe(62.5)
})

test('penalizes performance-only failure more as strictness increases', () => {
  const execution = result(['pass', 'pass', 'fail'])
  expect(scoreCodingProblem(cases, execution, 'LOW')).toBeGreaterThan(
    scoreCodingProblem(cases, execution, 'EXTRA_HIGH'),
  )
})

test('uses relative weights rather than raw test count', () => {
  const weightedCases = [
    { id: 'small-1', category: 'STANDARD', weight: 1 },
    { id: 'small-2', category: 'STANDARD', weight: 1 },
    { id: 'important', category: 'STANDARD', weight: 8 },
  ]
  const execution = {
    status: 'completed' as const,
    passed: 1,
    failed: 2,
    results: [
      { testCaseId: 'small-1', status: 'fail' as const, stdout: '', stderr: '' },
      { testCaseId: 'small-2', status: 'fail' as const, stdout: '', stderr: '' },
      { testCaseId: 'important', status: 'pass' as const, stdout: '', stderr: '' },
    ],
  }
  expect(scoreCodingProblem(weightedCases, execution, 'MEDIUM')).toBe(81)
})

test('scores the four Disabled-mode technical categories deterministically', () => {
  expect(scoreTechnicalEvaluation(cases, result(['pass', 'pass', 'pass']), 'function solve(values) { if (values.length === 0) return 0; try { return 1 } catch (err) { return 0 } }'))
    .toMatchObject({ correctness: 100, efficiency: 0, robustness: 100, codeQuality: 100, total: 100, states: { efficiency: 'NOT_MEASURED' } })
})

test('does not fabricate efficiency when runtime and performance evidence are missing', () => {
  const basicOnly = [{ id: 'basic', category: 'BASIC', isHidden: false, expected: '' }]
  const execution = { status: 'completed' as const, passed: 1, failed: 0, results: [{ testCaseId: 'basic', status: 'pass' as const, stdout: '', stderr: '' }] }
  expect(scoreTechnicalEvaluation(basicOnly, execution, 'def solve(items):\n    total = 0\n    for item in items:\n        total += item\n    return total')).toMatchObject({
    correctness: 100,
    efficiency: 0,
    states: { correctness: 'PARTIAL', efficiency: 'NOT_MEASURED', robustness: 'NOT_MEASURED' },
  })
})

test('does not penalize normal Python pass statements unless they are empty placeholders', () => {
  const execution = { status: 'completed' as const, passed: 1, failed: 0, results: [{ testCaseId: 'basic', status: 'pass' as const, stdout: '', stderr: '', durationMs: 10 }] }
  const normalPass = 'def solve(items):\n    for item in items:\n        if item is None:\n            pass\n    return len(items)'
  const placeholderPass = 'def solve():\n    pass'
  expect(scoreTechnicalEvaluation([{ id: 'basic', category: 'BASIC', isHidden: false, expected: '' }], execution, normalPass).codeQuality)
    .toBeGreaterThan(scoreTechnicalEvaluation([{ id: 'basic', category: 'BASIC', isHidden: false, expected: '' }], execution, placeholderPass).codeQuality)
})

test('marks execution-dependent categories not measured when execution does not complete', () => {
  const timeout = scoreTechnicalEvaluation(cases, result(['error', 'error', 'error'], 'timeout'), 'def solve(items):\n    total = 0\n    for item in items:\n        total += item\n    return total')
  expect(timeout).toMatchObject({
    correctness: 0,
    efficiency: 0,
    robustness: 0,
    total: 0,
    states: {
      correctness: 'NOT_MEASURED',
      efficiency: 'NOT_MEASURED',
      robustness: 'NOT_MEASURED',
      codeQuality: 'MEASURED',
    },
  })
  expect(timeout.codeQuality).toBeGreaterThan(0)
  expect(timeout.evidence).toMatchObject({ technicalEvaluationState: 'EXECUTION_FAILED' })
})

test('does not score empty or stub-only code quality as perfect', () => {
  const execution = { status: 'completed' as const, passed: 0, failed: 1, results: [{ testCaseId: 'basic', status: 'fail' as const, stdout: '', stderr: '', durationMs: 10 }] }
  const testCase = [{ id: 'basic', category: 'BASIC', isHidden: false, expected: '' }]
  for (const code of ['', 'pass', '# comment only\nimport sys\nfrom math import sqrt\nreturn']) {
    const scored = scoreTechnicalEvaluation(testCase, execution, code)
    expect(scored.codeQuality).toBe(0)
    expect(scored.states.codeQuality).toBe('INSUFFICIENT_CODE')
    expect(scored.evidence).toMatchObject({ codeQuality: expect.objectContaining({ reason: 'INSUFFICIENT_CODE' }) })
  }
})

test('does not treat memory or empirical complexity as measured without telemetry', () => {
  const scored = scoreTechnicalEvaluation(cases, result(['pass', 'pass', 'pass']), 'function solve(values) { let total = 0; for (const value of values) { total += value } return total }')
  expect(scored.states.efficiency).toBe('NOT_MEASURED')
  expect(scored.evidence).toMatchObject({
    complexityState: 'NOT_MEASURED',
    memoryRatio: null,
    memoryState: 'NOT_MEASURED',
    runtimeState: 'EVIDENCE_ONLY',
  })
})

test('averages the four displayed technical criteria into the technical total', () => {
  const scored = scoreTechnicalEvaluation(cases, result(['pass', 'pass', 'pass']), 'function solve(values) { if (values.length === 0) return 0; try { return 1 } catch (err) { return 0 } }')
  expect(scored.efficiency).toBe(0)
  expect(scored.states.efficiency).toBe('NOT_MEASURED')
  expect(scored.total).toBe(100)
})

test('marks correctness partial and renormalizes when hidden tests are absent', () => {
  const basicOnly = [{ id: 'basic', category: 'BASIC', isHidden: false, expected: 'ok' }]
  const execution = {
    status: 'completed' as const,
    passed: 1,
    failed: 0,
    results: [{ testCaseId: 'basic', status: 'pass' as const, stdout: 'ok', stderr: '', durationMs: 10 }],
  }
  const scored = scoreTechnicalEvaluation(basicOnly, execution, 'def solve(items):\n    total = 0\n    for item in items:\n        total += item\n    return total')
  expect(scored.correctness).toBe(100)
  expect(scored.states.correctness).toBe('PARTIAL')
  expect(scored.evidence).toMatchObject({ hiddenTestPassRate: null })
})

test('marks no test coverage as not measured', () => {
  const scored = scoreTechnicalEvaluation([], { status: 'completed' as const, passed: 0, failed: 0, results: [] }, 'def solve(items):\n    total = 0\n    for item in items:\n        total += item\n    return total')
  expect(scored).toMatchObject({
    correctness: 0,
    states: { correctness: 'NOT_MEASURED', efficiency: 'NOT_MEASURED', robustness: 'NOT_MEASURED' },
  })
})

test('allows short loop variables in naming score', () => {
  const execution = { status: 'completed' as const, passed: 1, failed: 0, results: [{ testCaseId: 'basic', status: 'pass' as const, stdout: '', stderr: '', durationMs: 10 }] }
  const loopVars = 'def solve(items):\n    total = 0\n    for i in range(len(items)):\n        for j in range(i):\n            total += j\n    return total'
  expect(scoreTechnicalEvaluation([{ id: 'basic', category: 'BASIC', isHidden: false, expected: '' }], execution, loopVars).evidence)
    .toMatchObject({ codeQuality: expect.objectContaining({ namingScore: expect.any(Number) }) })
  expect((scoreTechnicalEvaluation([{ id: 'basic', category: 'BASIC', isHidden: false, expected: '' }], execution, loopVars).evidence.codeQuality as { namingScore: number }).namingScore)
    .toBeGreaterThan(70)
})

test('does not give high code quality to random non-code text', () => {
  const execution = { status: 'completed' as const, passed: 0, failed: 1, results: [{ testCaseId: 'basic', status: 'fail' as const, stdout: '', stderr: '', durationMs: 10 }] }
  const scored = scoreTechnicalEvaluation([{ id: 'basic', category: 'BASIC', isHidden: false, expected: '' }], execution, 'asssdfghjerth')
  expect(scored.codeQuality).toBe(0)
})
