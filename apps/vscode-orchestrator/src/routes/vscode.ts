import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createDecipheriv } from 'crypto'
import { prisma } from '@platform/db'
import type { VscodeOrchestratorEnv } from '@platform/config'
import type { Logger } from '@platform/logger'
import { makeAuthenticate, sendError } from '../lib/auth'
import { mintProxyToken, proxyCookie, tokenFromCookie } from '../lib/token'
import { proxyHttp } from '../lib/proxy'
import { renderStubPage } from '../lib/stub'
import type { Manager } from '../lib/manager'
import type { SandboxLanguage } from '../lib/workspace'

export interface VscodeRouteOptions {
  env: VscodeOrchestratorEnv
  manager: Manager
  log: Logger
}

const idParam = z.object({ id: z.string().uuid() })
const ensureBody = z.object({ theme: z.enum(['dark', 'light']).default('dark') })
const applyBody = z.object({ code: z.string().min(1).max(2_000_000) })
const OPENROUTER_KEY_ID = 'singleton'

function toSandboxLanguage(dbLang: string): SandboxLanguage {
  return dbLang.toLowerCase() as SandboxLanguage
}

function decryptApiKey(stored: string, hexKey: string): string {
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted key format')
  const [ivHex, authTagHex, ciphertextHex] = parts
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

export async function vscodeRoutes(fastify: FastifyInstance, opts: VscodeRouteOptions): Promise<void> {
  const { env, manager, log } = opts
  const authenticate = makeAuthenticate(env.JWT_SECRET)

  // Let non-JSON bodies stream straight through to the proxy without buffering.
  // JSON keeps its built-in parser so the control + stub endpoints still work.
  fastify.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined))

  // Guard: candidate JWT must match the path session id.
  async function requireOwnSession(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, id: string): Promise<boolean> {
    const payload = request.jwtPayload!
    if (payload.role !== 'STUDENT' || payload.session_id !== id) {
      sendError(reply, 403, 'FORBIDDEN', 'Access denied')
      return false
    }
    return true
  }

  // ── POST /api/v1/vscode/sessions/:id/ensure ──────────────────────────────────
  // Boots (or reuses) the session's VS Code, seeding it from the durable code.
  // Returns the same-origin iframe URL + proxy token.
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/vscode/sessions/:id/ensure',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const { id } = params.data
      if (!(await requireOwnSession(request, reply, id))) return

      const body = ensureBody.safeParse(request.body ?? {})
      const theme = body.success ? body.data.theme : 'dark'

      const session = await prisma.session.findUnique({
        where: { id },
        select: {
          status: true,
          language: true,
          currentCode: true,
          assessment: {
            select: {
              kind: true,
              llmModel: true,
              allowedModels: true,
              connectionDetails: true,
              referenceFiles: true,
            },
          },
        },
      })
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'Session not found')

      const a = session.assessment
      const referenceFiles =
        (a?.referenceFiles as Array<{ path: string; contentBase64: string }> | null) ?? []

      const readOnly = session.status === 'SUBMITTED' || session.status === 'EXPIRED'
      let openRouterApiKey: string | undefined
      if (a?.kind === 'PROJECT') {
        const config = await prisma.systemConfig.findUnique({ where: { id: OPENROUTER_KEY_ID } })
        if (config?.openrouterKeyEncrypted) {
          try {
            openRouterApiKey = decryptApiKey(config.openrouterKeyEncrypted, env.OPENROUTER_ENCRYPTION_KEY)
          } catch {
            log.error({ sessionId: id }, 'Failed to decrypt OpenRouter key for OpenCode')
          }
        }
      }
      const target = await manager.ensure({
        sessionId: id,
        language: toSandboxLanguage(session.language),
        seedCode: session.currentCode,
        theme,
        readOnly,
        kind: a?.kind === 'PROJECT' ? 'PROJECT' : 'CODING',
        referenceFiles,
        allowedModels: a?.allowedModels ?? [],
        connectionDetails:
          (a?.connectionDetails as Array<{ label: string; value: string }> | null) ?? [],
        llmModel: a?.llmModel,
        openRouterApiKey,
      })

      const token = mintProxyToken(id, env.JWT_SECRET)
      // Set the cookie the browser will replay on every /vscode/<id>/* request
      // (assets, redirects, WS). The tkn query param is a first-request fallback.
      reply.header('Set-Cookie', proxyCookie(id, token))
      return reply.status(200).send({
        data: {
          url: `/vscode/${id}/?tkn=${encodeURIComponent(token)}`,
          mode: target.mode,
          read_only: readOnly,
        },
      })
    },
  )

  // ── POST /api/v1/vscode/sessions/:id/flush ───────────────────────────────────
  // Reads the live workspace out of the container and writes it to the durable
  // Session.currentCode, so Run/Submit (which read currentCode) see fresh code.
  // Called by the client before Run and before Submit, and by the sync loop.
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/vscode/sessions/:id/flush',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const { id } = params.data
      if (!(await requireOwnSession(request, reply, id))) return

      const code = await manager.readCurrentCode(id)
      if (code === null) return sendError(reply, 409, 'NOT_FOUND', 'VS Code workspace not initialized')

      const session = await prisma.session.findUnique({ where: { id }, select: { status: true } })
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'Session not found')
      // Never overwrite a locked session's stored code.
      if (session.status === 'ACTIVE') {
        await prisma.session.update({ where: { id }, data: { currentCode: code } })
      }

      return reply.status(200).send({ data: { code, saved_at: new Date().toISOString() } })
    },
  )

  // ── Stub-mode file bridge (dev only; docker mode never hits these) ────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/vscode/sessions/:id/apply',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'id must be a valid UUID')
      const { id } = params.data
      if (!(await requireOwnSession(request, reply, id))) return

      const body = applyBody.safeParse(request.body)
      if (!body.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid workspace payload')

      const session = await prisma.session.findUnique({ where: { id }, select: { status: true } })
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'Session not found')
      if (session.status !== 'ACTIVE') return sendError(reply, 409, 'SUBMISSION_LOCKED', 'Session is locked')

      const code = await manager.writeCurrentCode(id, body.data.code)
      if (code === null) return sendError(reply, 409, 'NOT_FOUND', 'VS Code workspace not initialized')

      await prisma.session.update({ where: { id }, data: { currentCode: code } })
      return reply.status(200).send({ data: { code, saved_at: new Date().toISOString() } })
    },
  )

  fastify.get<{ Params: { id: string }; Querystring: { tkn?: string } }>(
    '/vscode/:id/_stub/files',
    async (request, reply) => {
      const rec = manager.getRecord(request.params.id)
      if (!rec?.stub) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'no workspace' } })
      return reply.send(rec.stub)
    },
  )
  fastify.post<{ Params: { id: string } }>(
    '/vscode/:id/_stub/files',
    async (request, reply) => {
      const ws = request.body as { main: string; files: Record<string, string> }
      const ok = manager.setStubFiles(request.params.id, ws)
      return reply.status(ok ? 200 : 409).send({ data: { ok } })
    },
  )

  // ── Proxy / stub page: /vscode/:id and /vscode/:id/* ─────────────────────────
  const serveFrame = async (request: import('fastify').FastifyRequest<{ Params: { id: string }; Querystring: { tkn?: string } }>, reply: import('fastify').FastifyReply) => {
    const { id } = request.params
    // Cookie is the durable credential (survives redirects/assets); query is bootstrap.
    const token = request.query.tkn ?? tokenFromCookie(request.headers.cookie) ?? ''
    const rec = manager.getRecord(id)
    if (!rec) return reply.status(409).send('Call ensure before loading the editor')

    if (rec.stub) {
      // Dev stub: render the same-origin editor page.
      return reply
        .type('text/html')
        .send(renderStubPage({ sessionId: id, token, theme: rec.theme, readOnly: rec.readOnly, workspace: rec.stub }))
    }

    // Docker mode: hijack and stream to the container.
    reply.hijack()
    const handled = proxyHttp(manager, env.JWT_SECRET, id, token, request.raw, reply.raw)
    if (!handled) {
      reply.raw.writeHead(409)
      reply.raw.end('VS Code not ready')
    }
    return reply
  }

  fastify.all('/vscode/:id', serveFrame)
  fastify.all('/vscode/:id/*', serveFrame)

  log.info('vscode routes registered')
}
