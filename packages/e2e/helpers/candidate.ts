import { expect, type Page } from '@playwright/test'
import { buildInviteUrl } from './api'

/** Follow the same onboarding steps as a candidate using an emailed invite. */
export async function startCandidateAssessment(page: Page, token: string, name: string): Promise<void> {
  await page.goto(buildInviteUrl(token))
  await page.getByRole('textbox', { name: 'Full name' }).fill(name)
  await page.getByRole('textbox', { name: 'Email address' }).fill(`${name.toLowerCase().replace(/\s+/g, '-')}@test.local`)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'System check' })).toBeVisible()
  await page.getByRole('checkbox', { name: /read and understood/i }).check()
  await page.getByRole('button', { name: 'Run system check' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: /Python/ }).click()
  await page.getByRole('button', { name: /Begin assessment/ }).click()
  await expect(page).toHaveURL(/\/assess$/)
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
}

export async function replaceEditorCode(page: Page, code: string): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(code)
}
