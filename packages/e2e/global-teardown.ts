import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import type { FullConfig } from '@playwright/test'

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/platform'

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } })

  try {
    console.log('[e2e] Running global teardown…')

    const admins = await prisma.user.findMany({
      where: { email: { endsWith: '@test.local' } },
      select: { id: true },
    })
    if (admins.length === 0) {
      console.log('[e2e] No e2e data to clean up.')
      return
    }

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

    // Remove the test-data file created during setup
    const dataFile = path.join(__dirname, '.test-data.json')
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile)

    console.log('[e2e] Global teardown complete.')
  } finally {
    await prisma.$disconnect()
  }
}
