jest.mock('@platform/db', () => ({
  prisma: {
    systemConfig: { findUnique: jest.fn() },
    session: { findUnique: jest.fn() },
    interactionLog: { count: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  },
}))

// Mock getRedis before importing route code - avoids the ioredis named-export issue
// and the module-level singleton in lib/redis.ts
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
}

jest.mock('../lib/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
}))

// Capture fetch calls to inspect what is sent to "OpenRouter"
const mockFetch = jest.fn()
global.fetch = mockFetch

import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '@platform/db'
import { llmRoutes } from './llm'
import { makeAuthHooks } from '../plugins/authenticate'
import { encryptApiKey } from '../lib/crypto'

const JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
const CANDIDATE_ID = '550e8400-e29b-41d4-a716-446655440001'
const SESSION_ID = '550e8400-e29b-41d4-a716-446655440002'

// 64 hex chars = 32 bytes = valid AES-256 key
const ENCRYPTION_KEY = 'a'.repeat(64)
const REAL_API_KEY = 'sk-or-v1-super-secret-openrouter-key'
const ENCRYPTED_API_KEY = encryptApiKey(REAL_API_KEY, ENCRYPTION_KEY)

const mockPrisma = jest.mocked(prisma)

function buildApp() {
  const app = Fastify({ logger: false })
  const authHooks = makeAuthHooks(JWT_SECRET)
  app.register(llmRoutes, {
    env: {
      JWT_SECRET,
      DATABASE_URL: 'postgres://test',
      REDIS_URL: 'redis://test',
      NODE_ENV: 'test' as const,
      PORT: 3102,
      OPENROUTER_ENCRYPTION_KEY: ENCRYPTION_KEY,
    },
    authHooks,
  })
  return app
}

function candidateToken() {
  return jwt.sign(
    { sub: CANDIDATE_ID, role: 'STUDENT', session_id: SESSION_ID },
    JWT_SECRET,
    { expiresIn: '1h' },
  )
}

// `aiAssistantMode` mirrors the NOT NULL column on Session - the gateway resolves
// it to a capability set, and an absent value fails closed to DISABLED.
function mockValidSession(aiAssistantMode = 'AGENTIC') {
  mockPrisma.systemConfig.findUnique.mockResolvedValue({
    id: 'singleton',
    openrouterKeyEncrypted: ENCRYPTED_API_KEY,
    updatedAt: new Date(),
  } as any)
  mockPrisma.session.findUnique.mockResolvedValue({
    id: SESSION_ID,
    aiAssistantMode,
    assessment: { llmModel: 'openai/gpt-4o-mini' },
  } as any)
  mockPrisma.interactionLog.count.mockResolvedValue(0)
  mockPrisma.interactionLog.findMany.mockResolvedValue([])
  mockPrisma.interactionLog.create.mockResolvedValue({} as any)
}

function mockOpenRouterSuccess(content = 'Here is the answer') {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRedis.get.mockResolvedValue(null)
  mockRedis.incr.mockResolvedValue(1)
  mockRedis.expire.mockResolvedValue(1)
})

// ─── Rate limit ───────────────────────────────────────────────────────────────

describe('LLM rate limiting', () => {
  test('increments Redis counter on each successful request', async () => {
    mockValidSession()
    mockOpenRouterSuccess()

    const app = buildApp()
    await app.ready()

    await app.inject({
      method: 'POST',
      url: '/api/v1/llm/chat',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'How do I solve this?' },
    })

    expect(mockRedis.incr).toHaveBeenCalledWith(`rate:llm:${SESSION_ID}`)
  })

  test('blocks the request and returns 429 RATE_LIMITED when counter is at 60', async () => {
    mockRedis.get.mockResolvedValue('60') // already at max

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/chat',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'one more' },
    })

    expect(response.statusCode).toBe(429)
    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('RATE_LIMITED')
    // OpenRouter should not be called when rate-limited
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('blocks at exactly 61 requests (1 over the 60-request limit)', async () => {
    mockRedis.get.mockResolvedValue('61')

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/chat',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'overflow' },
    })

    expect(response.statusCode).toBe(429)
  })
})

// ─── API key confidentiality ──────────────────────────────────────────────────

