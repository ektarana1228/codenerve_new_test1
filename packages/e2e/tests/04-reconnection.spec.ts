/**
 * Suite 4 - Reconnection
 *
 * Simulates a network drop during an active session and verifies the platform:
 *   1. Shows a "Reconnecting…" banner while offline.
 *   2. Restores the editor code from the server (not local state) on reconnect.
 *
 * How the network simulation works:
 *   page.context().setOffline(true)  - blocks ALL HTTP from this browser context.
 *   page.context().setOffline(false) - restores connectivity.
 *
 * The reconnection flow (per CLAUDE.md):
 *   - Client detects fetch failure (TypeError) → dispatches 'connection-lost' event.
 *   - ConnectionBanner retries every 3 s for 60 s.
 *   - On reconnect: GET /api/v1/sessions/:id returns current_code from DB.
 *   - Editor rehydrates from server response - never trusts in-memory state.
 *
 * Prerequisites (frontend data-testid contract):
 *   [data-testid="reconnect-banner"]    - "You've been disconnected. Reconnecting…"
 *   [data-testid="vscode-frame"]        - embedded VS Code iframe (see helpers/editor)
 *   [data-testid="autosave-indicator"]  - shows save state
 *
 * With embedded VS Code the code lives in the container workspace and is synced to
 * Session.currentCode. On reconnect the frame re-ensures and reloads from the DB,
 * so an unsaved offline edit is discarded - same guarantee as before.
 */

import { test, expect, mockLlmChat, mockCodeRun, mockCodeSubmit } from '../fixtures'
import { buildInviteUrl } from '../helpers/api'
import { waitForEditor, typeInEditor, appendInEditor, readEditor } from '../helpers/editor'

test.describe('Suite 4 - Reconnection', () => {
  test('reconnect banner shows on drop; code restored from server on reconnect', async ({
    page,
    seedData,
  }) => {
    // ── Set up mocks ──────────────────────────────────────────────────────────
    await mockLlmChat(page)
    await mockCodeRun(page)
    await mockCodeSubmit(page)

    // ── 1. Start a session ────────────────────────────────────────────────────
    await page.goto(buildInviteUrl(seedData.tokens.suite4))
    await expect(page.locator('[data-testid="invite-landing"]')).toBeVisible()
    await page.click('[data-testid="language-python"]')
    await page.click('[data-testid="start-session-btn"]')

    await waitForEditor(page)

    // ── 2. Type code and wait for it to auto-save to the DB ───────────────────
    const editorCode = 'def multiply(a, b):\n    return a * b\n'

    await typeInEditor(page, editorCode)

    // Wait for the workspace flush to persist to the DB (10 s cadence).
    await expect(page.locator('[data-testid="autosave-indicator"]')).toContainText('Saved', {
      timeout: 12_000,
    })

    // ── 3. Simulate network drop ──────────────────────────────────────────────
    await page.context().setOffline(true)

    // Trigger a network request to surface the disconnection (e.g. try to save again)
    await appendInEditor(page, ' # offline edit')

    // The "connection-lost" CustomEvent fires → reconnect banner appears.
    await expect(page.locator('[data-testid="reconnect-banner"]')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('[data-testid="reconnect-banner"]')).toContainText('Reconnecting')

    // ── 4. Restore the network ────────────────────────────────────────────────
    await page.context().setOffline(false)

    // The client retries every 3 s. Allow up to 20 s for reconnection.
    await expect(page.locator('[data-testid="reconnect-banner"]')).toBeHidden({ timeout: 20_000 })

    // ── 5. Verify code is restored from server ────────────────────────────────
    // After reconnect the client calls GET /api/v1/sessions/:id and
    // populates the editor with current_code from the DB (not in-memory state).
    // The locally-typed " # offline edit" should NOT appear because the server
    // only has the pre-drop code (the offline edit was never saved).
    await waitForEditor(page)
    const editorContent = await readEditor(page)
    expect(editorContent).toContain('multiply')
    expect(editorContent).not.toContain('offline edit')
  })
})
