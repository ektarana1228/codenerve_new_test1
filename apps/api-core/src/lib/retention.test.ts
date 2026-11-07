jest.mock('@platform/db', () => ({
  prisma: {
    proctorMedia: { findMany: jest.fn(), delete: jest.fn() },
    proctorEvent: { deleteMany: jest.fn() },
    mobilePairing: { deleteMany: jest.fn() },
  },
}))
jest.mock('./storage', () => ({ deleteEvidenceFile: jest.fn().mockResolvedValue(undefined) }))

import { prisma } from '@platform/db'
import { deleteEvidenceFile } from './storage'
import { deleteExpiredEvidence } from './retention'
import { TEST_ENV } from '../testEnv'

const env = TEST_ENV

beforeEach(() => jest.clearAllMocks())

test('drains a backlog larger than one 100-row batch instead of stopping at 100', async () => {
  const batch1 = Array.from({ length: 100 }, (_, i) => ({ id: `a-${i}`, driveFileId: `file-a-${i}` }))
  const batch2 = Array.from({ length: 40 }, (_, i) => ({ id: `b-${i}`, driveFileId: `file-b-${i}` }))
  jest
    .mocked(prisma.proctorMedia.findMany)
    .mockResolvedValueOnce(batch1 as never)
    .mockResolvedValueOnce(batch2 as never)
    .mockResolvedValueOnce([] as never)
  jest.mocked(prisma.proctorMedia.delete).mockResolvedValue({} as never)
  jest.mocked(prisma.proctorEvent.deleteMany).mockResolvedValue({ count: 0 } as never)
  jest.mocked(prisma.mobilePairing.deleteMany).mockResolvedValue({ count: 0 } as never)

  await deleteExpiredEvidence(env)

  expect(prisma.proctorMedia.findMany).toHaveBeenCalledTimes(3)
  expect(prisma.proctorMedia.delete).toHaveBeenCalledTimes(140)
  expect(deleteEvidenceFile).toHaveBeenCalledTimes(140)
})

test('does nothing when there is no expired media', async () => {
  jest.mocked(prisma.proctorMedia.findMany).mockResolvedValueOnce([] as never)
  jest.mocked(prisma.proctorEvent.deleteMany).mockResolvedValue({ count: 0 } as never)
  jest.mocked(prisma.mobilePairing.deleteMany).mockResolvedValue({ count: 0 } as never)

  await deleteExpiredEvidence(env)

  expect(prisma.proctorMedia.findMany).toHaveBeenCalledTimes(1)
  expect(prisma.proctorMedia.delete).not.toHaveBeenCalled()
})
