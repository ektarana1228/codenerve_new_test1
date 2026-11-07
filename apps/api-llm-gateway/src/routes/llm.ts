import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@platform/db'
import { resolveAssistantCapabilities } from '@platform/types'
import { sendError } from '../lib/errors'
import { getRedis } from '../lib/redis'
import { decryptApiKey } from '../lib/crypto'
import { buildConversationContext } from '../lib/context'
import type { RouteOptions } from '../types'

const RATE_LIMIT_MAX = 60
const OPENROUTER_TIMEOUT_MS = 7000
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_KEY_CACHE_MS = 60_000
let cachedOpenRouterKey: { encrypted: string; decrypted: string; expiresAt: number } | null = null

const LlmChatBodySchema = z.object({
  prompt: z.string().min(1),
})

// ── Agentic assistant (tool-calling) ──────────────────────────────────────────

const MAX_AGENT_STEPS = 8
const AGENT_STEP_TIMEOUT_MS = 25_000
const AGENT_WALL_CLOCK_MS = 75_000
const MAX_WORKSPACE_FILES = 50
const MAX_FILE_BYTES = 500_000

const LlmAgentBodySchema = z.object({
  prompt: z.string().min(1),
  files: z.record(z.string(), z.string().max(MAX_FILE_BYTES)),
  active_file: z.string().optional(),
})

const AGENT_SYSTEM_PROMPT = [
  "You are an AI coding assistant embedded in a candidate's in-browser IDE, like Claude Code or Codex.",
  'You can inspect and edit the candidate workspace with the tools list_files, read_file, and write_file.',
  'When asked to change code, call write_file with the FULL new content of each file you change, preserving unrelated code. Never return diffs or partial files.',
  'When asked a question, answer directly in prose and only edit files if a change is requested.',
  'After editing, briefly state what you changed. Keep replies concise.',
  'If asked which model you are, say you are the assessment AI assistant configured by the hiring team.',
].join(' ')

// Non-agentic system prompt. Deliberately carries no tool vocabulary: the model
// is never told a workspace exists, so it cannot invite the candidate to ask for
// file operations this mode forbids.
const NON_AGENTIC_SYSTEM_PROMPT = [
  "You are an AI coding assistant embedded in a candidate's in-browser IDE.",
  'You can explain concepts, answer questions, review code the candidate shows you, and suggest snippets in your reply.',
  "You have no access to the candidate's project files and cannot edit, create, or run anything. Never claim to have changed a file.",
  'If asked to read the project, open other files, run tests, or apply an edit directly, briefly say you cannot do that in this assessment and help in your reply instead.',
  'If asked which model you are, say you are the assessment AI assistant configured by the hiring team.',
].join(' ')

// Upper bound on the single editor buffer injected as context in NON_AGENTIC
// mode. `files` is client-supplied and therefore hostile: a tampered client could
// stuff the whole project into one entry, so the buffer is both restricted to the
// one active path and truncated.
const NON_AGENTIC_CONTEXT_CHARS = 20_000

const AGENT_TOOLS = [
  { type: 'function', function: { name: 'list_files', description: 'List every file path in the workspace.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'read_file', description: 'Return the full text of one file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file with full new content.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
] as const

type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

// One OpenRouter chat call with a hard timeout. Returns the assistant message.
// Throws on timeout (AbortError) or non-OK/empty response - the caller sanitises.
async function openRouterCall(apiKey: string, payload: object, timeoutMs: number): Promise<AgentMessage> {
  const controller = new AbortController()
  const handle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`OpenRouter status ${res.status}`)
    const data = await res.json() as { choices?: Array<{ message?: AgentMessage }> }
    const message = data.choices?.[0]?.message
    if (!message) throw new Error('OpenRouter empty choice')
    return message
  } finally {
    clearTimeout(handle)
  }
}

async function getOpenRouterApiKey(encryptionKey: string): Promise<string | null> {
  if (cachedOpenRouterKey && cachedOpenRouterKey.expiresAt > Date.now()) return cachedOpenRouterKey.decrypted
  const config = await prisma.systemConfig.findUnique({ where: { id: 'singleton' } })
  if (!config?.openrouterKeyEncrypted) return null
  if (cachedOpenRouterKey?.encrypted === config.openrouterKeyEncrypted) {
    cachedOpenRouterKey.expiresAt = Date.now() + OPENROUTER_KEY_CACHE_MS
    return cachedOpenRouterKey.decrypted
  }
  const decrypted = decryptApiKey(config.openrouterKeyEncrypted, encryptionKey)
  cachedOpenRouterKey = { encrypted: config.openrouterKeyEncrypted, decrypted, expiresAt: Date.now() + OPENROUTER_KEY_CACHE_MS }
  return decrypted
}

