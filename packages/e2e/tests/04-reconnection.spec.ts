import { test, expect } from '../fixtures'
import { replaceEditorCode, startCandidateAssessment } from '../helpers/candidate'

test.setTimeout(60_000)

test('offline edit is replaced by the saved code on reconnect', async ({ page, seedData }) => {
  await startCandidateAssessment(page, seedData.tokens.suite4, 'Reconnect Candidate')

  const saved = page.waitForResponse((response) =>
    /\/api\/v1\/sessions\/[^/]+\/code$/.test(response.url()) && response.request().method() === 'PATCH' && response.ok(),
  )
  await replaceEditorCode(page, 'def multiply(a, b):\n    return a * b\n')
  await saved

  await page.context().setOffline(true)
  await replaceEditorCode(page, 'def offline_edit():\n    pass\n')
  await expect(page.getByRole('status').filter({ hasText: /Reconnecting/ })).toBeVisible({ timeout: 10_000 })

  await page.context().setOffline(false)
  await expect(page.getByRole('status').filter({ hasText: /Reconnecting/ })).toBeHidden({ timeout: 20_000 })
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('multiply')
  await expect(page.locator('.monaco-editor .view-lines').first()).not.toContainText('offline_edit')
})
