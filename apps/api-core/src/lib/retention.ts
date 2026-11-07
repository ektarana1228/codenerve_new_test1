import type { FastifyInstance } from 'fastify'
import { prisma } from '@platform/db'
import type { ApiCoreEnv } from '@platform/config'
import { deleteEvidenceFile } from './storage'

export async function deleteExpiredEvidence(env: ApiCoreEnv): Promise<void> {
  // Loop until the backlog is drained, not just one 100-row batch - otherwise
  // a large backlog can outrun the promised retention window.
  while (true) {
    const expiredMedia = await prisma.proctorMedia.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true, driveFileId: true },
      take: 100,
    })
    if (expiredMedia.length === 0) break
    for (const media of expiredMedia) {
      await deleteEvidenceFile(env, media.driveFileId)
      await prisma.proctorMedia.delete({ where: { id: media.id } })
    }
  }
  await prisma.proctorEvent.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  await prisma.mobilePairing.deleteMany({ where: { expiresAt: { lte: new Date() } } })
}

export function startRetentionCleanup(app: FastifyInstance, env: ApiCoreEnv) {
  const run = () => deleteExpiredEvidence(env).catch((err) => app.log.error({ err }, 'Proctor evidence cleanup failed'))
  const timer = setInterval(run, 60 * 60 * 1000)
  timer.unref()
  app.addHook('onClose', async () => clearInterval(timer))
  run()
}
