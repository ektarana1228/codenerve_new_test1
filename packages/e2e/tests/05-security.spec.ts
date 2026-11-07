import { PrismaClient } from '@prisma/client'
import { test, expect, mockCodeRun, mockCodeSubmit } from '../fixtures'
import { replaceEditorCode, startCandidateAssessment } from '../helpers/candidate'

const ADMIN_URL = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001'
const KEY_SENTINEL = 'sk-or-e2e-security-sentinel-XYZZY-99999'

test('hidden test cases stay out of candidate responses', async ({ page, seedData }) => {
  const bodies: Promise<string>[] = []
  page.on('response', (response) => {
    if (response.headers()['content-type']?.includes('application/json')) {
      bodies.push(response.text().catch(() => ''))
    }
  })
  await mockCodeRun(page)
  await mockCodeSubmit(page)

  await startCandidateAssessment(page, seedData.tokens.suite5, 'Security Candidate')
  await replaceEditorCode(page, 'def add(a, b):\n    return a + b\n')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('2 / 2 testcases passed')).toBeVisible()
  await page.getByRole('button', { name: 'Submit', exact: true }).first().click()
  await page.getByRole('button', { name: 'Submit', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: 'Assessment submitted' })).toBeVisible()

  const content = (await Promise.all(bodies)).join('\n')
  expect(content.length).toBeGreaterThan(0)
  expect(content).not.toContain(seedData.hiddenSentinels.input)
  expect(content).not.toContain(seedData.hiddenSentinels.output)
})

test('admin API never returns the OpenRouter key in plaintext', async ({ page, adminToken }) => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/platform' } } })
  const prior = await prisma.systemConfig.findUnique({ where: { id: 'singleton' } })
  const bodies: Promise<string>[] = []

  try {
    await page.goto(ADMIN_URL)
    page.on('response', (response) => {
      if (response.headers()['content-type']?.includes('application/json')) {
        bodies.push(response.text().catch(() => ''))
      }
    })

    const result = await page.evaluate(async ({ token, key }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      const saved = await fetch('/api/v1/admin/config/openrouter-key', {
        method: 'POST', headers, body: JSON.stringify({ key }),
      })
      const config = await fetch('/api/v1/admin/config', { headers })
      return { saveStatus: saved.status, configStatus: config.status, config: await config.json() }
    }, { token: adminToken, key: KEY_SENTINEL })

    expect(result.saveStatus).toBe(200)
    expect(result.configStatus).toBe(200)
    expect(result.config.data.openrouter_key_configured).toBe(true)
    expect((await Promise.all(bodies)).join('\n')).not.toContain(KEY_SENTINEL)
  } finally {
    if (prior) {
      await prisma.systemConfig.update({ where: { id: 'singleton' }, data: { openrouterKeyEncrypted: prior.openrouterKeyEncrypted } })
    } else {
      await prisma.systemConfig.deleteMany({ where: { id: 'singleton' } })
    }
    await prisma.$disconnect()
  }
})
