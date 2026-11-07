import { spawn } from 'child_process'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ExecutionRequest, ExecutionResult, SandboxLanguage } from '@platform/types'

const execFile = promisify(execFileCb)

const TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS ?? '10000', 10)
const MEMORY_LIMIT = `${process.env.SANDBOX_MEMORY_MB ?? '128'}m`
const CPU_LIMIT = process.env.SANDBOX_CPU_QUOTA
  ? String(Number(process.env.SANDBOX_CPU_QUOTA) / 100000)
  : '0.5'

// Set SANDBOX_MODE=local to always skip Docker (dev only — no isolation).
const LOCAL_MODE = process.env.SANDBOX_MODE === 'local'

// ─── Language config ──────────────────────────────────────────────────────────

interface LangConfig {
  image: string
  filename: string
  command: string[]   // args passed to docker (run from /tmp)
  localBin: string    // binary used in local mode
}

const PYTHON_BIN = process.env.SANDBOX_PYTHON_BIN
  ?? (process.platform === 'win32' ? 'python' : 'python3')

const LANG_CONFIG: Record<SandboxLanguage, LangConfig> = {
  python: {
    image: process.env.SANDBOX_IMAGE_PYTHON ?? 'python:3.11-slim',
    filename: 'solution.py',
    command: ['python', '/tmp/solution.py'],
    localBin: PYTHON_BIN,
  },
  javascript: {
    image: process.env.SANDBOX_IMAGE_NODE ?? 'aisd/sandbox-node:latest',
    filename: 'solution.js',
    command: ['node', '/tmp/solution.js'],
    localBin: 'node',
  },
  typescript: {
    image: process.env.SANDBOX_IMAGE_NODE ?? 'aisd/sandbox-node:latest',
    filename: 'solution.ts',
    command: ['tsx', '/tmp/solution.ts'],
    localBin: 'tsx',
  },
}

// ─── Shared result type ───────────────────────────────────────────────────────

interface RunResult {
  status: 'pass' | 'fail' | 'error'
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

// ─── Local execution (no Docker) ─────────────────────────────────────────────

async function runLocalTestCase(
  config: LangConfig,
  code: string,
  input: string,
  expected: string,
  extraFiles?: Array<{ filename: string; content: string }>,
): Promise<RunResult> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sandbox-local-'))

  try {
    await fs.promises.writeFile(path.join(tmpDir, config.filename), code, 'utf8')

    if (extraFiles) {
      for (const ef of extraFiles) {
        await fs.promises.writeFile(path.join(tmpDir, ef.filename), ef.content, 'utf8')
      }
    }

    return await new Promise<RunResult>((resolve) => {
      const started = Date.now()
      const child = spawn(config.localBin, [config.filename], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: tmpDir,
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, TIMEOUT_MS)

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      child.on('close', (exitCode) => {
        clearTimeout(timer)
        const durationMs = Date.now() - started
        if (timedOut) {
          resolve({ status: 'error', stdout: '', stderr: 'Execution timed out', timedOut: true, durationMs })
          return
        }
        if ((exitCode ?? 1) !== 0) {
          resolve({ status: 'error', stdout, stderr, timedOut: false, durationMs })
          return
        }
        const passed = stdout.trim() === expected.trim()
        resolve({ status: passed ? 'pass' : 'fail', stdout, stderr, timedOut: false, durationMs })
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ status: 'error', stdout: '', stderr: err.message, timedOut: false, durationMs: Date.now() - started })
      })

      if (input.length > 0) {
        child.stdin?.write(input, 'utf8')
      }
      child.stdin?.end()
    })
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── Docker execution ─────────────────────────────────────────────────────────

async function runSingleTestCase(
  config: LangConfig,
  code: string,
  input: string,
  expected: string,
  extraFiles?: Array<{ filename: string; content: string }>,
): Promise<RunResult> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sandbox-'))
  const codeFile = path.join(tmpDir, config.filename)
  let containerId: string | undefined

  try {
    await fs.promises.writeFile(codeFile, code, 'utf8')

    const { stdout: createOut } = await execFile('docker', [
      'create',
      '--interactive',
      '--network', 'none',
      '--memory', MEMORY_LIMIT,
      '--cpus', CPU_LIMIT,
      '--user', '1000:1000',
      config.image,
      ...config.command,
    ])
    containerId = createOut.trim()

    await execFile('docker', ['cp', codeFile, `${containerId}:/tmp/${config.filename}`])

    if (extraFiles) {
      for (const ef of extraFiles) {
        const extraFile = path.join(tmpDir, ef.filename)
        await fs.promises.writeFile(extraFile, ef.content, 'utf8')
        await execFile('docker', ['cp', extraFile, `${containerId}:/tmp/${ef.filename}`])
      }
    }

    return await new Promise<RunResult>((resolve) => {
      const started = Date.now()
      const child = spawn('docker', ['start', '--attach', '--interactive', containerId!], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        spawn('docker', ['kill', containerId!]).unref()
        child.kill('SIGKILL')
      }, TIMEOUT_MS)

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      child.on('close', (exitCode) => {
        clearTimeout(timer)
        const durationMs = Date.now() - started
        if (timedOut) {
          resolve({ status: 'error', stdout: '', stderr: 'Execution timed out', timedOut: true, durationMs })
          return
        }
        if ((exitCode ?? 1) !== 0) {
          resolve({ status: 'error', stdout, stderr, timedOut: false, durationMs })
          return
        }
        const passed = stdout.trim() === expected.trim()
        resolve({ status: passed ? 'pass' : 'fail', stdout, stderr, timedOut: false, durationMs })
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ status: 'error', stdout: '', stderr: err.message, timedOut: false, durationMs: Date.now() - started })
      })

      if (input.length > 0) {
        child.stdin?.write(input, 'utf8')
      }
      child.stdin?.end()
    })
  } finally {
    if (containerId) {
      await execFile('docker', ['rm', '-f', containerId]).catch(() => {})
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function executeCode(request: ExecutionRequest): Promise<ExecutionResult> {
  const config = LANG_CONFIG[request.language]
  const extraFiles = request.extraFiles

  let anyTimeout = false

  const results: Array<{
    testCaseId: string
    status: 'pass' | 'fail' | 'error'
    stdout: string
    stderr: string
    durationMs: number
  }> = []

  for (const tc of request.testCases) {
    let run: RunResult

    try {
      if (LOCAL_MODE) {
        run = await runLocalTestCase(config, request.code, tc.input, tc.expected, extraFiles)
      } else {
        // Docker failure must never execute submitted code on the host.
        let dockerRun: RunResult
        try {
          dockerRun = await runSingleTestCase(config, request.code, tc.input, tc.expected, extraFiles)
        } catch (dockerErr) {
          // execFile threw — treat as a Docker-missing error
          const msg = dockerErr instanceof Error ? dockerErr.message : ''
          dockerRun = { status: 'error', stdout: '', stderr: msg, timedOut: false, durationMs: 0 }
        }

        run = dockerRun
      }
    } catch (err) {
      run = {
        status: 'error',
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Execution failed',
        timedOut: false,
        durationMs: 0,
      }
    }

    if (run.timedOut) anyTimeout = true

    // isHidden is intentionally omitted — it must never appear in results
    // returned to the client.
    results.push({
      testCaseId: tc.id,
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      durationMs: run.durationMs,
    })
  }

  const passed = results.filter((r) => r.status === 'pass').length

  return {
    status: anyTimeout ? 'timeout' : 'completed',
    passed,
    failed: results.length - passed,
    results,
  }
}
