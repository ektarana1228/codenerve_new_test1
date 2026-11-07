jest.mock('@platform/db', () => ({
  prisma: {
    session: { findUnique: jest.fn() },
    mobilePairing: { upsert: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    proctorEvent: { create: jest.fn() },
  },
}))

import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from '@platform/db'
import { pairingRoutes } from './proctorPairing'
import { makeAuthHooks } from '../plugins/authenticate'
import { TEST_ENV } from '../testEnv'

const sessionId = '550e8400-e29b-41d4-a716-446655440001'
const candidateId = '550e8400-e29b-41d4-a716-446655440002'
const otherSessionId = '550e8400-e29b-41d4-a716-446655440003'

function buildApp() {
  const app = Fastify({ logger: false })
  app.register(pairingRoutes, { env: TEST_ENV, authHooks: makeAuthHooks(TEST_ENV.JWT_SECRET) })
  return app
}

function candidateToken(id = sessionId) {
  return jwt.sign({ sub: candidateId, role: 'STUDENT', session_id: id }, TEST_ENV.JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => jest.clearAllMocks())

test('creates a pairing link and stores only the token hash', async () => {
  jest.mocked(prisma.session.findUnique).mockResolvedValue({
    id: sessionId,
    assessment: { secondCamera: 'REQUIRED', timeLimitMinutes: 60 },
  } as never)
  const app = buildApp()
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/proctoring/sessions/${sessionId}/mobile-pairing`,
      headers: { authorization: `Bearer ${candidateToken()}` },
    })

    expect(response.statusCode).toBe(201)
    const url = new URL(response.json().data.pairing_url)
    expect(url.pathname).toBe('/mobile-proctor')
    const token = url.searchParams.get('pair')
    expect(token).toBeTruthy()
    expect(prisma.mobilePairing.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        sessionId,
        tokenHash: createHash('sha256').update(token!).digest('hex'),
      }),
    }))
  } finally {
    await app.close()
  }
})

test('rejects pairing requests for another candidate session', async () => {
  const app = buildApp()
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/proctoring/sessions/${otherSessionId}/mobile-pairing`,
      headers: { authorization: `Bearer ${candidateToken()}` },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma.session.findUnique).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('rejects an invalid mobile pairing token', async () => {
  jest.mocked(prisma.mobilePairing.findFirst).mockResolvedValue(null)
  const app = buildApp()
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/proctoring/mobile/connect',
      headers: { authorization: 'Pairing invalid-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(prisma.mobilePairing.update).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})
