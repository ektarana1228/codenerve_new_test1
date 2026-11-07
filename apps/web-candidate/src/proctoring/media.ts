let screen: MediaStream | null = null
let device: MediaStream | null = null
let recorders: MediaRecorder[] = []
let uploads = new Set<Promise<unknown>>()
let recordingActive = false
let recordingGeneration = 0
const RECORDING_FINALIZE_TIMEOUT_MS = 20_000

export function replaceProctoringMedia(next: { screen: MediaStream | null; device: MediaStream | null }) {
  stopProctoringMedia()
  screen = next.screen
  device = next.device
}

export function getProctoringMedia() {
  return { screen, device }
}

export function stopProctoringMedia() {
  recordingActive = false
  recordingGeneration++
  screen?.getTracks().forEach((track) => track.stop())
  device?.getTracks().forEach((track) => track.stop())
  screen = null
  device = null
}

export function startProctoringRecordings(
  enabled: { screen: boolean; webcam: boolean; microphone: boolean },
  upload: (kind: 'SCREEN_RECORDING' | 'WEBCAM_RECORDING' | 'MICROPHONE_RECORDING', mimeType: string, data: string) => Promise<unknown>,
) {
  recordingActive = true
  const generation = ++recordingGeneration
  const sources: Array<['SCREEN_RECORDING' | 'WEBCAM_RECORDING' | 'MICROPHONE_RECORDING', MediaStream | null]> = [
    ['SCREEN_RECORDING', enabled.screen && screen ? new MediaStream(screen.getVideoTracks()) : null],
    ['WEBCAM_RECORDING', enabled.webcam && device ? new MediaStream(device.getVideoTracks()) : null],
    ['MICROPHONE_RECORDING', enabled.microphone && device ? new MediaStream(device.getAudioTracks()) : null],
  ]
  for (const [kind, stream] of sources) {
    if (!stream?.getTracks().length) continue
    const preferred = kind === 'MICROPHONE_RECORDING' ? 'audio/webm;codecs=opus' : 'video/webm;codecs=vp8,opus'
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : kind === 'MICROPHONE_RECORDING' ? 'audio/webm' : 'video/webm'
    const startClip = () => {
      if (!recordingActive || generation !== recordingGeneration || stream.getTracks().some((track) => track.readyState === 'ended')) return
      const recorder = new MediaRecorder(stream, { mimeType })
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return
        const pending = event.data.arrayBuffer().then((buffer) => upload(kind, mimeType, arrayBufferToBase64(buffer))).catch(() => {})
        uploads.add(pending)
        void pending.finally(() => uploads.delete(pending))
      }
      recorder.onstop = () => {
        recorders = recorders.filter((item) => item !== recorder)
        startClip()
      }
      recorder.start(10_000)
      recorders.push(recorder)
    }
    startClip()
  }
}

export async function stopProctoringRecordings() {
  recordingActive = false
  recordingGeneration++
  const stopped = recorders.map((recorder) => new Promise<void>((resolve) => {
    if (recorder.state === 'inactive') return resolve()
    recorder.addEventListener('stop', () => resolve(), { once: true })
    try { recorder.requestData() } catch { /* best effort final chunk flush */ }
    recorder.stop()
  }))
  recorders = []
  const finalize = Promise.all(stopped)
    .then(() => Promise.allSettled([...uploads]))
    .then(() => undefined)
    .catch(() => undefined)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, RECORDING_FINALIZE_TIMEOUT_MS)
    void finalize.finally(() => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return arrayBufferToBase64(await blob.arrayBuffer())
}

export async function captureJpeg(stream: MediaStream, maxWidth: number): Promise<string> {
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  await video.play()
  if (!video.videoWidth) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video frame unavailable')), 3000)
      video.onloadedmetadata = () => {
        clearTimeout(timeout)
        resolve()
      }
    })
  }

  const scale = Math.min(1, maxWidth / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
  video.srcObject = null
  return canvas.toDataURL('image/jpeg', 0.7).split(',')[1] ?? ''
}
