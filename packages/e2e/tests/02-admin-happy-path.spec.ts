import { test, expect } from '../fixtures'

test('admin can sign in, inspect an assessment, and generate an invite', async ({ page, seedData }) => {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email address' }).fill(seedData.admin.email)
  await page.getByLabel('Password').fill(seedData.admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.goto(`/assessments/${seedData.standardAssessment.id}`)
  await expect(page.getByRole('heading', { name: 'E2E Standard Assessment' })).toBeVisible()
  await page.getByRole('button', { name: 'Generate Invite Link' }).click()
  await page.getByPlaceholder('Alice Smith').fill('New E2E Candidate')
  await page.getByPlaceholder('alice@company.com').fill('new-e2e-candidate@test.local')
  await page.getByRole('button', { name: 'Generate Link' }).click()
  await expect(page.getByText('Invite link created')).toBeVisible()
  const inviteUrl = await page.locator('input[readonly]').inputValue()
  expect(inviteUrl).toContain('/start?token=')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('New E2E Candidate')).toBeVisible()

  await page.goto(`/assessments/${seedData.scoredAssessment.id}/leaderboard`)
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()
  await expect(page.getByText('E2E Scored Candidate')).toBeVisible()
})
