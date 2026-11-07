import { afterEach, describe, expect, test, vi } from 'vitest'
import { getProctorMediaUrl } from './client'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('proctor media download', () => {
  test('creates an object URL only for supported media', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['webm']), {
      status: 200,
      headers: { 'Content-Type': 'video/webm' },
    })))
    const createObjectURL = vi.fn().mockReturnValue('blob:recording')
    vi.stubGlobal('URL', { ...URL, createObjectURL })

    await expect(getProctorMediaUrl('session-1', 'media-1')).resolves.toBe('blob:recording')
    expect(createObjectURL).toHaveBeenCalledOnce()
  })

  test('preserves the structured storage error returned by the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'STORAGE_UNAVAILABLE', message: 'Media storage is unavailable' },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })))

    await expect(getProctorMediaUrl('session-1', 'media-1')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      message: 'Media storage is unavailable',
    })
  })

  test('rejects an unsupported response type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(getProctorMediaUrl('session-1', 'media-1')).rejects.toMatchObject({
      code: 'INVALID_MEDIA',
    })
  })
})
