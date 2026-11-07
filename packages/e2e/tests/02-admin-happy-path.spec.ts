/**
 * Suite 2 - Admin happy path
 *
 * Prerequisites (frontend data-testid contract):
 *
 *   /login
 *     [data-testid="email-input"]
 *     [data-testid="password-input"]
 *     [data-testid="login-btn"]
 *
 *   / or /assessments  (dashboard)
 *     [data-testid="create-assessment-btn"]
 *     [data-testid="assessment-item"]
 *
 *   /assessments/new  (create assessment form)
 *     [data-testid="assessment-title-input"]
 *     [data-testid="time-limit-input"]
 *     [data-testid="language-select"]
 *     [data-testid="code-weight-input"]
 *     [data-testid="aiu-weight-input"]
 *     [data-testid="save-assessment-btn"]
 *
 *   /assessments/:id  (assessment detail - problems tab)
 *     [data-testid="add-problem-btn"]
 *     [data-testid="problem-title-input"]
 *     [data-testid="problem-description-input"]
 *     [data-testid="problem-difficulty-select"]
 *     [data-testid="tc-input-0"]           - first test case input
 *     [data-testid="tc-expected-0"]        - first test case expected
 *     [data-testid="tc-hidden-0"]          - first test case hidden checkbox
 *     [data-testid="tc-input-1"]           - second test case input
 *     [data-testid="tc-expected-1"]        - second test case expected
 *     [data-testid="tc-hidden-1"]          - second test case hidden checkbox
 *     [data-testid="save-problem-btn"]
 *
 *   /assessments/:id  (assessment detail - invites tab)
 *     [data-testid="generate-invite-btn"]
 *     [data-testid="candidate-name-input"]
 *     [data-testid="generate-invite-submit"]
 *     [data-testid="invite-item"]          - repeated row per token
 *     [data-testid="invite-status"]        - text: "Unused" / "Used"
 *     [data-testid="invite-url"]           - the raw invite URL value
 *
 *   /assessments/:id  (assessment detail - leaderboard tab)
 *     [data-testid="leaderboard"]
 *     [data-testid="leaderboard-row"]
 *
 *   /assessments/:id  (assessment detail - reports tab)
 *     [data-testid="download-pdf-btn"]
 *
 * Note: Suite 2 uses the pre-seeded "E2E Scored Assessment" for leaderboard
 * and PDF checks. The creation flow targets a freshly-created assessment.
 */

import { test, expect, mockLlmChat, mockCodeRun, mockCodeSubmit } from '../fixtures'
import { buildInviteUrl } from '../helpers/api'
import { waitForEditor, typeInEditor } from '../helpers/editor'

const ADMIN_URL = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001'
const CANDIDATE_URL = process.env.CANDIDATE_BASE_URL ?? 'http://localhost:3000'

