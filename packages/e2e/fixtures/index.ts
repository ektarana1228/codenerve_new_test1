import { test as base, type Page } from '@playwright/test'
import { loadSeedData, type SeedData } from '../helpers/seed'
import { adminLoginDirect } from '../helpers/api'

type E2EFixtures = {
  /** Loaded once per test from .test-data.json written by global-setup. */
  seedData: SeedData
  /** A valid admin JWT, fetched fresh for each test. */
  adminToken: string
  /**
   * Injects the admin JWT into a page's localStorage so that page loads as
   * already-authenticated without going through the login form.
   * The page must have already navigated to the admin app origin first.
   */
  injectAdminAuth: (page: Page, token?: string) => Promise<void>
}

export const test = base.extend<E2EFixtures>({
  seedData: async ({}, use) => {
    await use(loadSeedData())
  },

  adminToken: async ({ seedData }, use) => {
    const token = await adminLoginDirect(seedData.admin.email, seedData.admin.password)
    await use(token)
  },

  injectAdminAuth: async ({ adminToken }, use) => {
    const inject = async (page: Page, token?: string) => {
      const jwt = token ?? adminToken
      // Zustand persist stores state under the key defined in the store: 'admin-auth'.
      await page.evaluate((t) => {
        localStorage.setItem(
          'admin-auth',
          JSON.stringify({ state: { admin_token: t, admin_user: { id: 'e2e-injected' } }, version: 0 }),
        )
      }, jwt)
    }
    await use(inject)
  },
})

export { expect } from '@playwright/test'

// ─── LLM chat mock ────────────────────────────────────────────────────────────

/**
 * Intercepts the candidate assistant endpoint and returns stub responses.
 * The turn_number increments with each call so the UI can render correct
 * conversation order.
 */
export async function mockLlmChat(page: Page): Promise<void> {
  let turn = 0
  await page.route('**/api/v1/llm/agent', async (route) => {
    turn++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          response: `Mock AI response #${turn}. Here is some helpful guidance for your code.`,
          edits: {},
          turn_number: turn,
        },
      }),
    })
  })
}

// ─── Code execution mocks ─────────────────────────────────────────────────────

/**
 * Intercepts POST /api/v1/sessions/:id/run and returns two passing visible
 * test case results so the test does not require the Docker sandbox runner.
 */
export async function mockCodeRun(page: Page): Promise<void> {
  await page.route('**/api/v1/sessions/*/run', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          status: 'completed',
          passed: 2,
          failed: 0,
          results: [
            { testCaseId: 'mock-tc-1', status: 'pass', stdout: '3\n', stderr: '' },
            { testCaseId: 'mock-tc-2', status: 'pass', stdout: '0\n', stderr: '' },
          ],
        },
      }),
    })
  })
}

/**
 * Intercepts POST /api/v1/sessions/:id/submit.
 * Returns the submission-accepted response without hitting the sandbox.
 * Note: the session is NOT marked SUBMITTED in the DB when this mock is active.
 */
export async function mockCodeSubmit(page: Page): Promise<void> {
  await page.route('**/api/v1/sessions/*/submit', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { message: 'Assessment submitted. Results are being processed.' },
      }),
    })
  })
}
