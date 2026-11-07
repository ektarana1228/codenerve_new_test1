import { EventEmitter } from 'events'
import type { ExecutionRequest } from '@platform/types'

// ─── child_process mock ───────────────────────────────────────────────────────
// execFile: docker create / cp / rm
// spawn:    docker start --attach --interactive

const mockExecFileImpl = jest.fn()
const mockSpawnImpl = jest.fn()

jest.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFileImpl(...args),
  spawn: (...args: unknown[]) => mockSpawnImpl(...args),
}))

// Prevent real disk I/O
jest.mock('fs', () => ({
  promises: {
    mkdtemp: jest.fn().mockResolvedValue('/tmp/sandbox-test'),
    writeFile: jest.fn().mockResolvedValue(undefined),
    rm: jest.fn().mockResolvedValue(undefined),
  },
}))

import { executeCode } from './index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONTAINER_ID = 'abc123container'

function setupExecFileMock() {
  mockExecFileImpl.mockImplementation(
    (_cmd: string, args: string[], cb: (err: null, res: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: args[0] === 'create' ? `${CONTAINER_ID}\n` : '', stderr: '' })
    },
  )
}

type FakeProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: jest.Mock; end: jest.Mock }
  kill: jest.Mock
}

function makeFakeProcess(stdout: string, exitCode: number, stderr = ''): FakeProcess {
  const child = new EventEmitter() as FakeProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: jest.fn(), end: jest.fn() }
  child.kill = jest.fn()

  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('close', exitCode)
  })

  return child
}

const BASE_REQUEST: Omit<ExecutionRequest, 'testCases'> = {
  language: 'python',
  code: 'print("Hello World")',
}

beforeEach(() => {
  jest.clearAllMocks()
  setupExecFileMock()
})

// ─── Hello world ──────────────────────────────────────────────────────────────

describe('executeCode — hello world', () => {
  test('Python: correct output → result status is pass', async () => {
    mockSpawnImpl.mockImplementation(() => makeFakeProcess('Hello World\n', 0))

    const result = await executeCode({
      ...BASE_REQUEST,
      language: 'python',
      testCases: [{ id: 'tc-1', input: '', expected: 'Hello World', isHidden: false }],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(1)
    expect(result.results[0]!.status).toBe('pass')
    expect(result.results[0]!.stdout.trim()).toBe('Hello World')
  })

  test('JavaScript: correct output → result status is pass', async () => {
    mockSpawnImpl.mockImplementation(() => makeFakeProcess('Hello World\n', 0))

    const result = await executeCode({
      language: 'javascript',
      code: 'console.log("Hello World")',
      testCases: [{ id: 'tc-js', input: '', expected: 'Hello World', isHidden: false }],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(1)
    expect(result.results[0]!.status).toBe('pass')
  })

  test('wrong output → status is fail, not error', async () => {
    mockSpawnImpl.mockImplementation(() => makeFakeProcess('wrong answer\n', 0))

    const result = await executeCode({
      ...BASE_REQUEST,
      testCases: [{ id: 'tc-1', input: '', expected: 'Hello World', isHidden: false }],
    })

    expect(result.results[0]!.status).toBe('fail')
    expect(result.passed).toBe(0)
    expect(result.failed).toBe(1)
  })
})

// ─── Timeout ──────────────────────────────────────────────────────────────────

describe('executeCode — timeout', () => {
  test('returns status "timeout" when container exceeds wall clock limit', async () => {
    jest.useFakeTimers()
    try {
      // Process that never closes until killed synchronously
      const hangingChild = new EventEmitter() as FakeProcess
      hangingChild.stdout = new EventEmitter()
      hangingChild.stderr = new EventEmitter()
      hangingChild.stdin = { write: jest.fn(), end: jest.fn() }
      hangingChild.kill = jest.fn().mockImplementation(() => {
        hangingChild.emit('close', 137) // synchronous close on kill
      })

      mockSpawnImpl.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === 'kill') {
          const killEmitter = new EventEmitter() as EventEmitter & { unref: jest.Mock }
          killEmitter.unref = jest.fn()
          return killEmitter
        }
        return hangingChild
      })

      const promise = executeCode({
        ...BASE_REQUEST,
        testCases: [{ id: 'tc-1', input: '', expected: 'x', isHidden: false }],
      })

      // Allow the Promise chain to advance through:
      // mkdtemp → writeFile → execFile(create) → execFile(cp) → spawn → setTimeout set
      // Use 20 ticks to account for extra internal Promise hops in Jest mocks
      for (let i = 0; i < 20; i++) await Promise.resolve()

      // Now the setTimeout is registered; fire it
      jest.advanceTimersByTime(11000)

      const result = await promise
      expect(result.status).toBe('timeout')
    } finally {
      jest.useRealTimers()
    }
  }, 10000)
})

// ─── Runtime error ────────────────────────────────────────────────────────────

describe('executeCode — runtime error', () => {
  test('non-zero exit → status is error, stderr is populated', async () => {
    mockSpawnImpl.mockImplementation(() =>
      makeFakeProcess('', 1, 'NameError: name "x" is not defined\n'),
    )

    const result = await executeCode({
      ...BASE_REQUEST,
      testCases: [{ id: 'tc-1', input: '', expected: 'out', isHidden: false }],
    })

    expect(result.results[0]!.status).toBe('error')
    expect(result.results[0]!.stderr).toContain('NameError')
  })
})

describe('executeCode — Docker unavailable', () => {
  test('does not execute code locally when Docker API access is denied', async () => {
    mockExecFileImpl.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: Error) => void) => {
        cb(new Error('permission denied while trying to connect to the Docker API at unix:///var/run/docker.sock'))
      },
    )

    const result = await executeCode({
      ...BASE_REQUEST,
      testCases: [{ id: 'tc-1', input: '', expected: 'Hello World', isHidden: false }],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(0)
    expect(result.results[0]!.status).toBe('error')
    expect(result.results[0]!.stderr).toContain('permission denied')
    expect(mockSpawnImpl).not.toHaveBeenCalled()
  })
})

