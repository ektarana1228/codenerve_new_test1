import { afterEach, describe, expect, test, vi } from 'vitest'
import { connectMobileProctor, heartbeatMobileProctor, uploadMobileRecording } from './client'

// Regression guard: a bodyless mobile request must NOT send Content-Type: application/json.
// Fastify rejects an empty body with that header (FST_ERR_CTP_EMPTY_JSON_BODY), which the
// api-core global handler surfaced as a 500 and broke second-camera pairing.

function mockFetch(status = 200, body: unknown = { data: {} }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function headersOf(fetchMock: ReturnType<typeof mockFetch>): Record<string, string> {
  return (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mobileFetch content-type', () => {
  test('connect (no body) omits Content-Type', async () => {
    const fetchMock = mockFetch(200, { data: { session_id: 's1' } })
    await connectMobileProctor('tok')
    expect(headersOf(fetchMock)['Content-Type']).toBeUndefined()
    expect(headersOf(fetchMock).Authorization).toBe('Pairing tok')
  })

  test('heartbeat (no body) omits Content-Type', async () => {
    const fetchMock = mockFetch(204)
    await heartbeatMobileProctor('tok')
    expect(headersOf(fetchMock)['Content-Type']).toBeUndefined()
  })

  test('recording upload (has body) sends Content-Type', async () => {
    const fetchMock = mockFetch(201, { data: { id: 'm1' } })
    await uploadMobileRecording('tok', 'video/webm', 'AAAA')
    expect(headersOf(fetchMock)['Content-Type']).toBe('application/json')
  })
})