// Executes one tool call against the in-memory workspace; records writes in `edits`.
function runAgentTool(
  name: string,
  args: Record<string, unknown>,
  workspace: Record<string, string>,
  edits: Record<string, string>,
): string {
  if (name === 'list_files') return JSON.stringify(Object.keys(workspace))
  if (name === 'read_file') {
    const path = String(args.path ?? '')
    return path in workspace ? workspace[path] : `Error: file not found: ${path}`
  }
  if (name === 'write_file') {
    const path = String(args.path ?? '').trim()
    const content = typeof args.content === 'string' ? args.content : ''
    if (!path || path.includes('..') || path.startsWith('/')) return `Error: invalid path: ${path}`
    if (content.length > MAX_FILE_BYTES) return 'Error: file content too large'
    workspace[path] = content
    edits[path] = content
    return `Wrote ${path} (${content.length} chars)`
  }
  return `Error: unknown tool ${name}`
}

export async function llmRoutes(
  fastify: FastifyInstance,
  opts: RouteOptions,
): Promise<void> {
  const { authenticate } = opts.authHooks
  const redis = getRedis(opts.env.REDIS_URL)

  // ── POST /api/v1/llm/chat ──────────────────────────────────────────────────
  // Candidate only. Proxies the prompt to OpenRouter with the session's last
  // 10 turns as conversation context. Logs async; rate-limited per session.

  fastify.post(
    '/api/v1/llm/chat',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const payload = request.jwtPayload!

      if (payload.role !== 'STUDENT') {
        return sendError(reply, 'FORBIDDEN', 'Candidate access required')
      }

      const sessionId = payload.session_id

      const bodyResult = LlmChatBodySchema.safeParse(request.body)
      if (!bodyResult.success) {
        const msg = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }
      const { prompt } = bodyResult.data

      // ── Rate limit check ──────────────────────────────────────────────────
      const rateKey = `rate:llm:${sessionId}`
      const currentCount = await redis.get(rateKey)
      if (currentCount !== null && parseInt(currentCount, 10) >= RATE_LIMIT_MAX) {
        return sendError(reply, 'RATE_LIMITED', 'AI assistant request limit reached for this session')
      }

      // ── Fetch & decrypt OpenRouter key ────────────────────────────────────
      let apiKey: string
      try {
        apiKey = await getOpenRouterApiKey(opts.env.OPENROUTER_ENCRYPTION_KEY) ?? ''
      } catch {
        fastify.log.error('Failed to decrypt OpenRouter API key')
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message: 'AI assistant configuration error' },
        })
      }
      if (!apiKey) {
        fastify.log.error('OpenRouter key is not configured in SystemConfig')
        return reply.status(503).send({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'AI assistant is not available' },
        })
      }

      // ── Fetch session model + conversation context ─────────────────────────
      const [session, logsCount, recentLogs] = await Promise.all([
        prisma.session.findUnique({
          where: { id: sessionId },
          include: { assessment: { select: { llmModel: true } } },
        }),
        prisma.interactionLog.count({ where: { sessionId } }),
        prisma.interactionLog.findMany({
          where: { sessionId },
          orderBy: { turnNumber: 'desc' },
          take: 10,
        }),
      ])

      if (!session) {
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      // Capability gate, resolved from the session's own snapshot - never from
      // the request. A tampered payload or edited local state cannot reach an
      // assistant the recruiter turned off.
      if (!resolveAssistantCapabilities(session.aiAssistantMode).enabled) {
        apiKey = ''
        return sendError(reply, 'FORBIDDEN', 'The AI assistant is disabled for this assessment')
      }

      const turnNumber = logsCount + 1
      const model = session.assessment.llmModel

      // Build messages array: history (chronological) + current prompt.
      // recentLogs arrived in desc order; reverse for chronological input.
      const messages = buildConversationContext(recentLogs.reverse(), prompt)

      // ── Call OpenRouter (7s timeout) ──────────────────────────────────────
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS)

      let responseText: string
      try {
        const res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, messages }),
          signal: controller.signal,
        })

        clearTimeout(timeoutHandle)

        if (!res.ok) {
          // Hard rule: never expose OpenRouter error details or endpoint to client
          fastify.log.error({ status: res.status }, 'OpenRouter returned non-OK status')
          return reply.status(502).send({
            error: { code: 'AI_ASSISTANT_ERROR', message: 'AI assistant error' },
          })
        }

        const data = await res.json() as {
          choices?: Array<{ message?: { content?: string } }>
        }
        responseText = data.choices?.[0]?.message?.content ?? ''

        if (!responseText) {
          fastify.log.error('OpenRouter returned an empty completion')
          return reply.status(502).send({
            error: { code: 'AI_ASSISTANT_ERROR', message: 'AI assistant error' },
          })
        }
      } catch (err: unknown) {
        clearTimeout(timeoutHandle)
        if (err instanceof Error && err.name === 'AbortError') {
          return sendError(reply, 'LLM_TIMEOUT', 'AI assistant request timed out')
        }
        // Hard rule: never log or expose OpenRouter error details
        fastify.log.error('OpenRouter request failed')
        return reply.status(502).send({
          error: { code: 'AI_ASSISTANT_ERROR', message: 'AI assistant error' },
        })
      } finally {
        // Ensure the key is not retained in any closure after the request
        apiKey = ''
      }

      // ── Async log: do not await before responding ─────────────────────────
      void prisma.interactionLog
        .create({
          data: { sessionId, turnNumber, promptText: prompt, responseText },
        })
        .catch((logErr: unknown) => {
          fastify.log.error({ err: logErr }, 'Failed to write interaction log')
        })

      // ── Increment rate limit counter ──────────────────────────────────────
      const newCount = await redis.incr(rateKey)
      if (newCount === 1) {
        // First use - set a TTL so stale keys don't accumulate
        void redis.expire(rateKey, 86400)
      }

      return reply.status(200).send({
        data: { response: responseText, turn_number: turnNumber },
      })
    },
  )

  // ── POST /api/v1/llm/agent ─────────────────────────────────────────────────
  // Candidate only. Agentic assistant: runs a bounded OpenRouter tool-calling
  // loop over the workspace the client sends, editing files in-memory, and
  // returns the changed files + a chat response. Rate-limited per session.
  fastify.post(
    '/api/v1/llm/agent',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const payload = request.jwtPayload!
      if (payload.role !== 'STUDENT') return sendError(reply, 'FORBIDDEN', 'Candidate access required')
      const sessionId = payload.session_id

      const bodyResult = LlmAgentBodySchema.safeParse(request.body)
      if (!bodyResult.success) {
        const msg = bodyResult.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }
      const { prompt, files, active_file } = bodyResult.data
      if (Object.keys(files).length > MAX_WORKSPACE_FILES) {
        return sendError(reply, 'VALIDATION_ERROR', 'Workspace has too many files')
      }

      const rateKey = `rate:llm:${sessionId}`
      const currentCount = await redis.get(rateKey)
      if (currentCount !== null && parseInt(currentCount, 10) >= RATE_LIMIT_MAX) {
        return sendError(reply, 'RATE_LIMITED', 'AI assistant request limit reached for this session')
      }

      let apiKey: string
      try {
        apiKey = await getOpenRouterApiKey(opts.env.OPENROUTER_ENCRYPTION_KEY) ?? ''
      } catch {
        fastify.log.error('Failed to decrypt OpenRouter API key')
        return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'AI assistant configuration error' } })
      }
      if (!apiKey) {
        fastify.log.error('OpenRouter key is not configured in SystemConfig')
        return reply.status(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'AI assistant is not available' } })
      }

      const [session, logsCount, recentLogs] = await Promise.all([
        prisma.session.findUnique({ where: { id: sessionId }, include: { assessment: { select: { llmModel: true } } } }),
        prisma.interactionLog.count({ where: { sessionId } }),
        prisma.interactionLog.findMany({ where: { sessionId }, orderBy: { turnNumber: 'desc' }, take: 10 }),
      ])
      if (!session) {
        apiKey = ''
        return sendError(reply, 'NOT_FOUND', 'Session not found')
      }

      // ── Capability gate ────────────────────────────────────────────────────
      // Resolved from the session's snapshotted mode, never from the request.
      // The client cannot regain tools or file access by calling this route
      // directly or tampering with its payload: below, a non-agentic session is
      // given no tools and no workspace at the point the OpenRouter request is
      // constructed, so there is nothing to unlock client-side.
      const capabilities = resolveAssistantCapabilities(session.aiAssistantMode)
      if (!capabilities.enabled) {
        apiKey = ''
        return sendError(reply, 'FORBIDDEN', 'The AI assistant is disabled for this assessment')
      }

      const turnNumber = logsCount + 1
      const model = session.assessment.llmModel

      // Client-supplied `files` is admitted only when the mode grants workspace
      // access. Otherwise it is dropped whole - not sanitised, not partially
      // honoured - and the tools that would act on it are never sent.
      const workspace: Record<string, string> = capabilities.workspaceAccess ? { ...files } : {}
      const edits: Record<string, string> = {}
      const history: AgentMessage[] = recentLogs.reverse().flatMap((log) => ([
        { role: 'user' as const, content: log.promptText },
        { role: 'assistant' as const, content: log.responseText },
      ]))

      let userContent: string
      if (capabilities.workspaceAccess) {
        userContent = `${prompt}\n\n[Active file: ${active_file ?? '(none)'}. Workspace files: ${Object.keys(workspace).join(', ') || '(empty)'}]`
      } else {
        // Non-agentic: the prompt, plus at most the single active editor buffer.
        // No file listing, no other file's contents, and so no route to test
        // files or hidden test cases.
        const activeBuffer =
          capabilities.activeFileContext && active_file ? files[active_file] : undefined
        userContent =
          activeBuffer === undefined
            ? prompt
            : `${prompt}\n\n[Current editor buffer - ${active_file}]\n${activeBuffer.slice(0, NON_AGENTIC_CONTEXT_CHARS)}`
      }

      const messages: AgentMessage[] = [
        { role: 'system', content: capabilities.tools ? AGENT_SYSTEM_PROMPT : NON_AGENTIC_SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userContent },
      ]

      const startedAt = Date.now()
      let responseText = ''
      try {
        if (!capabilities.tools) {
          // Non-agentic: exactly one completion, and the payload carries no
          // `tools` key at all. Omitting the definitions here - rather than
          // discarding tool calls afterwards - is what makes the restriction
          // real: the model is never offered the option, so no tool call can
          // be emitted and runAgentTool is unreachable.
          const message = await openRouterCall(apiKey, { model, messages }, AGENT_STEP_TIMEOUT_MS)
          responseText = message.content ?? ''
        } else {
          for (let step = 0; step < MAX_AGENT_STEPS; step++) {
            if (Date.now() - startedAt > AGENT_WALL_CLOCK_MS) break
            const message = await openRouterCall(apiKey, { model, tools: AGENT_TOOLS, messages }, AGENT_STEP_TIMEOUT_MS)
            if (message.tool_calls?.length) {
              messages.push(message)
              for (const call of message.tool_calls) {
                let args: Record<string, unknown> = {}
                try { args = JSON.parse(call.function.arguments || '{}') } catch { /* malformed tool args */ }
                const result = runAgentTool(call.function.name, args, workspace, edits)
                messages.push({ role: 'tool', tool_call_id: call.id, content: result })
              }
              continue
            }
            responseText = message.content ?? ''
            break
          }
        }
      } catch (err: unknown) {
        apiKey = ''
        if (err instanceof Error && err.name === 'AbortError') {
          return sendError(reply, 'LLM_TIMEOUT', 'AI assistant request timed out')
        }
        fastify.log.error('OpenRouter agent request failed')
        return reply.status(502).send({ error: { code: 'AI_ASSISTANT_ERROR', message: 'AI assistant error' } })
      } finally {
        apiKey = ''
      }

      const changed = Object.keys(edits)
      const contextSnapshot = active_file && (capabilities.workspaceAccess || capabilities.activeFileContext)
        ? (files[active_file] ?? '').slice(0, capabilities.workspaceAccess ? undefined : NON_AGENTIC_CONTEXT_CHARS)
        : null
      const aiEdits = Object.fromEntries(changed.map((path) => [
        path,
        { before: files[path] ?? '', after: edits[path] ?? '' },
      ]))
      if (!responseText) responseText = changed.length ? `Updated ${changed.length} file(s): ${changed.join(', ')}.` : 'Done.'

      void prisma.interactionLog.create({
        data: {
          sessionId,
          turnNumber,
          activeFile: active_file ?? null,
          contextSnapshot,
          aiEdits: changed.length ? aiEdits : undefined,
          promptText: prompt,
          responseText: changed.length ? `${responseText}\n[edited: ${changed.join(', ')}]` : responseText,
        },
      }).catch((logErr: unknown) => fastify.log.error({ err: logErr }, 'Failed to write agent interaction log'))

      const newCount = await redis.incr(rateKey)
      if (newCount === 1) void redis.expire(rateKey, 86400)

      // `edits` is already empty without tool access; gating it again here keeps
      // the guarantee at the response boundary rather than resting on the loop.
      return reply.status(200).send({
        data: { response: responseText, edits: capabilities.applyEdits ? edits : {}, turn_number: turnNumber },
      })
    },
  )
}
