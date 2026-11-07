import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Logger } from '@platform/logger'
import type { VscodeOrchestratorEnv } from '@platform/config'
import { buildSettings, serverArgs, USER_DATA_DIR } from './config-layer'
import {
  chownInContainer,
  containerName,
  containerState,
  copyInto,
  copyOut,
  createContainer,
  isDockerUnavailable,
  listSessionIds,
  publishedPort,
  removeContainer,
  startContainer,
  waitForPort,
} from './docker'
import {
  deserialize,
  isSyncableFile,
  serialize,
  type SandboxLanguage,
  type Workspace,
} from './workspace'

// Where the candidate's project lives inside the openvscode-server container.
const PROJECT_DIR = '/home/workspace/project'
// The server user's home - docker cp target that already exists + is server-owned,
// so a settings tree merged under it lands with the right parents.
const CONTAINER_HOME = '/home/workspace'
// openvscode-server USER settings file (application-scoped settings like
// workbench.colorTheme are honoured here, not in the workspace .vscode).
const USER_SETTINGS_DIR = `${USER_DATA_DIR}/User`

export type DockerTarget = { mode: 'docker'; host: string; port: number }
export type Target = DockerTarget | { mode: 'stub' }

interface Record_ {
  sessionId: string
  language: SandboxLanguage
  createdAt: number
  target: Target
  readOnly: boolean
  theme: 'dark' | 'light'
  kind?: AssessmentKind
  // Stub mode only - the in-memory workspace the stub editor reads/writes.
  stub?: Workspace
}

// Admin-provided reference material seeded into the workspace (base64 so binary
// assets survive). Written under reference/ and excluded from DB sync-back.
export interface ReferenceFile {
  path: string
  contentBase64: string
}

export type AssessmentKind = 'CODING' | 'PROJECT'

export interface EnsureParams {
  sessionId: string
  language: SandboxLanguage
  seedCode: string
  theme: 'dark' | 'light'
  readOnly: boolean
  // PROJECT sessions use the OpenCode image + egress network; CODING never
  // reaches here (it runs in-browser Monaco). Defaults to CODING for safety.
  kind?: AssessmentKind
  referenceFiles?: ReferenceFile[]
  // PROJECT OpenCode config: the model the candidate may use and provider
  // connection values (base URL, token) seeded into opencode's config.
  allowedModels?: string[]
  connectionDetails?: Array<{ label: string; value: string }>
  llmModel?: string
  openRouterApiKey?: string
}

// Manages the per-session VS Code containers (or, in stub mode, in-memory
// workspaces). One instance is shared across the service.
export class Manager {
  private readonly records = new Map<string, Record_>()
  private stubForced: boolean

  constructor(
    private readonly env: VscodeOrchestratorEnv,
    private readonly log: Logger,
  ) {
    this.stubForced = env.VSCODE_MODE === 'stub'
  }

  getTarget(sessionId: string): Target | undefined {
    return this.records.get(sessionId)?.target
  }

  // Session ids this instance currently manages (for the maintenance loop).
  listManaged(): string[] {
    return Array.from(this.records.keys())
  }

  // Session ids that currently have a running/created container (Docker mode).
  // Lets the maintenance loop reconcile against the DB even after a restart,
  // when in-memory records are empty.
  async listContainerSessionIds(): Promise<string[]> {
    if (this.stubForced) return []
    return listSessionIds()
  }

  // Ensure a workspace exists for the session, seeding it on first creation.
  // Reconnecting to a live container never re-seeds - the candidate's on-disk
  // edits are canonical.
  async ensure(params: EnsureParams): Promise<Target> {
    const existing = this.records.get(params.sessionId)
    if (existing) {
      // The frame re-ensures when the app theme toggles (and when the session
      // locks). Docker mode: rewrite settings on every ensure so new lockdown /
      // UI settings reach already-running containers after a code deploy too.
      const themeChanged = existing.theme !== params.theme
      const readOnlyChanged = existing.readOnly !== params.readOnly
      if (themeChanged || readOnlyChanged) {
        existing.theme = params.theme
        existing.readOnly = params.readOnly
      }
      if (existing.target.mode === 'docker') {
        await this.applyWorkspaceSettings(params.sessionId, params).catch((err) =>
          this.log.warn(
            { err: (err as Error).message, sessionId: params.sessionId },
            'settings refresh failed',
          ),
        )
      }
      return existing.target
    }

    if (this.stubForced) {
      return this.ensureStub(params)
    }

    try {
      return await this.ensureDocker(params)
    } catch (err) {
      if (isDockerUnavailable(err)) {
        this.log.warn(
          { err: (err as Error).message },
          'Docker unavailable - falling back to stub VS Code (dev only, no isolation)',
        )
        this.stubForced = true
        return this.ensureStub(params)
      }
      throw err
    }
  }

