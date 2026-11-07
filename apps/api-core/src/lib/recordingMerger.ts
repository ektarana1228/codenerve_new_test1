import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { prisma } from '@platform/db'
import type { ApiCoreEnv } from '@platform/config'
import { deleteEvidenceFile, downloadEvidenceFile, uploadEvidenceFile } from './storage'

const run = promisify(execFile)
const recordingKinds = ['SCREEN_RECORDING', 'WEBCAM_RECORDING', 'MICROPHONE_RECORDING']
const mergingSessions = new Set<string>()

export function mergedRecordingName(sessionId: string, kind: string, timestamp = Date.now()): string {
  return `${sessionId}/${kind.toLowerCase()}/complete-${timestamp}.webm`
}

export async function mergeSessionRecordings(env: ApiCoreEnv, sessionId: string): Promise<void> {
  if (mergingSessions.has(sessionId)) return
  mergingSessions.add(sessionId)
  try {
   for (const kind of recordingKinds) {
    const chunks = await prisma.proctorMedia.findMany({
      where: { sessionId, kind, sizeBytes: { gt: 0 } }, orderBy: { capturedAt: 'asc' },
    })
    if (chunks.length < 2) continue
    const dir = await mkdtemp(join(tmpdir(), 'proctor-merge-'))
    try {
      const paths: string[] = []
      for (const [index, chunk] of chunks.entries()) {
        const path = join(dir, `${index}.webm`)
        await writeFile(path, await downloadEvidenceFile(env, chunk.driveFileId))
        paths.push(path)
      }
      const list = join(dir, 'chunks.txt')
      await writeFile(list, paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n'))
      const output = join(dir, 'merged.webm')
      await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', output], { timeout: 120_000 })
      const merged = await import('node:fs/promises').then((fs) => fs.readFile(output))
      // A session can receive a late final chunk after an earlier merge. Use a
      // unique destination so deleting the previous merged input cannot delete
      // the newly uploaded output when both otherwise share "complete.webm".
      const objectName = await uploadEvidenceFile(env, mergedRecordingName(sessionId, kind), chunks[0]!.mimeType, merged)
      await prisma.$transaction(async (tx) => {
        await tx.proctorMedia.deleteMany({ where: { id: { in: chunks.map((chunk) => chunk.id) } } })
        await tx.proctorMedia.create({ data: {
          sessionId, kind, driveFileId: objectName, mimeType: chunks[0]!.mimeType,
          sizeBytes: merged.length, capturedAt: chunks[0]!.capturedAt, expiresAt: chunks[0]!.expiresAt,
        } })
      })
      await Promise.all(chunks.map((chunk) => deleteEvidenceFile(env, chunk.driveFileId).catch(() => {})))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
   }
  } finally {
    mergingSessions.delete(sessionId)
  }
}
