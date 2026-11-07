import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { problemBank } from './problemBank'

test('catalog has 500 valid unique problems and executable reference solutions', () => {
  expect(problemBank).toHaveLength(500)
  expect(new Set(problemBank.map((problem) => problem.id)).size).toBe(500)
  for (const problem of problemBank) {
    expect(problem.testCases.some((testCase) => !testCase.isHidden)).toBe(true)
    expect(problem.testCases.some((testCase) => testCase.isHidden)).toBe(true)
    expect(problem.referenceSolutions.PYTHON).toBeTruthy()
    expect(problem.referenceSolutions.JAVASCRIPT).toBeTruthy()
    expect(problem.referenceSolutions.TYPESCRIPT).toBeTruthy()
    for (const testCase of problem.testCases) {
      const output: string[] = []
      vm.runInNewContext(problem.referenceSolutions.JAVASCRIPT, {
        require: () => ({ readFileSync: () => testCase.input }),
        console: { log: (...values: unknown[]) => output.push(values.join(' ')) },
      })
      expect(output.join('\n').replace(/\r\n/g, '\n')).toBe(testCase.expected.trim())
    }
  }

  const representative = problemBank.filter((_, index) => index % 25 === 0)
  for (const problem of representative) {
    for (const testCase of problem.testCases) {
      const python = spawnSync('python', ['-c', problem.referenceSolutions.PYTHON], { input: testCase.input, encoding: 'utf8' })
      expect(python.status).toBe(0)
      expect(python.stdout.trim().replace(/\r\n/g, '\n')).toBe(testCase.expected.trim())
    }
  }
}, 30_000)