  private ensureStub(params: EnsureParams): Target {
    const ws = deserialize(params.seedCode, params.language)
    const target: Target = { mode: 'stub' }
    this.records.set(params.sessionId, {
      sessionId: params.sessionId,
      language: params.language,
      createdAt: Date.now(),
      target,
      readOnly: params.readOnly,
      theme: params.theme,
      stub: ws,
    })
    return target
  }

  // PROJECT sessions use the OpenCode-enabled image; everything else the default.
  private imageFor(kind: AssessmentKind | undefined): string {
    return kind === 'PROJECT' ? this.env.VSCODE_PROJECT_IMAGE : this.env.VSCODE_IMAGE
  }

  // PROJECT sessions join the egress-capable network (OpenCode must reach the
  // model provider); everything else the default (internal) network.
  private networkFor(kind: AssessmentKind | undefined): string {
    if (kind === 'PROJECT' && this.env.VSCODE_PROJECT_NETWORK) return this.env.VSCODE_PROJECT_NETWORK
    return this.env.VSCODE_NETWORK
  }

  private async ensureDocker(params: EnsureParams): Promise<Target> {
    const { sessionId } = params
    const network = this.networkFor(params.kind)
    const state = await containerState(sessionId)

    if (state === 'running') {
      const target = await this.resolveDockerTarget(sessionId, network)
      this.records.set(sessionId, this.recordFor(params, target))
      // Reconnecting: refresh the workspace settings so a theme (or read-only)
      // change since the container was created takes effect live.
      await this.applyWorkspaceSettings(sessionId, params).catch((err) =>
        this.log.warn({ err: (err as Error).message, sessionId }, 'settings refresh failed'),
      )
      return target
    }

    // A stale, non-running container: clear it and start fresh.
    if (state !== 'absent') await removeContainer(sessionId)

    const seedDir = await this.writeSeedDir(params)
    try {
      await createContainer(sessionId, {
        image: this.imageFor(params.kind),
        memoryMb: this.env.VSCODE_MEMORY_MB,
        cpuQuota: this.env.VSCODE_CPU_QUOTA,
        network,
        serverArgs: serverArgs(PROJECT_DIR, `/vscode/${sessionId}/`),
        env: params.kind === 'PROJECT' ? this.openCodeContainerEnv(params) : undefined,
      })
      await copyInto(sessionId, seedDir, PROJECT_DIR)
      // Seed USER settings (theme lives here - see writeUserSettings). Copied
      // before start so the theme is right on the very first paint; the User dir
      // is pre-created + server-owned in the image, so the server can still write
      // its own state there at boot.
      await this.writeUserSettings(sessionId, params)
      await startContainer(sessionId)
      // Seeded files are root-owned (docker cp runs as root); hand the workspace
      // to the server's uid so the extension host / OpenCode can read + write it.
      await chownInContainer(sessionId, 'openvscode-server:openvscode-server', PROJECT_DIR).catch(
        (err) => this.log.warn({ err: (err as Error).message, sessionId }, 'workspace chown failed'),
      )
      if (params.kind === 'PROJECT') {
        // Chown the WHOLE user-data dir, not just User/. When the image hasn't
        // pre-created it (no rebuild), `docker cp` makes data/ itself root-owned,
        // which the uid-1000 server can't write its own state into. Recursive
        // chown from data/ down fixes both that and the seeded settings.json.
        await chownInContainer(sessionId, 'openvscode-server:openvscode-server', USER_DATA_DIR).catch(
          (err) => this.log.warn({ err: (err as Error).message, sessionId }, 'user-settings chown failed'),
        )
      }

      const target = await this.resolveDockerTarget(sessionId, network)
      // Register the record BEFORE waiting for the port. Otherwise the
      // maintenance loop sees a running container with no matching record and
      // reaps it mid-boot, and waitForPort then hangs to its deadline.
      this.records.set(sessionId, this.recordFor(params, target))
      try {
        await waitForPort(target.host, target.port, 30000)
      } catch (err) {
        this.records.delete(sessionId)
        await removeContainer(sessionId)
        throw err
      }

      this.log.info({ sessionId }, 'VS Code container ready')
      return target
    } finally {
      await fs.promises.rm(seedDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private recordFor(params: EnsureParams, target: Target): Record_ {
    return {
      sessionId: params.sessionId,
      language: params.language,
      createdAt: Date.now(),
      target,
      readOnly: params.readOnly,
      theme: params.theme,
      kind: params.kind,
    }
  }

  private async resolveDockerTarget(sessionId: string, network: string): Promise<DockerTarget> {
    // On a user-defined network the container is reachable by name; otherwise it
    // publishes to a random loopback port.
    if (network) {
      return { mode: 'docker', host: containerName(sessionId), port: 3000 }
    }
    const port = await publishedPort(sessionId)
    return { mode: 'docker', host: '127.0.0.1', port }
  }

  // Materialize the seed files + locked settings into a host temp dir for `docker cp`.
  private async writeSeedDir(params: EnsureParams): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-seed-'))
    const ws = deserialize(params.seedCode, params.language)
    for (const [name, content] of Object.entries(ws.files)) {
      const full = path.join(dir, name)
      await fs.promises.mkdir(path.dirname(full), { recursive: true })
      await fs.promises.writeFile(full, content, 'utf8')
    }
    const vscodeDir = path.join(dir, '.vscode')
    await fs.promises.mkdir(vscodeDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(vscodeDir, 'settings.json'),
      JSON.stringify(
        buildSettings({ theme: params.theme, readOnly: params.readOnly, project: params.kind === 'PROJECT' }),
        null,
        2,
      ),
      'utf8',
    )
    await this.writeReferenceFiles(dir, params.referenceFiles)
    if (params.kind === 'PROJECT') await this.writeOpenCodeConfig(dir, params)
    return dir
  }

  // Admin-provided reference files (the PROJECT template: opencode.jsonc, source
  // dirs, data, etc.) written base64-decoded so binary survives, at the workspace
  // ROOT so OpenCode and the candidate see them as the project. Paths are
  // sanitised to stay within the workspace root - never absolute, never "..".
  private async writeReferenceFiles(seedDir: string, files: ReferenceFile[] | undefined): Promise<void> {
    if (!files?.length) return
    const root = path.resolve(seedDir)
    for (const file of files) {
      const rel = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
      const full = path.normalize(path.join(root, rel))
      // Reject anything that resolves outside the workspace root.
      if (full !== root && !full.startsWith(root + path.sep)) {
        this.log.warn({ path: file.path }, 'skipping reference file with unsafe path')
        continue
      }
      await fs.promises.mkdir(path.dirname(full), { recursive: true })
      await fs.promises.writeFile(full, Buffer.from(file.contentBase64, 'base64'))
    }
  }

  // Seed OpenCode's config for PROJECT sessions. The admin's uploaded template
  // (a reference file named opencode.json/opencode.jsonc) is authoritative if
  // present; otherwise we write a minimal opencode.json pinning the assessment
  // model. Provider connection values (base URL / token) are written as env in a
  // .env the OpenCode process inherits. Never overwrite an admin-provided config.
  private async writeOpenCodeConfig(seedDir: string, params: EnsureParams): Promise<void> {
    const has = (name: string) =>
      (params.referenceFiles ?? []).some((f) => f.path.replace(/\\/g, '/') === name)
    const model = params.llmModel
    if (model && !has('opencode.json') && !has('opencode.jsonc')) {
      const config = { $schema: 'https://opencode.ai/config.json', model }
      await fs.promises.writeFile(
        path.join(seedDir, 'opencode.json'),
        JSON.stringify(config, null, 2),
        'utf8',
      )
    }
    // Connection details → .env (best-effort; the admin template usually ships
    // its own token file). Only written when the template didn't provide a .env.
    const details = params.connectionDetails ?? []
    if (details.length > 0 && !has('.env')) {
      const env = details
        .map((d) => `${d.label.trim().replace(/\s+/g, '_')}=${d.value}`)
        .join('\n')
      await fs.promises.writeFile(path.join(seedDir, '.env'), env + '\n', 'utf8')
    }
  }

  // Re-write .vscode/settings.json into a running container (theme / read-only /
  // font). VS Code picks up settings changes live. docker cp writes as root, so
  // hand the workspace back to the server uid afterwards.
  private async applyWorkspaceSettings(sessionId: string, params: EnsureParams): Promise<void> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-settings-'))
    try {
      const vscodeDir = path.join(dir, '.vscode')
      await fs.promises.mkdir(vscodeDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(vscodeDir, 'settings.json'),
        JSON.stringify(
          buildSettings({ theme: params.theme, readOnly: params.readOnly, project: params.kind === 'PROJECT' }),
          null,
          2,
        ),
        'utf8',
      )
      await copyInto(sessionId, dir, PROJECT_DIR)
      await chownInContainer(sessionId, 'openvscode-server:openvscode-server', PROJECT_DIR).catch(() => {})
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    // The theme is an application-scoped setting - refresh it in USER settings
    // too so a live theme toggle actually reaches VS Code.
    await this.writeUserSettings(sessionId, params)
  }

  // Write the openvscode-server USER settings (<user-data-dir>/User/settings.json)
  // into the container. This is where workbench.colorTheme takes effect -
  // it is application-scoped, so the copy of it in the workspace .vscode is
  // ignored by VS Code. Merged under the (existing, server-owned) container home
  // so the nested User dir keeps the right parents; the file itself is then
  // handed to the server uid.
  private async writeUserSettings(sessionId: string, params: EnsureParams): Promise<void> {
    // Only the PROJECT image pins + pre-creates USER_DATA_DIR; CODING runs
    // in-browser Monaco and never reaches this container. Seeding into a
    // non-pre-created data dir would leave it root-owned and break the server.
    if (params.kind !== 'PROJECT') return
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-user-'))
    try {
      // Mirror the USER_DATA_DIR layout under the temp root so `docker cp .`
      // drops settings.json at <home>/.openvscode-server/data/User/settings.json.
      const rel = USER_SETTINGS_DIR.slice(CONTAINER_HOME.length + 1) // ".openvscode-server/data/User"
      const userDir = path.join(dir, ...rel.split('/'))
      await fs.promises.mkdir(userDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(userDir, 'settings.json'),
        JSON.stringify(
          buildSettings({ theme: params.theme, readOnly: params.readOnly, project: params.kind === 'PROJECT' }),
          null,
          2,
        ),
        'utf8',
      )
      await copyInto(sessionId, dir, CONTAINER_HOME)
      // Best-effort: succeeds once the container is running (no-op before start,
      // where the boot path chowns USER_DATA_DIR after start instead).
      await chownInContainer(sessionId, 'openvscode-server:openvscode-server', USER_DATA_DIR).catch(() => {})
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // Container env vars for a PROJECT (OpenCode) session. Injects the OpenRouter
  // API key so OpenCode is pre-authenticated with no per-candidate setup.
  private openCodeContainerEnv(params: EnsureParams): Record<string, string> | undefined {
    const key = this.resolveOpenRouterKey(params)
    return key ? { OPENROUTER_API_KEY: key } : undefined
  }

  // Find the OpenRouter API key from (1) a connection detail whose label looks
  // like OPENROUTER_API_KEY, or (2) an OPENROUTER_API_KEY=... line in any
  // uploaded .env reference file (matching the assessment template). Quotes and
  // surrounding whitespace are stripped.
  private resolveOpenRouterKey(params: EnsureParams): string | undefined {
    const clean = (v: string) => v.trim().replace(/^["']|["']$/g, '').trim()

    for (const d of params.connectionDetails ?? []) {
      if (/openrouter[_ ]?(api[_ ]?)?key/i.test(d.label) && d.value.trim()) {
        return clean(d.value)
      }
    }
    for (const f of params.referenceFiles ?? []) {
      const p = f.path.replace(/\\/g, '/').toLowerCase()
      if (!(p.endsWith('.env') || p.includes('.env'))) continue
      let text: string
      try {
        text = Buffer.from(f.contentBase64, 'base64').toString('utf8')
      } catch {
        continue
      }
      const m = text.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/m)
      if (m) return clean(m[1])
    }
    if (params.openRouterApiKey) return clean(params.openRouterApiKey)
    return undefined
  }

  // Read the current workspace back into the durable currentCode format.
  async readCurrentCode(sessionId: string): Promise<string | null> {
    const rec = this.records.get(sessionId)
    if (!rec) return null
    const ws = rec.target.mode === 'stub' ? rec.stub! : await this.readDockerWorkspace(sessionId, rec)
    return serialize(ws)
  }

  async writeCurrentCode(sessionId: string, code: string): Promise<string | null> {
    const rec = this.records.get(sessionId)
    if (!rec || rec.readOnly) return null
    const ws = this.safeWorkspace(deserialize(code, rec.language))
    if (rec.target.mode === 'stub') {
      rec.stub = { main: ws.main, files: { ...(rec.stub?.files ?? {}), ...ws.files } }
      return serialize(rec.stub)
    }

    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-apply-'))
    try {
      for (const [name, content] of Object.entries(ws.files)) {
        const full = path.normalize(path.join(dir, name))
        if (full !== dir && !full.startsWith(dir + path.sep)) continue
        await fs.promises.mkdir(path.dirname(full), { recursive: true })
        await fs.promises.writeFile(full, content, 'utf8')
      }
      await copyInto(sessionId, dir, PROJECT_DIR)
      await chownInContainer(sessionId, 'openvscode-server:openvscode-server', PROJECT_DIR).catch(() => {})
      return serialize(ws)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private safeWorkspace(ws: Workspace): Workspace {
    const files = Object.fromEntries(
      Object.entries(ws.files).filter(([name, content]) =>
        typeof content === 'string' && this.isSafeWorkspacePath(name),
      ),
    )
    const main = files[ws.main] !== undefined ? ws.main : Object.keys(files)[0] ?? ws.main
    if (Object.keys(files).length === 0) files[main] = ''
    return { main, files }
  }

  private isSafeWorkspacePath(name: string): boolean {
    const normalized = name.replace(/\\/g, '/')
    return !path.isAbsolute(normalized) && !normalized.split('/').includes('..') && isSyncableFile(normalized)
  }

  private async readDockerWorkspace(sessionId: string, rec: Record_): Promise<Workspace> {
    const outParent = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-read-'))
    try {
      await copyOut(sessionId, PROJECT_DIR, outParent)
      const root = path.join(outParent, 'project')
      const files: Record<string, string> = {}
      const walk = async (rel: string): Promise<void> => {
        const abs = path.join(root, rel)
        for (const entry of await fs.promises.readdir(abs, { withFileTypes: true })) {
          const childRel = rel ? path.join(rel, entry.name) : entry.name
          const normalized = childRel.split(path.sep).join('/')
          if (!isSyncableFile(normalized)) continue
          if (entry.isDirectory()) await walk(childRel)
          else files[normalized] = await fs.promises.readFile(path.join(root, childRel), 'utf8')
        }
      }
      await walk('')
      const main = files[rec ? this.mainName(rec.language) : ''] ? this.mainName(rec.language) : Object.keys(files)[0] ?? this.mainName(rec.language)
      if (!files[main]) files[main] = ''
      return { main, files }
    } finally {
      await fs.promises.rm(outParent, { recursive: true, force: true }).catch(() => {})
    }
  }

  private mainName(language: SandboxLanguage): string {
    return deserialize('', language).main
  }

  // Stub mode: the stub editor pushes edits here.
  setStubFiles(sessionId: string, ws: Workspace): boolean {
    const rec = this.records.get(sessionId)
    if (!rec || rec.target.mode !== 'stub' || rec.readOnly) return false
    rec.stub = ws
    return true
  }

  getRecord(sessionId: string): { language: SandboxLanguage; readOnly: boolean; theme: 'dark' | 'light'; stub?: Workspace } | undefined {
    const rec = this.records.get(sessionId)
    if (!rec) return undefined
    return { language: rec.language, readOnly: rec.readOnly, theme: rec.theme, stub: rec.stub }
  }

  // Post-submission lock: rewrite settings so the workspace becomes read-only.
  async lock(sessionId: string): Promise<void> {
    const rec = this.records.get(sessionId)
    if (!rec) return
    rec.readOnly = true
    if (rec.target.mode === 'stub') return
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-lock-'))
    try {
      const vscodeDir = path.join(dir, '.vscode')
      await fs.promises.mkdir(vscodeDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(vscodeDir, 'settings.json'),
        JSON.stringify(
          buildSettings({ theme: rec.theme, readOnly: true, project: rec.kind === 'PROJECT' }),
          null,
          2,
        ),
        'utf8',
      )
      await copyInto(sessionId, dir, PROJECT_DIR)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async destroy(sessionId: string): Promise<void> {
    const rec = this.records.get(sessionId)
    this.records.delete(sessionId)
    if (!rec || rec.target.mode === 'stub') return
    await removeContainer(sessionId)
  }

  // Reap any container whose session is no longer in the active set (submitted,
  // expired, or vanished). Also picks up containers we lost track of on restart.
  async reap(activeSessionIds: Set<string>): Promise<void> {
    for (const id of this.records.keys()) {
      if (!activeSessionIds.has(id)) await this.destroy(id)
    }
    if (this.stubForced) return
    for (const id of await listSessionIds()) {
      if (!activeSessionIds.has(id)) {
        await removeContainer(id)
        this.log.info({ sessionId: id }, 'Reaped orphaned VS Code container')
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const id of Array.from(this.records.keys())) {
      await this.destroy(id)
    }
  }
}
