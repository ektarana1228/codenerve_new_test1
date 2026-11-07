// Integration tests — require Docker daemon to be running.
// First run may be slow while base images are pulled.
// Run with: npm test inside sandbox/runner/

import { executeCode } from './src/index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tc(id: string, input: string, expected: string, isHidden = false) {
  return { id, input, expected, isHidden }
}

// ─── Python ───────────────────────────────────────────────────────────────────

describe('executeCode — Python', () => {
  it('passes a hello-world test case', async () => {
    const result = await executeCode({
      language: 'python',
      code: 'print("hello world")',
      testCases: [tc('00000000-0000-0000-0000-000000000001', '', 'hello world')],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.results[0].status).toBe('pass')
    // Hard rule: isHidden must never appear in results
    expect((result.results[0] as Record<string, unknown>).isHidden).toBeUndefined()
  })

  it('marks wrong output as fail', async () => {
    const result = await executeCode({
      language: 'python',
      code: 'print("wrong answer")',
      testCases: [tc('00000000-0000-0000-0000-000000000002', '', 'hello world')],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.results[0].status).toBe('fail')
  })

  it('reads stdin and produces correct output', async () => {
    const result = await executeCode({
      language: 'python',
      code: 'n = int(input())\nprint(n * 2)',
      testCases: [tc('00000000-0000-0000-0000-000000000004', '21', '42')],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(1)
    expect(result.results[0].status).toBe('pass')
  })

  it('returns error status on a runtime exception', async () => {
    const result = await executeCode({
      language: 'python',
      code: 'raise ValueError("boom")',
      testCases: [tc('00000000-0000-0000-0000-000000000005', '', 'anything')],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(0)
    expect(result.results[0].status).toBe('error')
    expect(result.results[0].stderr).toContain('ValueError')
  })
})

// ─── JavaScript ───────────────────────────────────────────────────────────────

describe('executeCode — JavaScript', () => {
  it('passes a hello-world test case', async () => {
    const result = await executeCode({
      language: 'javascript',
      code: 'console.log("hello world")',
      testCases: [tc('00000000-0000-0000-0000-000000000006', '', 'hello world')],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.results[0].status).toBe('pass')
    expect((result.results[0] as Record<string, unknown>).isHidden).toBeUndefined()
  })

  it('reads stdin via process.stdin and produces correct output', async () => {
    const code = `
const lines = []
process.stdin.on('data', d => lines.push(...d.toString().split('\\n')))
process.stdin.on('end', () => {
  const n = parseInt(lines[0])
  console.log(n * 2)
})
`.trim()

    const result = await executeCode({
      language: 'javascript',
      code,
      testCases: [tc('00000000-0000-0000-0000-000000000007', '21', '42')],
    })

    expect(result.status).toBe('completed')
    expect(result.passed).toBe(1)
    expect(result.results[0].status).toBe('pass')
  })
})
