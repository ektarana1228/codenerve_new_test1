import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

// ---------------------------------------------------------------------------
// Test database client
// A fresh PrismaClient instance (separate from the app's globalThis singleton)
// that tests use to seed fixtures and make assertions.
// ---------------------------------------------------------------------------

export function createTestDb(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
    log: [],
  })
}

// ---------------------------------------------------------------------------
// Cleanup — truncate every table between tests
// ---------------------------------------------------------------------------

export async function cleanDb(db: PrismaClient): Promise<void> {
  // Single TRUNCATE … CASCADE clears all tables in dependency order
  // without needing to know the FK graph.
  await db.$executeRaw`TRUNCATE TABLE
    "InteractionLog",
    "SessionScore",
    "Session",
    "InviteToken",
    "TestCase",
    "Problem",
    "Assessment",
    "AdminSignupRequest",
    "SystemConfig",
    "User"
  CASCADE`
}

// ---------------------------------------------------------------------------
// Standard fixture set
// Seeds the minimum data needed by most integration tests:
//   - One admin user + pre-signed JWT
//   - One active assessment with a single EASY problem
//   - Two test cases: one visible, one hidden
//   - One unused invite token (72 h TTL)
// ---------------------------------------------------------------------------

export interface Fixtures {
  adminId: string
  adminToken: string          // 1 h JWT signed with process.env.JWT_SECRET
  assessmentId: string
  problemId: string
  visibleTcId: string
  hiddenTcId: string
  inviteTokenValue: string    // the UUID stored in InviteToken.token
  inviteTokenId: string       // the PK of the InviteToken row
}

export async function seedFixtures(db: PrismaClient): Promise<Fixtures> {
  const passwordHash = await bcrypt.hash('admin123', 10)

  const admin = await db.user.create({
    data: {
      email: 'test-admin@integration.test',
      passwordHash,
      role: 'ADMIN',
    },
  })

  const assessment = await db.assessment.create({
    data: {
      title: 'Integration Test Assessment',
      createdBy: admin.id,
      timeLimitMinutes: 60,
      language: 'PYTHON',
      codeWeight: 60,
      aiuWeight: 40,
      aiuMetrics: ['PROMPT_QUALITY', 'ITERATION_EFFICIENCY'],
      aiuMetricWeights: { prompt_quality: 50, iteration_efficiency: 50 },
      status: 'ACTIVE',
    },
  })

  const problem = await db.problem.create({
    data: {
      assessmentId: assessment.id,
      title: 'Sum of Two',
      description: 'Return the sum of two numbers.',
      difficulty: 'EASY',
    },
  })

  const [visibleTc, hiddenTc] = await Promise.all([
    db.testCase.create({
      data: { problemId: problem.id, input: '2 2', expected: '4', isHidden: false },
    }),
    db.testCase.create({
      data: { problemId: problem.id, input: '5 5', expected: '10', isHidden: true },
    }),
  ])

  const inviteToken = await db.inviteToken.create({
    data: {
      assessmentId: assessment.id,
      candidateName: 'Test Candidate',
      candidateEmail: 'candidate@integration.test',
      expiresAt: new Date(Date.now() + 72 * 3600_000),
    },
  })

  const adminToken = jwt.sign(
    { sub: admin.id, role: 'ADMIN' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  )

  return {
    adminId: admin.id,
    adminToken,
    assessmentId: assessment.id,
    problemId: problem.id,
    visibleTcId: visibleTc.id,
    hiddenTcId: hiddenTc.id,
    inviteTokenValue: inviteToken.token,
    inviteTokenId: inviteToken.id,
  }
}

// ---------------------------------------------------------------------------
// waitForLogs — polls the DB until N interaction logs are visible.
// Needed because llm.ts writes logs with `void prisma.create(...)` (async,
// not awaited before the response is sent).
// ---------------------------------------------------------------------------

export async function waitForLogs(
  db: PrismaClient,
  sessionId: string,
  expectedCount: number,
  timeoutMs = 3000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const count = await db.interactionLog.count({ where: { sessionId } })
    if (count >= expectedCount) return count
    await new Promise((r) => setTimeout(r, 50))
  }
  return db.interactionLog.count({ where: { sessionId } })
}
