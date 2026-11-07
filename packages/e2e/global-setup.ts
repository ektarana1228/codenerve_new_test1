import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import * as fs from 'fs'
import * as path from 'path'
import type { FullConfig } from '@playwright/test'
import type { SeedData } from './helpers/seed'

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/platform'

const E2E_ADMIN_EMAIL = 'e2e-admin@test.local'
const E2E_ADMIN_PASSWORD = 'TestAdmin1!'

// ─── Entry point ──────────────────────────────────────────────────────────────

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } })

  try {
    console.log('[e2e] Running global setup…')
    await cleanupPreviousRun(prisma)

    const admin = await prisma.user.create({
      data: {
        email: E2E_ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(E2E_ADMIN_PASSWORD, 10),
        role: 'ADMIN',
      },
    })

    const ttl = new Date(Date.now() + 72 * 60 * 60 * 1000)

    // ── Standard assessment (60 min) ──────────────────────────────────────────
    // Used by suites 1, 4, 5.
    // Hidden test cases use recognisable sentinel strings so suite 5 can assert
    // they never appear in any network response that reaches the browser.
    const standard = await prisma.assessment.create({
      data: {
        title: 'E2E Standard Assessment',
        description: 'Created by E2E global-setup',
        createdBy: admin.id,
        timeLimitMinutes: 60,
        language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini',
        codeWeight: 60,
        aiuWeight: 40,
        aiuMetrics: ['PROMPT_QUALITY', 'ITERATION_EFFICIENCY'],
        aiuMetricWeights: { PROMPT_QUALITY: 50, ITERATION_EFFICIENCY: 50 },
        status: 'ACTIVE',
        problems: {
          create: {
            title: 'Sum Two Numbers',
            description:
              '## Sum Two Numbers\n\nWrite a function `add(a, b)` that returns the sum of two integers.',
            difficulty: 'EASY',
            testCases: {
              create: [
                { input: '1 2', expected: '3', isHidden: false },
                { input: '0 0', expected: '0', isHidden: false },
                // Sentinel values: suite 5 asserts these never reach the browser
                {
                  input: 'E2E_HIDDEN_INPUT_SENTINEL_XK9',
                  expected: 'E2E_HIDDEN_OUTPUT_SENTINEL_XK9',
                  isHidden: true,
                },
                { input: '100 200', expected: '300', isHidden: true },
              ],
            },
          },
        },
        inviteTokens: {
          create: [
            { candidateName: 'E2E Suite1 Candidate', expiresAt: ttl },
            { candidateName: 'E2E Suite4 Candidate', expiresAt: ttl },
            { candidateName: 'E2E Suite5 Candidate', expiresAt: ttl },
          ],
        },
      },
      include: { inviteTokens: true },
    })

    const [s1Token, s4Token, s5Token] = standard.inviteTokens

    // ── Timer assessment (1 min) ──────────────────────────────────────────────
    // Used by suite 3; short limit lets the test wait for real expiry.
    const timer = await prisma.assessment.create({
      data: {
        title: 'E2E Timer Assessment',
        description: 'Created by E2E global-setup',
        createdBy: admin.id,
        timeLimitMinutes: 1,
        language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini',
        codeWeight: 70,
        aiuWeight: 30,
        aiuMetrics: ['PROMPT_QUALITY'],
        aiuMetricWeights: { PROMPT_QUALITY: 100 },
        status: 'ACTIVE',
        problems: {
          create: {
            title: 'Hello World',
            description: 'Print "Hello, World!"',
            difficulty: 'EASY',
            testCases: {
              create: [
                { input: '', expected: 'Hello, World!', isHidden: false },
                { input: '', expected: 'Hello, World!', isHidden: true },
              ],
            },
          },
        },
        inviteTokens: {
          create: [{ candidateName: 'E2E Suite3 Candidate', expiresAt: ttl }],
        },
      },
      include: { inviteTokens: true },
    })

    const [s3Token] = timer.inviteTokens

    // ── Pre-scored assessment ──────────────────────────────────────────────────
    // Suite 2 verifies the leaderboard UI without needing the sandbox runner.
    // We manually insert a candidate session + score so the leaderboard has data.
    const scored = await prisma.assessment.create({
      data: {
        title: 'E2E Scored Assessment',
        description: 'Created by E2E global-setup',
        createdBy: admin.id,
        timeLimitMinutes: 60,
        language: 'PYTHON',
        llmModel: 'openai/gpt-4o-mini',
        codeWeight: 60,
        aiuWeight: 40,
        aiuMetrics: ['PROMPT_QUALITY'],
        aiuMetricWeights: { PROMPT_QUALITY: 100 },
        status: 'ACTIVE',
        problems: {
          create: {
            title: 'FizzBuzz',
            description: 'Classic FizzBuzz problem.',
            difficulty: 'EASY',
            testCases: {
              create: [
                { input: '15', expected: 'FizzBuzz', isHidden: false },
                { input: '3', expected: 'Fizz', isHidden: true },
              ],
            },
          },
        },
        inviteTokens: {
          create: [{ candidateName: 'E2E Scored Candidate', expiresAt: ttl }],
        },
      },
      include: { inviteTokens: true },
    })

    const [scoredInvite] = scored.inviteTokens

    // Insert the pre-scored candidate session
    const scoredCandidateEmail = `candidate-${scoredInvite.id}@noemail.candidate`
    const scoredCandidate = await prisma.user.upsert({
      where: { email: scoredCandidateEmail },
      update: {},
      create: { email: scoredCandidateEmail, passwordHash: null, role: 'STUDENT' },
    })

    const scoredSession = await prisma.session.create({
      data: {
        assessmentId: scored.id,
        candidateId: scoredCandidate.id,
        language: 'PYTHON',
        status: 'SUBMITTED',
        currentCode: 'def solve(n):\n    if n % 15 == 0: return "FizzBuzz"\n',
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
        submittedAt: new Date(Date.now() - 5 * 60 * 1000),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    await prisma.sessionScore.create({
      data: {
        sessionId: scoredSession.id,
        codeCorrectnessScore: 75,
        aiuScores: { PROMPT_QUALITY: 80 },
        aiuTotalScore: 80,
        totalScore: 77,
      },
    })

    await prisma.inviteToken.update({
      where: { id: scoredInvite.id },
      data: { usedAt: new Date() },
    })

    // ── Write test data for tests to consume ──────────────────────────────────

    const seedData: SeedData = {
      admin: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD, id: admin.id },
      standardAssessment: { id: standard.id },
      timerAssessment: { id: timer.id },
      scoredAssessment: { id: scored.id, scoredSessionId: scoredSession.id },
      tokens: {
        suite1: s1Token.token,
        suite3: s3Token.token,
        suite4: s4Token.token,
        suite5: s5Token.token,
      },
      hiddenSentinels: {
        input: 'E2E_HIDDEN_INPUT_SENTINEL_XK9',
        output: 'E2E_HIDDEN_OUTPUT_SENTINEL_XK9',
      },
    }

    fs.writeFileSync(
      path.join(__dirname, '.test-data.json'),
      JSON.stringify(seedData, null, 2),
    )

    console.log('[e2e] Global setup complete. Test data written to .test-data.json')
  } finally {
    await prisma.$disconnect()
  }
}

// ─── Cleanup helper ───────────────────────────────────────────────────────────

async function cleanupPreviousRun(prisma: PrismaClient): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { email: { endsWith: '@test.local' } },
    select: { id: true },
  })
  if (admins.length === 0) return

  const adminIds = admins.map((a) => a.id)
  const assessments = await prisma.assessment.findMany({
    where: { createdBy: { in: adminIds } },
    select: { id: true },
  })
  const assessmentIds = assessments.map((a) => a.id)

  if (assessmentIds.length > 0) {
    const sessions = await prisma.session.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { id: true, candidateId: true },
    })
    const sessionIds = sessions.map((s) => s.id)
    const candidateIds = [...new Set(sessions.map((s) => s.candidateId))]

    if (sessionIds.length > 0) {
      await prisma.interactionLog.deleteMany({ where: { sessionId: { in: sessionIds } } })
      await prisma.sessionScore.deleteMany({ where: { sessionId: { in: sessionIds } } })
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
    }

    const problems = await prisma.problem.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { id: true },
    })
    const problemIds = problems.map((p) => p.id)

    if (problemIds.length > 0) {
      await prisma.testCase.deleteMany({ where: { problemId: { in: problemIds } } })
      await prisma.problem.deleteMany({ where: { id: { in: problemIds } } })
    }

    await prisma.inviteToken.deleteMany({ where: { assessmentId: { in: assessmentIds } } })
    await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } })

    if (candidateIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: candidateIds }, role: 'STUDENT' } })
    }
  }

  await prisma.user.deleteMany({ where: { id: { in: adminIds } } })
}
