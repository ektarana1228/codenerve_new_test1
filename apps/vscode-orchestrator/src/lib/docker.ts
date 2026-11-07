import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import * as net from 'net'

const execFile = promisify(execFileCb)

// Thin wrappers over the `docker` CLI (same posture as sandbox/runner - no
// dockerode dependency). Each session gets one long-lived openvscode-server
// container named vscode-<sessionId>.

export function containerName(sessionId: string): string {
  return `vscode-${sessionId}`
}

// Hard ceiling on any single docker CLI call. Normal create/cp/start take well
// under a second; if the daemon is hung/unresponsive this makes the call fail
// fast (killed) instead of blocking `ensure` - and a candidate's browser -
// forever. A killed call is treated as "Docker unavailable" and falls back to
// the stub editor.
const DOCKER_CALL_TIMEOUT_MS = 15000

export async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFile('docker', args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: DOCKER_CALL_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  return stdout
}

// 'running' | 'exited' | 'absent'
export async function containerState(sessionId: string): Promise<string> {
  try {
    const out = await docker(['inspect', '-f', '{{.State.Status}}', containerName(sessionId)])
    return out.trim()
  } catch {
    return 'absent'
  }
}

export interface CreateOptions {
  image: string
  memoryMb: number
  cpuQuota: number
  network: string // '' => publish a random localhost port instead
  serverArgs: string[]
  // Extra container environment variables (e.g. OPENROUTER_API_KEY for OpenCode).
  env?: Record<string, string>
}

// Create (but do not start) the container. Returns the container name.
export async function createContainer(sessionId: string, opts: CreateOptions): Promise<string> {
  const name = containerName(sessionId)
  const args = [
    'create',
    '--name', name,
    '--label', 'aisd.role=vscode',
    '--memory', `${opts.memoryMb}m`,
    '--cpus', String(opts.cpuQuota / 100000),
    // Drop privileges / shrink the escape surface.
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '256',
  ]
  if (opts.network) {
    // Compose deployment: join the shared (ideally internal) network; reached by name.
    args.push('--network', opts.network)
  } else {
    // Host dev: publish the server to an ephemeral loopback port.
    args.push('-p', '127.0.0.1:0:3000')
  }
  // execFile passes args as an argv array (no shell), so values with special
  // characters are safe without quoting.
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    args.push('-e', `${key}=${value}`)
  }
  args.push(opts.image, ...opts.serverArgs)
  await docker(args)
  return name
}

export async function startContainer(sessionId: string): Promise<void> {
  await docker(['start', containerName(sessionId)])
}

// `docker cp` seeds files as root, so the uid-1000 openvscode-server user cannot
// read/write the workspace (breaks the extension host + OpenCode). Hand the path
// back to the server user after seeding. Runs as root inside the container.
export async function chownInContainer(sessionId: string, owner: string, targetPath: string): Promise<void> {
  await docker(['exec', '-u', '0', containerName(sessionId), 'chown', '-R', owner, targetPath])
}

export async function removeContainer(sessionId: string): Promise<void> {
  await docker(['rm', '-f', containerName(sessionId)]).catch(() => {})
}

// Copy a host directory's contents into the container path.
export async function copyInto(sessionId: string, hostDir: string, containerPath: string): Promise<void> {
  await docker(['cp', `${hostDir}/.`, `${containerName(sessionId)}:${containerPath}`])
}

// Copy a single host file into the container.
export async function copyFileInto(sessionId: string, hostFile: string, containerPath: string): Promise<void> {
  await docker(['cp', hostFile, `${containerName(sessionId)}:${containerPath}`])
}

// Copy a container directory out to a host directory.
export async function copyOut(sessionId: string, containerPath: string, hostDir: string): Promise<void> {
  await docker(['cp', `${containerName(sessionId)}:${containerPath}`, hostDir])
}

// Resolve the loopback host port mapped to container port 3000 (publish mode).
export async function publishedPort(sessionId: string): Promise<number> {
  const out = await docker(['port', containerName(sessionId), '3000/tcp'])
  // e.g. "127.0.0.1:49223"
  const match = out.trim().split('\n')[0]?.match(/:(\d+)\s*$/)
  if (!match) throw new Error(`could not resolve published port for ${containerName(sessionId)}`)
  return Number(match[1])
}

// List session ids that currently have a vscode container (running or not).
export async function listSessionIds(): Promise<string[]> {
  try {
    const out = await docker(['ps', '-a', '--filter', 'label=aisd.role=vscode', '--format', '{{.Names}}'])
    return out
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.startsWith('vscode-'))
      .map((n) => n.slice('vscode-'.length))
  } catch {
    return []
  }
}

// Poll until the server accepts a TCP connection, or throw after timeoutMs.
export async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  // Intentionally no Math.random / Date.now jitter beyond the deadline check.
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port }, () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.setTimeout(1000, () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`timed out waiting for ${host}:${port}`)
}

// True when the error looks like Docker is unavailable OR unresponsive - a dev
// machine without Docker, a permission problem, or a hung/timed-out daemon. All
// of these should fall back to the stub editor rather than hang the candidate.
export function isDockerUnavailable(err: unknown): boolean {
  // execFile timeout kills the process - surfaces as killed/ETIMEDOUT.
  if (err && typeof err === 'object') {
    const e = err as { killed?: boolean; code?: string; signal?: string }
    if (e.killed || e.code === 'ETIMEDOUT') return true
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('enoent') ||
    msg.includes('cannot connect to the docker daemon') ||
    msg.includes('permission denied while trying to connect') ||
    msg.includes('etimedout') ||
    msg.includes('timed out')
  )
}
