import { expect, type Page, type FrameLocator } from '@playwright/test'

/**
 * Editor helpers for the embedded VS Code.
 *
 * The candidate editor is now a full VS Code served in a same-origin <iframe>
 * (data-testid="vscode-frame"), not an in-page Monaco instance - so tests reach
 * the editor through a frameLocator instead of `.monaco-editor` on the page.
 *
 * In CI the orchestrator runs in stub mode (VSCODE_MODE=stub): the frame renders
 * a minimal same-origin editor whose textarea is `#editor` and whose file tabs
 * are `.tab`. Real openvscode-server also renders `.monaco-editor` inside the
 * same frame, so `editorFrame(page).locator('.monaco-editor')` works there too.
 */

export const VSCODE_FRAME = '[data-testid="vscode-frame"]'

export function editorFrame(page: Page): FrameLocator {
  return page.frameLocator(VSCODE_FRAME)
}

// Wait until the editor iframe is mounted and its textarea is ready.
export async function waitForEditor(page: Page): Promise<void> {
  await expect(page.locator(VSCODE_FRAME)).toBeVisible({ timeout: 20_000 })
  await expect(editorFrame(page).locator('#editor')).toBeVisible({ timeout: 20_000 })
}

// Replace the active file's contents with `text`.
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const area = editorFrame(page).locator('#editor')
  await area.click()
  await area.fill(text)
}

export async function appendInEditor(page: Page, text: string): Promise<void> {
  const area = editorFrame(page).locator('#editor')
  await area.click()
  await area.press('End')
  await area.pressSequentially(text)
}

export async function readEditor(page: Page): Promise<string> {
  return editorFrame(page).locator('#editor').inputValue()
}

// Assert the editor is read-only (post-submission lock).
export async function expectEditorReadonly(page: Page): Promise<void> {
  await expect(editorFrame(page).locator('#editor')).toHaveAttribute('readonly', /.*/, {
    timeout: 10_000,
  })
}
