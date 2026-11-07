import { CreateTestCaseRequestSchema, normalizeTestCaseWeights } from '@platform/types'

describe('coding test-case scoring metadata', () => {
  test('applies backward-compatible defaults to existing test cases', () => {
    expect(CreateTestCaseRequestSchema.parse({ input: '1', expected: '1' })).toEqual({
      input: '1',
      expected: '1',
      isHidden: false,
      category: 'STANDARD',
      weight: 1,
      isCritical: false,
    })
  })

  test('accepts explicit category, weight, and critical metadata', () => {
    const parsed = CreateTestCaseRequestSchema.parse({
      input: 'large input',
      expected: 'result',
      isHidden: true,
      category: 'PERFORMANCE',
      weight: 4,
      isCritical: true,
    })
    expect(parsed).toMatchObject({ category: 'PERFORMANCE', weight: 4, isCritical: true })
  })

  test('rejects non-positive weights', () => {
    expect(CreateTestCaseRequestSchema.safeParse({ input: '', expected: '', weight: 0 }).success).toBe(false)
  })

  test('normalizes relative weights to 100 independently per problem', () => {
    const firstProblem = normalizeTestCaseWeights([{ weight: 1 }, { weight: 3 }])
    const secondProblem = normalizeTestCaseWeights([{ weight: 2 }, { weight: 2 }, { weight: 4 }])
    expect(firstProblem).toEqual([25, 75])
    expect(secondProblem).toEqual([25, 25, 50])
    expect(firstProblem.reduce((sum, weight) => sum + weight, 0)).toBe(100)
    expect(secondProblem.reduce((sum, weight) => sum + weight, 0)).toBe(100)
  })
})
