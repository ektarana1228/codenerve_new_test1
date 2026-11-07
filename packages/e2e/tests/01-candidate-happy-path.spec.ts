/**
 * Suite 1 - Candidate happy path
 *
 * Prerequisites (frontend data-testid contract):
 *
 *   /start?token=<uuid>          - invite landing page
 *     [data-testid="invite-landing"]
 *     [data-testid="language-python"]   - radio/button selecting Python
 *     [data-testid="start-session-btn"] - confirm language + start session
 *
 *   /session (or wherever the app routes after session start)
 *     [data-testid="vscode-frame"]       - embedded VS Code iframe (see helpers/editor)
 *     [data-testid="autosave-indicator"] - shows "Saved" / "Saving…"
 *     [data-testid="run-btn"]
 *     [data-testid="submit-btn"]
 *     [data-testid="test-results"]
 *     [data-testid="chat-input"]
 *     [data-testid="chat-send-btn"]
 *     [data-testid="chat-message"]      - repeated for each message
 *     [data-testid="submit-dialog"]     - confirmation dialog
 *     [data-testid="submit-confirm-btn"]
 *     [data-testid="submission-success"]
 */

import { test, expect, mockLlmChat, mockCodeRun, mockCodeSubmit } from '../fixtures'
import { buildInviteUrl } from '../helpers/api'
import { waitForEditor, typeInEditor, expectEditorReadonly } from '../helpers/editor'

test.describe('Suite 1 - Candidate happy path', () => {
  test('full candidate flow: join → code → AI chat → run → submit', async ({
    page,
    seedData,
  }) => {
    // ── 1. Set up mocks before navigation ────────────────────────────────────
    await mockLlmChat(page)
    await mockCodeRun(page)
    await mockCodeSubmit(page)

    // ── 2. Open invite link ───────────────────────────────────────────────────
    await page.goto(buildInviteUrl(seedData.tokens.suite1))

    await expect(page.locator('[data-testid="invite-landing"]')).toBeVisible()

    // ── 3. Select language ────────────────────────────────────────────────────
    await page.click('[data-testid="language-python"]')
    await page.click('[data-testid="start-session-btn"]')

    // ── 4. IDE loads ──────────────────────────────────────────────────────────
    // The editor is a full VS Code served in a same-origin iframe. Autocomplete
    // is disabled via the orchestrator's locked settings layer (config-layer.ts),
    // not a parent-DOM option - so it is asserted at that layer, not here.
    await waitForEditor(page)

    // ── 5. Type code and verify auto-save indicator ───────────────────────────
    await typeInEditor(page, 'def add(a, b):\n    return a + b\n')

    // Autosave now flushes the workspace to the DB on a 10 s cadence (there is no
    // per-keystroke debounce across the iframe boundary), so allow one full cycle.
    await expect(page.locator('[data-testid="autosave-indicator"]')).toContainText('Saved', {
      timeout: 12_000,
    })

    // ── 6. Send 3 AI prompts and verify responses appear in chat ──────────────
    const chatInput = page.locator('[data-testid="chat-input"]')
    const sendBtn = page.locator('[data-testid="chat-send-btn"]')

    const prompts = [
      'How do I write a function that adds two numbers in Python?',
      'What is the syntax for integer addition?',
      'Can you explain how to handle edge cases like negative numbers?',
    ]

    for (const prompt of prompts) {
      await chatInput.fill(prompt)
      await sendBtn.click()
      // Wait for the AI response message to appear
      await expect(page.locator('[data-testid="chat-message"]').last()).toContainText(
        'Mock AI response',
        { timeout: 10_000 },
      )
    }

    // Verify 6 messages total: 3 user + 3 assistant
    await expect(page.locator('[data-testid="chat-message"]')).toHaveCount(6)

    // ── 7. Click Run → visible test results appear ────────────────────────────
    await page.click('[data-testid="run-btn"]')

    await expect(page.locator('[data-testid="test-results"]')).toBeVisible({ timeout: 10_000 })
    // Both visible test cases should pass
    const passedResults = page.locator('[data-testid="test-result-row"][data-status="pass"]')
    await expect(passedResults).toHaveCount(2, { timeout: 10_000 })

    // ── 8. Click Submit → confirm dialog → submit → IDE locks → chat closes ───
    await page.click('[data-testid="submit-btn"]')

    // Confirm dialog must appear
    await expect(page.locator('[data-testid="submit-dialog"]')).toBeVisible()

    // Click the confirm button
    await page.click('[data-testid="submit-confirm-btn"]')

    // ── 9. Verify post-submission state ───────────────────────────────────────
    // "Assessment submitted" confirmation shown
    await expect(page.locator('[data-testid="submission-success"]')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('[data-testid="submission-success"]')).toContainText(
      'Assessment submitted',
    )

    // IDE is now read-only (workspace re-loaded with files.readonlyInclude).
    await expectEditorReadonly(page)

    // Chat panel is closed/hidden after submission
    await expect(page.locator('[data-testid="chat-input"]')).toBeHidden()
  })
})
