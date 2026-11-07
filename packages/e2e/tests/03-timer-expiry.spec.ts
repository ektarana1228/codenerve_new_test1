/**
 * Suite 3 - Timer expiry
 *
 * Uses the 1-minute timer assessment seeded in global-setup.
 * The test starts a session, does nothing, and waits for the timer to reach
 * zero so the platform can auto-submit.
 *
 * test.setTimeout is extended to 120 s to allow the full 60-second countdown
 * plus page interaction overhead.
 *
 * Prerequisites (frontend data-testid contract):
 *   [data-testid="session-timer"]   - visible countdown (e.g. "0:59", "0:00")
 *   [data-testid="times-up-banner"] - shown when timer hits zero
 *   [data-testid="vscode-frame"]    - editor, must be read-only after expiry
 *   [data-testid="chat-input"]      - must be hidden/disabled after expiry
 */

import { test, expect, mockLlmChat, mockCodeRun, mockCodeSubmit } from '../fixtures'
import { buildInviteUrl } from '../helpers/api'
import { waitForEditor, expectEditorReadonly } from '../helpers/editor'

test.describe('Suite 3 - Timer expiry', () => {
  // Allow 2 minutes: 1 min timer + overhead
  test.setTimeout(120_000)

  test('session auto-submits when 1-minute timer expires', async ({ page, seedData }) => {
    // ── Set up mocks so auto-submit does not fail on sandbox absence ──────────
    await mockLlmChat(page)
    await mockCodeRun(page)
    await mockCodeSubmit(page)

    // ── Open the invite for the 1-minute timer assessment ─────────────────────
    await page.goto(buildInviteUrl(seedData.tokens.suite3))

    await expect(page.locator('[data-testid="invite-landing"]')).toBeVisible()
    await page.click('[data-testid="language-python"]')
    await page.click('[data-testid="start-session-btn"]')

    // IDE loads; timer starts
    await waitForEditor(page)

    // Confirm the timer widget is visible and ticking
    const timer = page.locator('[data-testid="session-timer"]')
    await expect(timer).toBeVisible()

    // The assessment has a 1-minute limit (60 seconds).
    // Optionally verify the initial reading is close to 1:00 (allow for slight drift).
    const initialText = await timer.textContent()
    expect(initialText).toMatch(/^0:[0-5]\d$/) // "0:XX" format

    // ── Wait for timer to reach zero and auto-submit to fire ──────────────────
    // The auto-submit triggers on the client when the countdown hits 0:00.
    // We wait for the "Time's up" banner with a timeout generous enough to cover
    // the remaining time regardless of when this assertion starts.
    await expect(page.locator('[data-testid="times-up-banner"]')).toBeVisible({
      timeout: 90_000,
    })

    // The banner text should communicate auto-submission
    await expect(page.locator('[data-testid="times-up-banner"]')).toContainText("Time's up")

    // ── Verify post-expiry locked state ───────────────────────────────────────
    // IDE is now read-only (workspace reloaded with files.readonlyInclude)
    await expectEditorReadonly(page)

    // Chat panel is closed/hidden
    await expect(page.locator('[data-testid="chat-input"]')).toBeHidden()

    // Timer should show 0:00 (stopped)
    await expect(timer).toContainText('0:00')
  })
})