test.describe('Suite 2 - Admin happy path', () => {
  test('login → create assessment → generate invite → verify token states', async ({
    page,
    seedData,
    context,
  }) => {
    // ── 1. Admin logs in via the UI ───────────────────────────────────────────
    await page.goto('/login')
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible()

    await page.fill('[data-testid="email-input"]', seedData.admin.email)
    await page.fill('[data-testid="password-input"]', seedData.admin.password)
    await page.click('[data-testid="login-btn"]')

    // Should redirect to dashboard after successful login
    await expect(page).toHaveURL(/\/(assessments|dashboard|$)/, { timeout: 10_000 })

    // ── 2. Navigate to assessment creation ────────────────────────────────────
    await page.click('[data-testid="create-assessment-btn"]')
    await expect(page).toHaveURL(/\/assessments\/(new|create)/)

    // ── 3. Fill in assessment form ────────────────────────────────────────────
    await page.fill('[data-testid="assessment-title-input"]', 'Suite2 E2E Assessment')
    await page.fill('[data-testid="time-limit-input"]', '60')
    await page.selectOption('[data-testid="language-select"]', 'PYTHON')
    await page.fill('[data-testid="code-weight-input"]', '60')
    await page.fill('[data-testid="aiu-weight-input"]', '40')

    await page.click('[data-testid="save-assessment-btn"]')

    // Should redirect to the new assessment's detail page
    await expect(page).toHaveURL(/\/assessments\/[0-9a-f-]{36}/, { timeout: 10_000 })
    const assessmentUrl = page.url()
    const assessmentId = assessmentUrl.split('/').at(-1)!

    // ── 4. Add a problem with 1 visible + 1 hidden test case ──────────────────
    await page.click('[data-testid="add-problem-btn"]')

    await page.fill('[data-testid="problem-title-input"]', 'Reverse a String')
    await page.fill(
      '[data-testid="problem-description-input"]',
      '## Reverse a String\n\nWrite a function that reverses a string.',
    )
    await page.selectOption('[data-testid="problem-difficulty-select"]', 'EASY')

    // Visible test case
    await page.fill('[data-testid="tc-input-0"]', 'hello')
    await page.fill('[data-testid="tc-expected-0"]', 'olleh')
    // tc-hidden-0 unchecked = visible (default)

    // Hidden test case
    await page.fill('[data-testid="tc-input-1"]', 'world')
    await page.fill('[data-testid="tc-expected-1"]', 'dlrow')
    await page.check('[data-testid="tc-hidden-1"]')

    await page.click('[data-testid="save-problem-btn"]')

    // Confirm the problem was saved (problem title appears somewhere on the page)
    await expect(page.getByText('Reverse a String')).toBeVisible({ timeout: 10_000 })

    // ── 5. Generate an invite link ────────────────────────────────────────────
    // Switch to the invites tab / section
    await page.click('[data-testid="invites-tab"]')

    await page.click('[data-testid="generate-invite-btn"]')
    await page.fill('[data-testid="candidate-name-input"]', 'Suite2 Candidate')
    await page.click('[data-testid="generate-invite-submit"]')

    // The invite row appears in the list
    const inviteItems = page.locator('[data-testid="invite-item"]')
    await expect(inviteItems).toHaveCount(1, { timeout: 5_000 })

    // ── 6. Verify invite link appears as "Unused" ─────────────────────────────
    const firstInvite = inviteItems.first()
    await expect(firstInvite.locator('[data-testid="invite-status"]')).toContainText('Unused')

    // Capture the invite URL shown in the UI
    const inviteUrlText = await firstInvite.locator('[data-testid="invite-url"]').textContent()
    expect(inviteUrlText).toBeTruthy()
    // The URL should include the token in the query string
    expect(inviteUrlText).toMatch(/[?&]token=[0-9a-f-]{36}/)

    // Extract the raw token UUID from the URL
    const tokenMatch = inviteUrlText!.match(/token=([0-9a-f-]{36})/)
    expect(tokenMatch).toBeTruthy()
    const rawToken = tokenMatch![1]

    // ── 7. Candidate uses the invite link (in a new page / context) ───────────
    const candidatePage = await context.newPage()
    await mockLlmChat(candidatePage)
    await mockCodeRun(candidatePage)
    await mockCodeSubmit(candidatePage)

    await candidatePage.goto(buildInviteUrl(rawToken, CANDIDATE_URL))
    await candidatePage.click('[data-testid="language-python"]')
    await candidatePage.click('[data-testid="start-session-btn"]')

    // IDE loads
    await waitForEditor(candidatePage)

    // Candidate writes code and submits
    await typeInEditor(candidatePage, "def reverse(s): return s[::-1]\n")

    await candidatePage.click('[data-testid="submit-btn"]')
    await expect(candidatePage.locator('[data-testid="submit-dialog"]')).toBeVisible()
    await candidatePage.click('[data-testid="submit-confirm-btn"]')
    await expect(candidatePage.locator('[data-testid="submission-success"]')).toBeVisible({
      timeout: 10_000,
    })

    await candidatePage.close()

    // ── 8. Admin refreshes and verifies invite is now "Used" ──────────────────
    await page.reload()
    // Navigate back to the invites section if needed
    await page.click('[data-testid="invites-tab"]')

    await expect(inviteItems.first().locator('[data-testid="invite-status"]')).toContainText(
      'Used',
      { timeout: 10_000 },
    )

    // ── 9. Leaderboard - use the pre-seeded scored assessment ─────────────────
    // Navigate to the pre-scored assessment so there is definitely a ranked candidate.
    await page.goto(`${ADMIN_URL}/assessments/${seedData.scoredAssessment.id}`)
    await page.click('[data-testid="leaderboard-tab"]')

    await expect(page.locator('[data-testid="leaderboard"]')).toBeVisible()
    const leaderboardRows = page.locator('[data-testid="leaderboard-row"]')
    await expect(leaderboardRows).toHaveCount(1, { timeout: 10_000 })

    // The row should show the total score (77 from pre-seed)
    await expect(leaderboardRows.first()).toContainText('77')

    // ── 10. Download PDF ──────────────────────────────────────────────────────
    await page.click('[data-testid="reports-tab"]')

    // Playwright intercepts the download event
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-pdf-btn"]'),
    ])

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  })
})