// ─── Hidden test case isolation ───────────────────────────────────────────────

describe('executeCode — hidden test case isolation', () => {
  const MIXED_TEST_CASES = [
    { id: 'vis-1', input: 'a', expected: 'a', isHidden: false },
    { id: 'hid-1', input: 'b', expected: 'b', isHidden: true },
    { id: 'hid-2', input: 'c', expected: 'c', isHidden: true },
  ]

  beforeEach(() => {
    // Fresh process per spawn call — required for multi-test-case runs
    mockSpawnImpl.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'kill') {
        const e = new EventEmitter() as EventEmitter & { unref: jest.Mock }
        e.unref = jest.fn()
        return e
      }
      return makeFakeProcess('a\n', 0) // all test cases "pass"
    })
  })

  test('isHidden field from test case definition is never present in any result object', async () => {
    const result = await executeCode({ ...BASE_REQUEST, testCases: MIXED_TEST_CASES })

    for (const r of result.results) {
      expect(r).not.toHaveProperty('isHidden')
    }
  })

  test('test case input/expected content does not appear in result objects', async () => {
    const result = await executeCode({ ...BASE_REQUEST, testCases: MIXED_TEST_CASES })

    for (const r of result.results) {
      // The sandbox runner does not echo back the test case definition fields
      expect(r).not.toHaveProperty('input')
      expect(r).not.toHaveProperty('expected')
    }
  })
})

// ─── Container cleanup ────────────────────────────────────────────────────────

describe('executeCode — container cleanup', () => {
  test('calls docker rm -f once per test case, even after an error', async () => {
    // Use mockImplementation so each spawn call gets a fresh process
    mockSpawnImpl.mockImplementation(() => makeFakeProcess('42\n', 0))

    const testCases = [
      { id: 'tc-1', input: '', expected: '42', isHidden: false },
      { id: 'tc-2', input: '', expected: '42', isHidden: false },
    ]

    await executeCode({ ...BASE_REQUEST, testCases })

    // Per test case: 1 create + 1 cp + 1 rm = 3 execFile calls; 2 test cases = 6 total
    const rmCalls = (mockExecFileImpl.mock.calls as [string, string[]][]).filter(
      ([, args]) => args[0] === 'rm' && args[1] === '-f',
    )
    expect(rmCalls).toHaveLength(testCases.length)
  })

  test('removes container even when execution produces a runtime error', async () => {
    mockSpawnImpl.mockImplementation(() => makeFakeProcess('', 1, 'SyntaxError'))

    await executeCode({
      ...BASE_REQUEST,
      testCases: [{ id: 'tc-1', input: '', expected: 'x', isHidden: false }],
    })

    const rmCalls = (mockExecFileImpl.mock.calls as [string, string[]][]).filter(
      ([, args]) => args[0] === 'rm',
    )
    expect(rmCalls.length).toBeGreaterThanOrEqual(1)
  })
})
