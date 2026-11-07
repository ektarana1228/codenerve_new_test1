import { test, expect, mockCodeRun, mockCodeSubmit } from '../fixtures'
import { replaceEditorCode, startCandidateAssessment } from '../helpers/candidate'

test.setTimeout(60_000)

test('candidate can join, write code, run, and submit', async ({ page, seedData }) => {
  await mockCodeRun(page)
  await mockCodeSubmit(page)

  await startCandidateAssessment(page, seedData.tokens.suite1, 'Suite One Candidate')
  await replaceEditorCode(page, 'def add(a, b):\n    return a + b\n')

  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('2 / 2 testcases passed')).toBeVisible()

  await page.getByRole('button', { name: 'Submit', exact: true }).first().click()
  await expect(page.getByText('Are you sure? You cannot undo this.')).toBeVisible()
  await page.getByRole('button', { name: 'Submit', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: 'Assessment submitted' })).toBeVisible()
})
