jest.mock('@platform/db', () => ({
  prisma: {
    session: { findUnique: jest.fn() },
    proctorEvent: { create: jest.fn(), findMany: jest.fn() },
    proctorMedia: { findFirst: jest.fn(), findMany: jest.fn() },
    mobilePairing: { findUnique: jest.fn(), deleteMany: jest.fn() },
  },
}))
jest.mock('./sessions', () => ({ sessionRoutes: jest.fn() }))
jest.mock('../lib/retention', () => ({ startRetentionCleanup: jest.fn() }))

import jwt from 'jsonwebtoken'
import { prisma } from '@platform/db'
import { buildApp } from '../app'
import { TEST_ENV } from '../testEnv'

const secret = 'test-secret-at-least-32-characters-long!!'
const sessionId = '550e8400-e29b-41d4-a716-446655440001'
const candidateId = '550e8400-e29b-41d4-a716-446655440002'
const env = { ...TEST_ENV, JWT_SECRET: secret }

test('candidate can only write a validated event for their own session', async () => {
  jest.mocked(prisma.session.findUnique).mockResolvedValue({ id: sessionId } as never)
  jest.mocked(prisma.proctorEvent.create).mockResolvedValue({
    id: '550e8400-e29b-41d4-a716-446655440003',
    createdAt: new Date(),
  } as never)
  const token = jwt.sign({ sub: candidateId, role: 'STUDENT', session_id: sessionId }, secret, { expiresIn: '1h' })
  const app = buildApp(env)

  const accepted = await app.inject({
    method: 'POST',
    url: `/api/v1/proctoring/sessions/${sessionId}/events`,
    headers: { authorization: `Bearer ${token}` },
    payload: { source: 'SYSTEM', type: 'SYSTEM_CHECK_STARTED' },
  })
  expect(accepted.statusCode).toBe(201)

  const rejected = await app.inject({
    method: 'POST',
    url: '/api/v1/proctoring/sessions/550e8400-e29b-41d4-a716-446655440099/events',
    headers: { authorization: `Bearer ${token}` },
    payload: { type: 'UNKNOWN_EVENT' },
  })
  expect(rejected.statusCode).toBe(400)
})

test('required assessment checks cannot be skipped', async () => {
  jest.mocked(prisma.session.findUnique).mockResolvedValue({
    id: sessionId,
    assessment: {
      screenRecording: 'OFF',
      videoProctoring: 'REQUIRED',
      microphoneRecording: 'OFF',
      secondCamera: 'OFF',
    },
  } as never)
  jest.mocked(prisma.proctorEvent.create).mockResolvedValue({ id: 'event-id' } as never)
  const token = jwt.sign({ sub: candidateId, role: 'STUDENT', session_id: sessionId }, secret, { expiresIn: '1h' })
  const app = buildApp(env)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/proctoring/sessions/${sessionId}/checks/complete`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      checks: {
        browser: 'passed',
        connection: 'passed',
        camera: 'skipped',
        microphone: 'skipped',
        screen: 'skipped',
        mobile: 'skipped',
      },
    },
  })

  expect(response.statusCode).toBe(200)
  expect(JSON.parse(response.body).data.can_proceed).toBe(false)
  expect(prisma.proctorEvent.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ eventType: 'SYSTEM_CHECK_FAILED' }) }),
  )
})

test('recording upload rejects bytes that are not WebM', async () => {
  jest.mocked(prisma.session.findUnique).mockResolvedValue({
    id: sessionId,
    assessment: { screenRecording: 'REQUIRED', videoProctoring: 'OFF', microphoneRecording: 'OFF' },
  } as never)
  jest.mocked(prisma.proctorMedia.findFirst).mockResolvedValue(null)
  const token = jwt.sign({ sub: candidateId, role: 'STUDENT', session_id: sessionId }, secret, { expiresIn: '1h' })
  const app = buildApp(env)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/proctoring/sessions/${sessionId}/recordings`,
    headers: { authorization: `Bearer ${token}` },
    payload: { kind: 'SCREEN_RECORDING', mime_type: 'video/webm', data: Buffer.from('not webm').toString('base64') },
  })
  expect(response.statusCode).toBe(400)
})
