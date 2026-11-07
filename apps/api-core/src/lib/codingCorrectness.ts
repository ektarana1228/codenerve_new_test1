import type { ExecutionResult } from '@platform/types'

export type CodingStrictness = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH'
export type ScoredTestCase = {
  id: string
  input?: string
  expected?: string
  isHidden?: boolean
  category?: string
  weight?: number
  isCritical?: boolean
}

export type TechnicalCategoryScore = {
  correctness: number
  efficiency: number
  robustness: number
  codeQuality: number
  total: number
  states: Record<'correctness' | 'efficiency' | 'robustness' | 'codeQuality', 'MEASURED' | 'PARTIAL' | 'NOT_MEASURED' | 'INSUFFICIENT_CODE'>
  evidence: Record<string, unknown>
}

type SubMetric = {
  score: number
  weight: number
  measured: boolean
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function weightedPassRate(testCases: ScoredTestCase[], statuses: Map<string, string>, fallbackPassRate = 0): number {
  if (testCases.length === 0) return 0
  if (!testCases.some((testCase) => statuses.has(testCase.id))) return fallbackPassRate
  const total = testCases.reduce((sum, testCase) => sum + (testCase.weight ?? 1), 0)
  const passed = testCases.reduce(
    (sum, testCase) => sum + (statuses.get(testCase.id) === 'pass' ? (testCase.weight ?? 1) : 0),
    0,
  )
  return total > 0 ? passed / total : 0
}

function measuredWeightedPassRate(testCases: ScoredTestCase[], statuses: Map<string, string>): number | null {
  if (testCases.length === 0) return null
  const total = testCases.reduce((sum, testCase) => sum + (testCase.weight ?? 1), 0)
  if (total <= 0) return null
  const passed = testCases.reduce(
    (sum, testCase) => sum + (statuses.get(testCase.id) === 'pass' ? (testCase.weight ?? 1) : 0),
    0,
  )
  return passed / total
}

function outputValidationRate(testCases: ScoredTestCase[], result: ExecutionResult): number | null {
  const expectedById = new Map(testCases.map((testCase) => [testCase.id, testCase.expected ?? '']))
  const comparable = result.results.filter((item) => expectedById.has(item.testCaseId) && (expectedById.get(item.testCaseId) ?? '').trim() !== '')
  if (comparable.length === 0) return null
  return comparable.filter((item) => item.stdout.trim() === (expectedById.get(item.testCaseId) ?? '').trim()).length / comparable.length
}

function scoreByThreshold(value: number, good: number, fair: number, poor: number): number {
  if (value <= good) return 100
  if (value <= fair) return 70
  if (value <= poor) return 40
  return 10
}

function estimateCyclomaticComplexity(code: string): number {
  const matches = code.match(/\b(if|else\s+if|elif|for|while|case|catch|except|&&|\|\||\?)\b/g)
  return 1 + (matches?.length ?? 0)
}

function functionLineStats(code: string): { median: number; max: number } {
  const lines = code.split(/\r?\n/)
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*(def|function|async function|const\s+\w+\s*=\s*(?:async\s*)?\(|let\s+\w+\s*=\s*(?:async\s*)?\(|var\s+\w+\s*=\s*(?:async\s*)?\()/i.test(line))
    .map((item) => item.index)
  if (starts.length === 0) return { median: lines.filter((line) => line.trim()).length, max: lines.filter((line) => line.trim()).length }
  const lengths = starts.map((start, index) => (starts[index + 1] ?? lines.length) - start).sort((a, b) => a - b)
  return { median: lengths[Math.floor(lengths.length / 2)] ?? 0, max: lengths[lengths.length - 1] ?? 0 }
}

function maxNestingDepth(code: string): number {
  let depth = 0
  let maxDepth = 0
  for (const line of code.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || /^(#|\/\/)/.test(trimmed)) continue
    const indentDepth = Math.floor((line.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0) / 2)
    const braceDepth = (line.match(/[{}]/g) ?? []).reduce((sum, token) => sum + (token === '{' ? 1 : -1), 0)
    depth = Math.max(indentDepth, depth + braceDepth)
    maxDepth = Math.max(maxDepth, depth)
  }
  return maxDepth
}

function namingScore(code: string): number {
  const identifiers = code.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? []
  const reserved = new Set(['def', 'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'in', 'of', 'try', 'catch', 'except', 'class', 'import', 'from', 'print', 'console', 'log', 'true', 'false', 'null', 'None'])
  const names = identifiers.filter((name) => !reserved.has(name))
  if (names.length === 0) return 100
  const trivial = /^(?:[a-z]\d+|x\d*|temp\d*|data\d*|foo|bar)$/i
  const ok = names.filter((name) => /^[ijkn]$/.test(name) || (name.length >= 3 && !trivial.test(name))).length
  return round2((ok / names.length) * 100)
}

function duplicationRatio(code: string): number {
  const meaningful = code.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^(#|\/\/)/.test(line))
  if (meaningful.length < 6) return 0
  const windows = meaningful.slice(0, -2).map((_, index) => meaningful.slice(index, index + 3).join('\n'))
  const duplicateWindows = windows.filter((window, index) => windows.indexOf(window) !== index).length
  return round2((duplicateWindows / windows.length) * 100)
}

function deadCodeRatio(code: string): number {
  const lines = code.split(/\r?\n/)
  const meaningful = lines.map((line) => line.trim()).filter(Boolean)
  if (meaningful.length === 0) return 0
  let unreachable = 0
  let afterExit = false
  for (const line of meaningful) {
    if (afterExit) unreachable += 1
    afterExit = /\b(return|raise|throw|break|continue)\b/.test(line)
    if (/^(def|function|class)\b/.test(line)) afterExit = false
  }
  return round2((unreachable / meaningful.length) * 100)
}

function emptyPassPlaceholder(code: string): boolean {
  return /^\s*(?:def\s+\w+\([^)]*\):|function\s+\w+\([^)]*\)\s*\{?)\s*(?:\r?\n)?\s*pass\s*$/im.test(code)
}

function codeSignalScore(code: string): number {
  const trimmed = code.trim()
  if (!trimmed) return 0
  const meaningfulLines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const hasCodeSyntax = /\b(def|function|return|if|elif|else|for|while|try|except|catch|class|import|from|print|console\.log|let|const|var)\b|[=+\-*/%<>()[\]{}:;]/.test(trimmed)
  const hasIdentifier = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/.test(trimmed)
  const hasOperatorOrDelimiter = /[=+\-*/%<>()[\]{}:;]/.test(trimmed)
  if (!hasCodeSyntax || !hasIdentifier) return 0
  if (meaningfulLines.length === 1 && !hasOperatorOrDelimiter) return 0
  if (trimmed.length < 12 && !/\b(return|print)\b/.test(trimmed)) return 20
  return 100
}

function meaningfulStatementCount(code: string): number {
  const stripped = code
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').replace(/\/\/.*$/, '').trim())
    .filter((line) =>
      line &&
      !/^(?:import\b|from\b|pass\b|return\s*$)/.test(line) &&
      !/^\{?\s*\}?\s*$/.test(line),
    )
    .join('\n')
  if (!stripped) return 0
  const patterns = [
    /\b(def|function|class)\b/g,
    /\b(if|elif|else|for|while|try|except|catch|switch|case)\b/g,
    /\breturn\s+[^;\n]+/g,
    /\b(print|console\.log)\s*\(/g,
    /\b(?:let|const|var)\s+\w+\s*=|\b\w+\s*=/g,
  ]
  return patterns.reduce((sum, pattern) => sum + (stripped.match(pattern) ?? []).length, 0)
}

function deterministicCodeQuality(code: string): { score: number; state: 'MEASURED' | 'INSUFFICIENT_CODE'; evidence: Record<string, number | boolean | string> } {
  const meaningfulStatements = meaningfulStatementCount(code)
  if (meaningfulStatements < 3) {
    return {
      score: 0,
      state: 'INSUFFICIENT_CODE',
      evidence: { empty: !code.trim(), meaningfulStatements, reason: 'INSUFFICIENT_CODE' },
    }
  }
  const signalScore = codeSignalScore(code)
  const complexity = estimateCyclomaticComplexity(code)
  const complexityScore = scoreByThreshold(complexity, 10, 20, 30)
  const fnStats = functionLineStats(code)
  const nesting = maxNestingDepth(code)
  const structureScore = round2((scoreByThreshold(fnStats.median, 30, 60, 100) + scoreByThreshold(fnStats.max, 60, 100, 160) + scoreByThreshold(nesting, 4, 6, 8)) / 3)
  const names = namingScore(code)
  const duplication = duplicationRatio(code)
  const deadCode = deadCodeRatio(code)
  const placeholderPenalty = /\b(TODO|FIXME|NotImplementedError)\b/i.test(code) || emptyPassPlaceholder(code) ? 20 : 0
  const baseScore = Math.max(0, round2(
    0.25 * complexityScore +
    0.20 * structureScore +
    0.20 * names +
    0.20 * (100 - duplication) +
    0.15 * (100 - deadCode) -
    placeholderPenalty,
  ))
  const score = Math.min(baseScore, signalScore)
  return { score, state: 'MEASURED', evidence: { meaningfulStatements, complexity, complexityScore, medianFunctionLength: fnStats.median, maxFunctionLength: fnStats.max, nestingDepth: nesting, structureScore, namingScore: names, duplicationRatio: duplication, deadCodeRatio: deadCode, placeholderPenalty, signalScore } }
}

function boundaryHandlingScore(code: string): number {
  if (!code.trim()) return 0
  const checks = [
    /\b(if|elif)\b[^\n]*(?:len|length|size|count|n)\b/i,
    /\b(if|elif)\b[^\n]*(?:null|None|undefined|empty|==\s*0|<=\s*0)\b/i,
    /\btry\b|\bexcept\b|\bcatch\b/i,
  ]
  return round2((checks.filter((pattern) => pattern.test(code)).length / checks.length) * 100)
}

function durationScore(result: ExecutionResult): number | null {
  const durations = result.results.map((item) => item.durationMs).filter((value): value is number => Number.isFinite(value))
  if (durations.length === 0) return null
  const sorted = durations.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  if (median <= 50) return 100
  if (median >= 2000) return 0
  return round2(100 - ((median - 50) / 1950) * 100)
}

function weightedMeasuredScore(metrics: SubMetric[]): number | null {
  const measured = metrics.filter((metric) => metric.measured)
  const weight = measured.reduce((sum, metric) => sum + metric.weight, 0)
  if (weight <= 0) return null
  return round2(measured.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / weight)
}

function averageMeasuredCategories(categories: Array<{ score: number; state: TechnicalCategoryScore['states'][keyof TechnicalCategoryScore['states']] }>): number {
  const measured = categories.filter((category) => category.state === 'MEASURED' || category.state === 'PARTIAL')
  if (measured.length === 0) return 0
  return round2(measured.reduce((sum, category) => sum + category.score, 0) / measured.length)
}

const COMPLEXITY_TIERS = ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n^2)', 'O(worse)'] as const

function inferredOptimalTier(description = ''): number {
  const text = description.toLowerCase()
  if (/constant|o\(1\)/.test(text)) return 0
  if (/logarithmic|o\(log\s*n\)/.test(text)) return 1
  if (/linearithmic|n\s*log\s*n|o\(n\s*log\s*n\)/.test(text)) return 3
  if (/quadratic|o\(n\^?2\)/.test(text)) return 4
  return 2
}

function inferredCandidateTier(code: string): number {
  const complexity = estimateCyclomaticComplexity(code)
  const loopCount = (code.match(/\b(for|while)\b/g) ?? []).length
  const nestedLoop = /\b(for|while)\b[\s\S]{0,300}\b(for|while)\b/.test(code)
  if (nestedLoop) return 4
  if (loopCount >= 1 && complexity > 12) return 3
  if (loopCount >= 1) return 2
  if (/\b(binary|bisect|log)\b/i.test(code)) return 1
  return 0
}

function complexityComparisonScore(code: string, description?: string): number {
  const delta = Math.max(0, inferredCandidateTier(code) - inferredOptimalTier(description))
  if (delta === 0) return 100
  if (delta === 1) return 70
  if (delta === 2) return 40
  return 10
}

/** Fixed, reproducible Disabled-mode rubric with four equally weighted categories. */
export function scoreTechnicalEvaluation(
  testCases: ScoredTestCase[],
  result: ExecutionResult,
  code: string,
  problemDescription = '',
): TechnicalCategoryScore {
  const quality = deterministicCodeQuality(code)
  if (quality.state === 'INSUFFICIENT_CODE') {
    return {
      correctness: 0,
      efficiency: 0,
      robustness: 0,
      codeQuality: 0,
      total: 0,
      states: { correctness: 'NOT_MEASURED', efficiency: 'NOT_MEASURED', robustness: 'NOT_MEASURED', codeQuality: 'INSUFFICIENT_CODE' },
      evidence: { technicalEvaluationState: 'INSUFFICIENT_CODE', codeQuality: quality.evidence },
    }
  }
  if (result.status !== 'completed') {
    return {
      correctness: 0,
      efficiency: 0,
      robustness: 0,
      codeQuality: quality.score,
      total: 0,
      states: { correctness: 'NOT_MEASURED', efficiency: 'NOT_MEASURED', robustness: 'NOT_MEASURED', codeQuality: quality.state },
      evidence: { reason: result.status, technicalEvaluationState: 'EXECUTION_FAILED', codeQuality: quality.evidence },
    }
  }
  const statuses = new Map(result.results.map((item) => [item.testCaseId, item.status]))
  const visibleCases = testCases.filter((testCase) => !testCase.isHidden)
  const hiddenCases = testCases.filter((testCase) => testCase.isHidden)
  const visibleTestPassRate = measuredWeightedPassRate(visibleCases, statuses)
  const hiddenTestPassRate = measuredWeightedPassRate(hiddenCases, statuses)
  const outputValidation = outputValidationRate(testCases, result)
  const correctnessScore = weightedMeasuredScore([
    { score: (visibleTestPassRate ?? 0) * 100, weight: 0.20, measured: visibleTestPassRate !== null },
    { score: (hiddenTestPassRate ?? 0) * 100, weight: 0.65, measured: hiddenTestPassRate !== null },
    { score: (outputValidation ?? 0) * 100, weight: 0.15, measured: outputValidation !== null },
  ])
  const correctness = correctnessScore ?? 0
  const correctnessState: TechnicalCategoryScore['states']['correctness'] =
    correctnessScore === null ? 'NOT_MEASURED' : hiddenTestPassRate === null ? 'PARTIAL' : 'MEASURED'

  const robustnessCases = testCases.filter((testCase) => group(testCase.category) === 'edge')
  const runtime = durationScore(result)
  const complexityScore = complexityComparisonScore(code, problemDescription)
  const complexityMeasured = false
  const memoryMeasured = false
  const passedRunCount = result.results.filter((item) => item.status === 'pass').length
  const basicPassed = testCases.some((testCase) => group(testCase.category) === 'basic' && statuses.get(testCase.id) === 'pass')
  const runtimeMeasuredForEfficiency = false
  const efficiencyScore = weightedMeasuredScore([
    { score: complexityScore, weight: 0.50, measured: complexityMeasured },
    { score: runtime ?? 0, weight: 0.30, measured: passedRunCount > 0 && runtimeMeasuredForEfficiency },
    { score: 0, weight: 0.20, measured: memoryMeasured },
  ])
  const efficiency = efficiencyScore ?? 0
  const crashFreeRate = result.results.length === 0 ? null : result.results.filter((item) => item.status !== 'error').length / result.results.length
  const edgeCasePassRate = basicPassed && robustnessCases.length > 0 ? measuredWeightedPassRate(robustnessCases, statuses) : null
  const boundaryHandling = boundaryHandlingScore(code)
  const robustness = edgeCasePassRate === null || crashFreeRate === null
    ? 0
    : round2(0.55 * edgeCasePassRate * 100 + 0.30 * crashFreeRate * 100 + 0.15 * boundaryHandling)
  const states = {
    correctness: correctnessState,
    efficiency: efficiencyScore != null ? 'PARTIAL' : 'NOT_MEASURED',
    robustness: edgeCasePassRate == null ? 'NOT_MEASURED' : 'MEASURED',
    codeQuality: quality.state,
  } satisfies TechnicalCategoryScore['states']
  const total = averageMeasuredCategories([
    { score: correctness, state: states.correctness },
    { score: efficiency, state: states.efficiency },
    { score: robustness, state: states.robustness },
    { score: quality.score, state: states.codeQuality },
  ])
  return {
    correctness,
    efficiency,
    robustness,
    codeQuality: quality.score,
    total,
    states,
    evidence: {
      visibleTestPassRate,
      hiddenTestPassRate,
      outputValidation,
      correctnessState,
      optimalComplexity: COMPLEXITY_TIERS[inferredOptimalTier(problemDescription)],
      candidateComplexity: COMPLEXITY_TIERS[inferredCandidateTier(code)],
      complexityScore,
      complexityState: 'NOT_MEASURED',
      runtimeRatio: runtime,
      runtimeState: runtime == null || passedRunCount === 0 ? 'NOT_MEASURED' : 'EVIDENCE_ONLY',
      efficiencyState: passedRunCount === 0 ? 'NO_CORRECT_BASELINE' : 'NOT_MEASURED',
      memoryRatio: null,
      memoryState: 'NOT_MEASURED',
      crashFreeRate,
      edgeCasePassRate,
      robustnessState: !basicPassed ? 'NO_CORRECT_BASELINE' : robustnessCases.length === 0 ? 'NO_EDGE_COVERAGE' : states.robustness,
      boundaryHandling,
      codeQuality: quality.evidence,
    },
  }
}

const PROFILES: Record<CodingStrictness, { executable: number; basic: number; edge: number; performance: number; criticalCap: number }> = {
  LOW: { executable: 10, basic: 55, edge: 30, performance: 5, criticalCap: 85 },
  MEDIUM: { executable: 5, basic: 50, edge: 35, performance: 10, criticalCap: 75 },
  HIGH: { executable: 5, basic: 40, edge: 40, performance: 15, criticalCap: 65 },
  EXTRA_HIGH: { executable: 0, basic: 35, edge: 40, performance: 25, criticalCap: 50 },
}

function group(category = 'STANDARD'): 'basic' | 'edge' | 'performance' {
  if (category === 'PERFORMANCE') return 'performance'
  if (category === 'EDGE' || category === 'ROBUSTNESS') return 'edge'
  return 'basic'
}

export function scoreCodingProblem(
  testCases: ScoredTestCase[],
  result: ExecutionResult,
  strictness: CodingStrictness = 'MEDIUM',
): number {
  if (testCases.length === 0 || result.status !== 'completed') return 0
  const profile = PROFILES[strictness]
  const statusById = new Map(result.results.map((item) => [item.testCaseId, item.status]))
  const hasDetailedResults = testCases.some((testCase) => statusById.has(testCase.id))
  const fallbackPassRate = Math.min(1, Math.max(0, result.passed / testCases.length))
  const activeGroups = [...new Set(testCases.map((testCase) => group(testCase.category)))]
  const availableProfileWeight = activeGroups.reduce((sum, key) => sum + profile[key], 0)
  const functionalBudget = 100 - profile.executable
  let score = profile.executable

  for (const key of activeGroups) {
    const cases = testCases.filter((testCase) => group(testCase.category) === key)
    const totalWeight = cases.reduce((sum, testCase) => sum + (testCase.weight ?? 1), 0)
    const passedWeight = hasDetailedResults
      ? cases.reduce((sum, testCase) => sum + (statusById.get(testCase.id) === 'pass' ? (testCase.weight ?? 1) : 0), 0)
      : totalWeight * fallbackPassRate
    const groupBudget = functionalBudget * (profile[key] / availableProfileWeight)
    score += groupBudget * (totalWeight > 0 ? passedWeight / totalWeight : 0)
  }

  const failedCritical = hasDetailedResults && testCases.some(
    (testCase) => testCase.isCritical && statusById.get(testCase.id) !== 'pass',
  )
  if (failedCritical) score = Math.min(score, profile.criticalCap)
  return Math.round(score * 100) / 100
}

export function averageProblemCorrectness(scores: number[]): number {
  if (scores.length === 0) return 0
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
}
