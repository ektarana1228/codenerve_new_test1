export type WeightedTestCase = { weight?: number }

/** Converts positive relative weights into per-problem percentages totaling 100. */
export function normalizeTestCaseWeights(testCases: WeightedTestCase[]): number[] {
  if (testCases.length === 0) return []
  const weights = testCases.map((testCase) =>
    Number.isFinite(testCase.weight) && (testCase.weight ?? 0) > 0 ? testCase.weight! : 1,
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => (weight / total) * 100)
}
