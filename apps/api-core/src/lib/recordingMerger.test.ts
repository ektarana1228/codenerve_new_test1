jest.mock('@platform/db', () => ({ prisma: {} }))
jest.mock('./storage', () => ({
  deleteEvidenceFile: jest.fn(),
  downloadEvidenceFile: jest.fn(),
  uploadEvidenceFile: jest.fn(),
}))

import { mergedRecordingName } from './recordingMerger'

test('uses a unique destination for every merged recording generation', () => {
  expect(mergedRecordingName('session-1', 'SCREEN_RECORDING', 100)).toBe(
    'session-1/screen_recording/complete-100.webm',
  )
  expect(mergedRecordingName('session-1', 'SCREEN_RECORDING', 101)).not.toBe(
    mergedRecordingName('session-1', 'SCREEN_RECORDING', 100),
  )
})
