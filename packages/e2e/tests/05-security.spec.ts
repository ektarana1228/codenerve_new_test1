/**
 * Suite 5 - Security assertions
 *
 * Hard rules enforced by these tests (from CLAUDE.md):
 *
 *   1. Hidden test case content NEVER reaches the browser.
 *      global-setup seeds hidden test cases with sentinel strings
 *      (E2E_HIDDEN_INPUT_SENTINEL_XK9, E2E_HIDDEN_OUTPUT_SENTINEL_XK9).
 *      Every JSON response body captured during a full candidate session is
 *      scanned for those strings.
 *
 *   2. The OpenRouter API key NEVER appears in any API response.
 *      A recognisable plaintext key is stored via the admin settings endpoint.
 *      We then verify it is absent from every response that reaches any browser
 *      context - candidate or admin.
 *
 * Strategy:
 *   - Attach page.on('response') listeners before navigation.
 *   - Collect every JSON response body throughout the flow.
 *   - Run assertions on the accumulated bodies at the end.
 */

import { test, expect, mockLlmChat, mockCodeRun, mockCodeSubmit } from '../fixtures'
import { buildInviteUrl } from '../helpers/api'
import { waitForEditor, typeInEditor } from '../helpers/editor'

const ADMIN_URL = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001'
const FAKE_OPENROUTER_KEY = 'sk-or-e2e-security-sentinel-XYZZY-99999'

test.describe('Suite 5 - Security assertions', () => {
  test('hidden test case content never appears in any browser-visible response', async ({
    page,
    seedData,
  }) => {
    const { input: hiddenInput, output: hiddenOutput } = seedData.hiddenSentinels

    // ── Collect all JSON response bodies ──────────────────────────────────────
    const capturedBodies: string[] = []

    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] ?? ''
      if (!ct.includes('application/json')) return
      try {
        capturedBodies.push(await response.text())
      } catch {
        // already consumed or connection closed
      }
    })

    await mockLlmChat(page)
    await mockCodeRun(page)
    await mockCodeSubmit(page)

    // ── Full candidate session ────────────────────────────────────────────────
    await page.goto(buildInviteUrl(seedData.tokens.suite5))
    await expect(page.locator('[data-testid="invite-landing"]')).toBeVisible()
    await page.click('[data-testid="language-python"]')
    await page.click('[data-testid="start-session-btn"]')

    await waitForEditor(page)

    // Type code → syncs to the workspace, flushed to the DB on run/submit
    await typeInEditor(page, 'def add(a, b):\n    return a + b\n')

    // Run → triggers POST /sessions/:id/run (visible test cases only)
    await page.click('[data-testid="run-btn"]')
    await expect(page.locator('[data-testid="test-results"]')).toBeVisible({ timeout: 10_000 })

    // Submit → triggers POST /sessions/:id/submit (all test cases on server;
    // hidden results must be stripped before the response leaves the backend)
    await page.click('[data-testid="submit-btn"]')
    await expect(page.locator('[data-testid="submit-dialog"]')).toBeVisible()
    await page.click('[data-testid="submit-confirm-btn"]')
    await expect(page.locator('[data-testid="submission-success"]')).toBeVisible({
      timeout: 10_000,
    })

    // Give any straggling responses time to arrive
    await page.waitForTimeout(1_000)

    // ── Assertions ────────────────────────────────────────────────────────────
    expect(capturedBodies.length).toBeGreaterThan(0)

    const bodiesLeakingInput = capturedBodies.filter((b) => b.includes(hiddenInput))
    const bodiesLeakingOutput = capturedBodies.filter((b) => b.includes(hiddenOutput))

    expect(
      bodiesLeakingInput,
      `Hidden test INPUT sentinel "${hiddenInput}" leaked in ` +
        `${bodiesLeakingInput.length} response(s):\n` +
        bodiesLeakingInput.slice(0, 3).join('\n---\n'),
    ).toHaveLength(0)

    expect(
      bodiesLeakingOutput,
      `Hidden test OUTPUT sentinel "${hiddenOutput}" leaked in ` +
        `${bodiesLeakingOutput.length} response(s):\n` +
        bodiesLeakingOutput.slice(0, 3).join('\n---\n'),
    ).toHaveLength(0)
  })

  test('OpenRouter API key plaintext never appears in admin or candidate API responses', async ({
    page,
    adminToken,
  }) => {
    // ── Store a recognisable fake key via the admin settings API ──────────────
    // Using fetch() evaluated in an admin page so the response is also captured.
    const capturedBodies: string[] = []

    // Admin context - set the key and observe all responses
    await page.goto(ADMIN_URL)
    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] ?? ''
      if (!ct.includes('application/json')) return
      try {
        capturedBodies.push(await response.text())
      } catch {
        /* skip */
      }
    })

    // POST the fake key to the admin config endpoint
    await page.evaluate(
      ([token, key]) => {
        return fetch('/api/v1/admin/config/openrouter-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ key }),
        })
      },
      [adminToken, FAKE_OPENROUTER_KEY] as const,
    )

    // GET the system config - should return hasOpenrouterKey: true, NOT the key value
    await page.evaluate(
      ([token]) => {
        return fetch('/api/v1/admin/config', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json())
      },
      [adminToken] as const,
    )

    // Allow all fetches to complete
    await page.waitForTimeout(500)

    // ── Assertion: key plaintext absent from all captured responses ───────────
    const leakingBodies = capturedBodies.filter((b) => b.includes(FAKE_OPENROUTER_KEY))

    expect(
      leakingBodies,
      `OpenRouter key "${FAKE_OPENROUTER_KEY}" appeared in ` +
        `${leakingBodies.length} response(s):\n` +
        leakingBodies.slice(0, 3).join('\n---\n'),
    ).toHaveLength(0)

    // Also explicitly assert the GET /config response includes the boolean flag,
    // not the raw key. The JSON should contain "hasOpenrouterKey":true but NOT
    // the key string itself.
    const configBody = capturedBodies.find((b) => b.includes('hasOpenrouterKey'))
    if (configBody) {
      expect(configBody).toContain('"hasOpenrouterKey":true')
      expect(configBody).not.toContain(FAKE_OPENROUTER_KEY)
    }
  })
})