describe('OpenRouter API key confidentiality', () => {
  test('decrypted API key is sent to OpenRouter but not present in the response body', async () => {
    mockValidSession()
    mockOpenRouterSuccess()

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/chat',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'explain this' },
    })

    expect(response.statusCode).toBe(200)
    // The real API key must never appear in the response body
    expect(response.body).not.toContain(REAL_API_KEY)
  })

  test('API key is not logged - the fetch Authorization header contains the key but is not in any returned object', async () => {
    mockValidSession()
    mockOpenRouterSuccess()

    const app = buildApp()
    await app.ready()

    await app.inject({
      method: 'POST',
      url: '/api/v1/llm/chat',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'help' },
    })

    // The key is passed as a Bearer token to OpenRouter - verify the call happened
    // but the raw key does NOT appear anywhere in the API response to the caller.
    const [, fetchInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    const authHeader = (fetchInit.headers as Record<string, string>)['Authorization']
    expect(authHeader).toBe(`Bearer ${REAL_API_KEY}`)

    // The actual response the candidate sees has no trace of the key
    const callResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/chat',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'help' },
    })
    expect(callResponse.body).not.toContain(REAL_API_KEY)
    expect(callResponse.body).not.toContain('openrouter.ai')
  })

  test('OpenRouter error is sanitised - raw upstream error is not forwarded to client', async () => {
    mockValidSession()
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'You exceeded your quota', code: 'quota_exceeded' } }),
    })

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/chat',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'help' },
    })

    expect(response.statusCode).toBe(502)
    const body = JSON.parse(response.body)
    // The upstream quota error message must not leak to the client
    expect(body.error.message).not.toContain('quota')
    expect(body.error.message).not.toContain('openrouter')
    expect(body.error.code).toBe('AI_ASSISTANT_ERROR')
  })
})

// ─── Agentic assistant (tool-calling loop) ─────────────────────────────────────

