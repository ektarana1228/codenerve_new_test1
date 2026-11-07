import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { problemBank } from './problemBank'

test('catalog has 750 valid unique problems and executable reference solutions', () => {
  expect(problemBank).toHaveLength(750)
  expect(new Set(problemBank.map((problem) => problem.id)).size).toBe(750)
  const mismatches: string[] = []
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
      const actual = output.join('\n').replace(/\r\n/g, '\n')
      const expected = testCase.expected.trim()
      if (actual !== expected) mismatches.push(`${problem.id}: input ${JSON.stringify(testCase.input)}, expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  }
  expect(mismatches).toEqual([])

  const pythonCommand = [process.env.SANDBOX_PYTHON_BIN, 'python3', 'python', 'py']
    .filter((command): command is string => Boolean(command))
    .find((command) => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0)
  if (!pythonCommand) throw new Error('A Python interpreter is required to validate reference solutions')

  const representative = problemBank.filter((_, index) => index % 25 === 0)
  for (const problem of representative) {
    for (const testCase of problem.testCases) {
      const python = spawnSync(pythonCommand, ['-c', problem.referenceSolutions.PYTHON], { input: testCase.input, encoding: 'utf8' })
      expect(python.status).toBe(0)
      expect(python.stdout.trim().replace(/\r\n/g, '\n')).toBe(testCase.expected.trim())
    }
  }
}, 30_000)
