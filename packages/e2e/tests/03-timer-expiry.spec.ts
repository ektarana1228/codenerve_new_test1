import { test, expect, mockCodeSubmit } from '../fixtures'
import { startCandidateAssessment } from '../helpers/candidate'

test.setTimeout(120_000)

test('one-minute assessment submits when time expires', async ({ page, seedData }) => {
  await mockCodeSubmit(page)
  await startCandidateAssessment(page, seedData.tokens.suite3, 'Timer Candidate')

  const timer = page.locator('[aria-label$="remaining"]')
  await expect(timer).toBeVisible()
  await expect(timer).toHaveText(/00:[0-5]\d/)
  await expect(page.getByRole('heading', { name: /Time's up - submitted automatically/ })).toBeVisible({ timeout: 90_000 })
  await expect(page).toHaveURL(/\/complete\?status=expired$/)
})