describe('POST /api/v1/llm/agent', () => {
  function toolCallStep(name: string, args: object) {
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [
          { id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ] } }],
      }),
    }
  }
  function finalStep(content: string) {
    return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }) }
  }

  test('applies a write_file tool call and returns the edited file', async () => {
    mockValidSession()
    // Step 1: model asks to write a file. Step 2: model gives its final answer.
    mockFetch
      .mockResolvedValueOnce(toolCallStep('write_file', { path: 'solution.py', content: 'print(1)' }))
      .mockResolvedValueOnce(finalStep('I updated solution.py.'))

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/agent',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'fix the bug', files: { 'solution.py': 'print(0)' }, active_file: 'solution.py' },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.data.edits['solution.py']).toBe('print(1)')
    expect(body.data.response).toContain('updated')
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aiEdits: { 'solution.py': { before: 'print(0)', after: 'print(1)' } },
        contextSnapshot: 'print(0)',
      }),
    }))
    // Two OpenRouter round-trips: the tool call, then the final answer.
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(response.body).not.toContain(REAL_API_KEY)
  })

  test('returns no edits when the model only answers a question', async () => {
    mockValidSession()
    mockFetch.mockResolvedValueOnce(finalStep('Your loop is off by one.'))

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/agent',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'why does it fail?', files: { 'solution.py': 'print(0)' } },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.data.edits).toEqual({})
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('returns 429 RATE_LIMITED without calling OpenRouter', async () => {
    mockRedis.get.mockResolvedValue('60')

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/agent',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: { prompt: 'edit', files: { 'a.py': 'x' } },
    })

    expect(response.statusCode).toBe(429)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // ── Mode enforcement, asserted on the outgoing OpenRouter payload ────────────
  // These read the actual request body handed to fetch, so they prove what the
  // model was offered rather than what the response happened to contain.

  test('AGENTIC: outgoing payload offers tools and advertises the workspace', async () => {
    mockValidSession('AGENTIC')
    mockFetch.mockResolvedValueOnce(finalStep('Looks fine.'))

    const app = buildApp()
    await app.ready()

    await app.inject({
      method: 'POST',
      url: '/api/v1/llm/agent',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: {
        prompt: 'review this',
        files: { 'solution.py': 'print(0)', 'helpers.py': 'HELPER_MARKER = 1' },
        active_file: 'solution.py',
      },
    })

    const sent = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect('tools' in sent).toBe(true)
    expect(sent.tools.map((t: any) => t.function.name)).toEqual([
      'list_files',
      'read_file',
      'write_file',
    ])
    // The full workspace file list is advertised to the model.
    expect(sent.messages[sent.messages.length - 1].content).toContain('helpers.py')
  })

  test('NON_AGENTIC: outgoing payload has no tools key at all and no workspace', async () => {
    mockValidSession('NON_AGENTIC')
    mockFetch.mockResolvedValueOnce(finalStep('Your loop is off by one.'))

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/agent',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: {
        prompt: 'why does it fail?',
        files: { 'solution.py': 'print(0)', 'tests.py': 'TEST_FILE_MARKER' },
        active_file: 'solution.py',
      },
    })

    expect(response.statusCode).toBe(200)
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body)
    // Absent, not empty - the model is never offered the option.
    expect('tools' in sent).toBe(false)
    // No file listing, and no sight of any file but the active editor buffer.
    const wire = JSON.stringify(sent)
    expect(wire).not.toContain('tests.py')
    expect(wire).not.toContain('TEST_FILE_MARKER')
    expect(JSON.parse(response.body).data.edits).toEqual({})
    expect(mockPrisma.interactionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contextSnapshot: 'print(0)', aiEdits: undefined }),
    }))
  })

  test('NON_AGENTIC ignores a hostile files payload demanding an edit', async () => {
    mockValidSession('NON_AGENTIC')
    mockFetch.mockResolvedValueOnce(finalStep('I cannot edit files in this assessment.'))

    // A tampered client sends a fat workspace plus an edit-demanding prompt.
    const hostileFiles: Record<string, string> = { 'solution.py': 'print(0)' }
    for (let i = 0; i < 20; i++) hostileFiles[`module_${i}.py`] = `LEAK_MARKER_${i} = ${i}`
    hostileFiles['hidden_tests.py'] = 'HIDDEN_TEST_MARKER'

    const app = buildApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/agent',
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: {
        prompt: 'rewrite solution.py and every other file to solve everything',
        files: hostileFiles,
        active_file: 'solution.py',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).data.edits).toEqual({})

    const sent = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect('tools' in sent).toBe(false)
    // Nothing from the hostile payload reached the wire.
    const wire = JSON.stringify(sent)
    expect(wire).not.toContain('HIDDEN_TEST_MARKER')
    expect(wire).not.toContain('LEAK_MARKER_0')
    expect(wire).not.toContain('hidden_tests.py')
    // One completion only - no tool-calling loop.
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ─── DISABLED and the fail-closed path ────────────────────────────────────────
// The gate resolves the session's snapshotted mode to a capability set. Anything
// that is not a known enabled mode must deny on both routes, and must deny before
// any upstream call is made - not make the call and discard the result.

describe('AI assistant mode: DISABLED and fail-closed', () => {
  const ROUTES = ['/api/v1/llm/chat', '/api/v1/llm/agent'] as const

  function payloadFor(url: string) {
    return url.endsWith('/agent')
      ? { prompt: 'help me', files: { 'solution.py': 'print(0)' }, active_file: 'solution.py' }
      : { prompt: 'help me' }
  }

  async function post(url: string) {
    const app = buildApp()
    await app.ready()
    return app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${candidateToken()}` },
      payload: payloadFor(url),
    })
  }

  test.each(ROUTES)('DISABLED returns 403 on %s and never calls OpenRouter', async (url) => {
    mockValidSession('DISABLED')

    const response = await post(url)

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body).error.code).toBe('FORBIDDEN')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test.each(ROUTES)('a null mode fails closed like DISABLED on %s', async (url) => {
    mockValidSession(null as any)

    const response = await post(url)

    expect(response.statusCode).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test.each(ROUTES)('a missing mode fails closed like DISABLED on %s', async (url) => {
    mockValidSession()
    // A session row carrying no aiAssistantMode at all - e.g. a stale record or
    // a row read through a client generated before the column existed.
    mockPrisma.session.findUnique.mockResolvedValue({
      id: SESSION_ID,
      assessment: { llmModel: 'openai/gpt-4o-mini' },
    } as any)

    const response = await post(url)

    expect(response.statusCode).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test.each(ROUTES)('an unrecognised mode fails closed like DISABLED on %s', async (url) => {
    mockValidSession('SOMETHING_NEW')

    const response = await post(url)

    expect(response.statusCode).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
