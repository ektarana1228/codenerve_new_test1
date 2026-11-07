jest.mock('./lib/retention', () => ({ startRetentionCleanup: jest.fn() }))
jest.mock('./routes/sessions', () => ({ sessionRoutes: jest.fn() }))

import { buildApp } from './app'
import { TEST_ENV } from './testEnv'

describe('API request parsing', () => {
  test('returns a client error for malformed JSON', async () => {
    const app = buildApp(TEST_ENV, { logger: false })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: '{invalid',
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('VALIDATION_ERROR')
    } finally {
      await app.close()
    }
  })
})
