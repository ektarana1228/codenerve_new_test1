import { prisma } from '@platform/db'
import type { Logger } from '@platform/logger'
import type { Manager } from './manager'

// Periodic server-side maintenance:
//   1. Sync - flush each ACTIVE session's live workspace to Session.currentCode,
//      so autosave is durable even if the client never calls flush.
//   2. Reap - lock submitted/expired sessions read-only and destroy the
//      containers of any session that is no longer ACTIVE.
//
// "Active" is derived from the DATABASE, over the union of in-memory records and
// actually-running containers. This is critical: deriving it from in-memory
// records alone would reap live containers whenever records are empty - right
// after a restart, or while a brand-new `ensure` is still booting (its record
// isn't registered until the container is created). Either would kill sessions
// that a candidate is actively using.
export async function runMaintenance(manager: Manager, log: Logger): Promise<void> {
  const managed = manager.listManaged()
  const containerIds = await manager.listContainerSessionIds()
  const candidateIds = Array.from(new Set([...managed, ...containerIds]))
  if (candidateIds.length === 0) return

  const sessions = await prisma.session.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, status: true, expiresAt: true },
  })
  const byId = new Map(sessions.map((s) => [s.id, s]))

  const active = new Set<string>()
  for (const id of candidateIds) {
    const s = byId.get(id)
    const expired = s?.expiresAt ? s.expiresAt.getTime() < Date.now() : false
    if (s && s.status === 'ACTIVE' && !expired) active.add(id)
  }

  // Sync active sessions we manage; freeze the rest read-only before reaping.
  for (const id of managed) {
    if (active.has(id)) {
      try {
        const code = await manager.readCurrentCode(id)
        if (code !== null) {
          await prisma.session.update({ where: { id }, data: { currentCode: code } })
        }
      } catch (err) {
        log.warn({ err: (err as Error).message, sessionId: id }, 'workspace sync failed')
      }
    } else {
      await manager.lock(id).catch(() => {})
    }
  }

  await manager.reap(active)
}
