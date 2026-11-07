import { useEffect, useRef, useState } from 'react'
import { blobToBase64 } from '../proctoring/media'
import { connectMobileProctor, heartbeatMobileProctor, uploadMobileRecording } from '../api/client'

export function MobileProctorPage() {
  const token = new URLSearchParams(window.location.search).get('pair') ?? ''
  const preview = useRef<HTMLVideoElement>(null)
  // Pairing is done once; switching cameras must not re-pair or duplicate events.
  const connectedRef = useRef(false)
  const [started, setStarted] = useState(false)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!started) return
    let stream: MediaStream | null = null
    let recorder: MediaRecorder | null = null
    let heartbeat: ReturnType<typeof setInterval> | null = null
    const start = async () => {
      if (!token || !window.isSecureContext || !navigator.mediaDevices) throw new Error('Open this link in a current browser over HTTPS.')
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false })
      } catch {
        throw new Error('Camera access was not allowed. Enable camera permission and try again.')
      }
      if (preview.current) preview.current.srcObject = stream
      if (!connectedRef.current) {
        try {
          await connectMobileProctor(token)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not pair this phone.'
          throw new Error(`Pairing failed: ${message}`)
        }
        connectedRef.current = true
      }
      void heartbeatMobileProctor(token).catch(() => {})
      heartbeat = setInterval(() => void heartbeatMobileProctor(token).catch(() => {}), 15_000)
      const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : null
      if (mimeType) {
        try {
          recorder = new MediaRecorder(stream, { mimeType })
          recorder.ondataavailable = (event) => {
            if (event.data.size) void blobToBase64(event.data).then((data) => uploadMobileRecording(token, mimeType, data)).catch(() => {})
          }
          recorder.start(10_000)
        } catch {
          recorder = null
        }
      }
    }
    void start().catch((error) => {
      stream?.getTracks().forEach((track) => track.stop())
      connectedRef.current = false
      setError(error instanceof Error ? error.message : 'Could not connect the second camera.')
      setStarted(false)
    })
    return () => {
      if (heartbeat) clearInterval(heartbeat)
      if (recorder?.state !== 'inactive') recorder?.stop()
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [started, facing, token])

  if (!started) {
    return (
      <main className="min-h-[100svh] bg-black px-5 py-7 text-white">
        <section className="mx-auto w-full max-w-md">
          <h1 className="text-3xl font-semibold">Second camera</h1>
          <div className="mt-5 space-y-4 text-base leading-7 text-white/80">
            <p>Keep this camera open until the assessment ends.</p>
            <p>Place the phone sideways, two arm lengths away, showing your screen, keyboard, hands, and side profile.</p>
            <p>Keep it plugged in, silent, and out of reach. Blocking the view is not allowed.</p>
          </div>
          {error && <p className="mt-5 text-sm text-red-300">{error}</p>}
          <button type="button" onClick={() => { setError(null); setStarted(true) }} className="mt-8 w-full rounded-[8px] bg-white px-4 py-3 text-base font-semibold text-black">
            Open camera
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="relative h-screen bg-black">
      <video ref={preview} autoPlay muted playsInline className="h-full w-full object-cover" aria-label="Second camera preview" />
      {/* Screen boundary / viewfinder frame */}
      <div className="pointer-events-none absolute inset-2 rounded-xl border-2 border-white/60" />
      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 p-5">
        <button
          type="button"
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          className="rounded-full bg-black/60 px-5 py-3 text-sm font-semibold text-white backdrop-blur"
        >
          Switch to {facing === 'environment' ? 'front' : 'back'} camera
        </button>
        <button
          type="button"
          onClick={() => { setError(null); setStarted(false) }}
          className="rounded-full bg-white/90 px-5 py-3 text-sm font-semibold text-black"
        >
          Exit
        </button>
      </div>
    </main>
  )
}
