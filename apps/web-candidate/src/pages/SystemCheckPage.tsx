import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Navigate, useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@platform/web-shared'
import { activateSession, checkProctoringConnection, completeSystemCheck, createMobilePairing, getMobilePairing, logProctoringEvent } from '../api/client'
import { useSessionStore } from '../store/session'
import { getProctoringMedia, replaceProctoringMedia, stopProctoringMedia } from '../proctoring/media'

type Status = 'idle' | 'running' | 'passed' | 'failed' | 'skipped'
type Check = { label: string; status: Status; detail: string; required: boolean }
type CheckKey = 'browser' | 'connection' | 'camera' | 'microphone' | 'screen' | 'mobile'

const baseChecks: Record<CheckKey, Check> = {
  browser: { label: 'Browser security', status: 'idle', detail: 'Secure browser capabilities', required: true },
  connection: { label: 'Connection', status: 'idle', detail: 'Upload connection to ApexCoder', required: true },
  camera: { label: 'Webcam', status: 'skipped', detail: 'Not enabled for this assessment', required: false },
  microphone: { label: 'Microphone', status: 'skipped', detail: 'Not enabled for this assessment', required: false },
  screen: { label: 'Desktop sharing', status: 'skipped', detail: 'Not enabled for this assessment', required: false },
  mobile: { label: 'Second camera', status: 'skipped', detail: 'Not enabled for this assessment', required: false },
}

function modeCheck(label: string, mode: 'OFF' | 'OPTIONAL' | 'REQUIRED'): Check {
  return mode === 'OFF'
    ? { label, status: 'skipped', detail: 'Not enabled for this assessment', required: false }
    : { label, status: 'idle', detail: mode === 'REQUIRED' ? 'Required' : 'Optional', required: mode === 'REQUIRED' }
}

async function microphoneHasSignal(stream: MediaStream): Promise<boolean> {
  const track = stream.getAudioTracks()[0]
  if (!track || track.readyState !== 'live' || !track.enabled || track.muted) return false

  const context = new AudioContext()
  await context.resume()
  const analyser = context.createAnalyser()
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Uint8Array(analyser.fftSize)
  const deadline = Date.now() + 3000
  try {
    while (Date.now() < deadline) {
      analyser.getByteTimeDomainData(samples)
      if (samples.some((value) => Math.abs(value - 128) > 3)) return true
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return false
  } finally {
    await context.close()
  }
}

function requestScreenShare(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'monitor' } as MediaTrackConstraints,
    audio: false,
  })
}

function isEntireScreen(stream: MediaStream): boolean {
  const displaySurface = stream.getVideoTracks()[0]?.getSettings().displaySurface
  return !displaySurface || displaySurface === 'monitor'
}

export function SystemCheckPage() {
  const sessionId = useSessionStore((state) => state.session_id)
  const assessment = useSessionStore((state) => state.assessment)
  const kind = useSessionStore((state) => state.kind)
  const setToken = useSessionStore((state) => state.setToken)
  const setTimeRemaining = useSessionStore((state) => state.setTimeRemaining)
  const navigate = useNavigate()
  const policy = assessment?.proctoring
  const [acknowledged, setAcknowledged] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFull, setIsFull] = useState(() => Boolean(document.fullscreenElement))
  const [checks, setChecks] = useState<Record<CheckKey, Check>>(() => ({
    ...baseChecks,
    camera: modeCheck('Webcam', policy?.video_proctoring ?? 'OFF'),
    microphone: modeCheck('Microphone', policy?.microphone_recording ?? 'OFF'),
    screen: modeCheck('Desktop sharing', policy?.screen_recording ?? 'OFF'),
    mobile: modeCheck('Second camera', policy?.second_camera ?? 'OFF'),
  }))
  const [pairingUrl, setPairingUrl] = useState<string | null>(null)
  const [pairingQr, setPairingQr] = useState<string | null>(null)
  const pairingRequest = useRef<ReturnType<typeof createMobilePairing> | null>(null)
  const checkBatchIdRef = useRef(`check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  useEffect(() => {
    if (!sessionId || policy?.second_camera === 'OFF') return
    let active = true
    pairingRequest.current ??= createMobilePairing(sessionId)
    void pairingRequest.current.then(async (response) => {
      if (!active) return
      setPairingUrl(response.data.pairing_url)
      setPairingQr(await QRCode.toDataURL(response.data.pairing_url, { width: 220, margin: 1 }))
      update('mobile', 'running', 'Scan the QR code with the phone')
    }).catch(() => setError('Could not create the second-camera pairing code.'))
    const poll = setInterval(() => void getMobilePairing(sessionId).then((response) => {
      if (response.data.connected) update('mobile', 'passed', 'Second camera connected')
    }).catch(() => {}), 3_000)
    return () => { active = false; clearInterval(poll) }
  }, [sessionId, policy?.second_camera])

  if (!sessionId || !assessment || !policy) return <Navigate to="/start" replace />
  const activeSessionId = sessionId
  const activeAssessment = assessment
  const activePolicy = policy

  const update = (key: CheckKey, status: Status, detail: string) =>
    setChecks((current) => ({ ...current, [key]: { ...current[key], status, detail } }))

  async function runChecks() {
    setRunning(true)
    setError(null)
    checkBatchIdRef.current = `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    stopProctoringMedia()

    let screenRequest: Promise<MediaStream> | null = null
    if (activePolicy.screen_recording !== 'OFF' && navigator.mediaDevices) {
      update('screen', 'running', 'Choose Entire screen')
      screenRequest = requestScreenShare()
    }

    try {
      await logProctoringEvent(activeSessionId, 'SYSTEM', 'SYSTEM_CHECK_STARTED', { batch_id: checkBatchIdRef.current })
    } catch {
      screenRequest?.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {})
      update('connection', 'failed', 'Could not reach the proctoring service')
      setError('The proctoring service is unavailable. Try again.')
      setRunning(false)
      return
    }

    const browserOk = window.isSecureContext && Boolean(navigator.mediaDevices) && typeof MediaRecorder !== 'undefined'
    update('browser', browserOk ? 'passed' : 'failed', browserOk ? 'Browser capabilities available' : 'Use a current browser over HTTPS')

    try {
      update('connection', 'running', 'Testing upload connection')
      const payload = '0'.repeat(256 * 1024)
      const started = performance.now()
      await checkProctoringConnection(payload)
      const mbps = (payload.length * 8) / ((performance.now() - started) / 1000) / 1_000_000
      update('connection', 'passed', `${mbps.toFixed(1)} Mbps test upload`)
    } catch {
      update('connection', 'failed', 'Could not reach the proctoring service')
    }

    let screenStream: MediaStream | null = null
    if (activePolicy.screen_recording !== 'OFF') {
      update('screen', 'running', 'Choose Entire screen')
      try {
        if (!screenRequest) throw new Error('Screen capture unavailable')
        screenStream = await screenRequest!
        if (!isEntireScreen(screenStream)) {
          screenStream.getTracks().forEach((track) => track.stop())
          screenStream = null
          throw new Error('Entire screen was not selected')
        }
        screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
          update('screen', 'failed', 'Screen sharing stopped. Run the system check again')
        }, { once: true })
        update('screen', 'passed', 'Entire screen is shared')
      } catch {
        update('screen', 'failed', 'Share your entire screen, not a window or browser tab')
      }
    }

    let deviceStream: MediaStream | null = null
    if (activePolicy.video_proctoring !== 'OFF' || activePolicy.microphone_recording !== 'OFF') {
      try {
        deviceStream = await navigator.mediaDevices.getUserMedia({
          video: activePolicy.video_proctoring !== 'OFF',
          audio: activePolicy.microphone_recording !== 'OFF',
        })
        if (activePolicy.video_proctoring !== 'OFF') {
          const camera = deviceStream.getVideoTracks()[0]
          update('camera', camera?.readyState === 'live' ? 'passed' : 'failed', camera?.readyState === 'live' ? 'Webcam is ready' : 'Webcam is unavailable')
        }
        if (activePolicy.microphone_recording !== 'OFF') {
          update('microphone', 'running', 'Speak while the microphone is tested')
          const signal = await microphoneHasSignal(deviceStream)
          update('microphone', signal ? 'passed' : 'failed', signal ? 'Microphone signal detected' : 'No microphone signal detected')
        }
      } catch {
        if (activePolicy.video_proctoring !== 'OFF') update('camera', 'failed', 'Webcam access was not allowed')
        if (activePolicy.microphone_recording !== 'OFF') update('microphone', 'failed', 'Microphone access was not allowed')
      }
    }

    if (activePolicy.second_camera !== 'OFF') {
      const mobile = await getMobilePairing(activeSessionId).catch(() => null)
      update('mobile', mobile?.data.connected ? 'passed' : 'running', mobile?.data.connected ? 'Second camera connected' : 'Scan the QR code with the phone')
    }

    replaceProctoringMedia({ screen: screenStream, device: deviceStream })
    if (screenStream) void logProctoringEvent(activeSessionId, 'DESKTOP', 'SCREEN_STARTED', { batch_id: checkBatchIdRef.current }).catch(() => {})
    if (deviceStream?.getVideoTracks().length) void logProctoringEvent(activeSessionId, 'DESKTOP', 'CAMERA_STARTED', { batch_id: checkBatchIdRef.current }).catch(() => {})
    if (deviceStream?.getAudioTracks().length) void logProctoringEvent(activeSessionId, 'DESKTOP', 'MICROPHONE_STARTED', { batch_id: checkBatchIdRef.current }).catch(() => {})
    setRunning(false)
  }

  const requiredPassed = Object.values(checks).every((check) => !check.required || check.status === 'passed')
  const finished = Object.values(checks).every((check) => !['idle', 'running'].includes(check.status))

  async function continueToAssessment() {
    setRunning(true)
    setError(null)
    try {
      if (activePolicy.screen_recording !== 'OFF') {
        const screenTrack = getProctoringMedia().screen?.getVideoTracks()[0]
        if (!screenTrack || screenTrack.readyState !== 'live') {
          update('screen', 'failed', 'Screen sharing stopped. Run the system check again and keep sharing your entire screen')
          setError('Screen sharing must remain active before you can continue. Run the system check again.')
          setRunning(false)
          return
        }
      }
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.()
        setIsFull(Boolean(document.fullscreenElement))
      }
      const checkStatuses = Object.fromEntries(
        Object.entries(checks).map(([key, check]) => [key, check.status === 'passed' ? 'passed' : check.status === 'skipped' ? 'skipped' : 'failed']),
      ) as Record<string, 'passed' | 'failed' | 'skipped'>
      const completion = await completeSystemCheck(activeSessionId, checkStatuses, checkBatchIdRef.current)
      if (!completion.data.can_proceed) throw new Error('Required system check failed')
      const response = await activateSession(activeSessionId)
      setToken(response.data.access_token)
      setTimeRemaining(Math.max(0, Math.floor((new Date(response.data.expires_at).getTime() - Date.now()) / 1000)))
      navigate(kind === 'PROJECT' ? '/assess' : '/language-select', { replace: true })
    } catch {
      setError('The assessment could not be activated. Check your connection and try again.')
      setRunning(false)
    }
  }

  return (
    <main className="min-h-screen bg-[color:var(--bg-canvas)] px-4 py-10 text-[color:var(--text-primary)]">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">System check</h1>
        <p className="mt-2 text-sm text-[color:var(--text-muted)]">Complete the required checks before starting {activeAssessment.title}.</p>

        <section className="mt-6 border-y border-[color:var(--border-subtle)] py-5 text-sm text-[color:var(--text-secondary)]">
          <p>ApexCoder may record the enabled screen, webcam, microphone, second camera, periodic screenshots, connection information, and assessment-window events for assessment integrity review. Proctoring evidence is available to authorized administrators and deleted 72 hours after the assessment ends.</p>
          <label className="mt-4 flex items-start gap-3">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
            <span>I have read and understood this proctoring notice.</span>
          </label>
        </section>

        <div className="mt-6 divide-y divide-[color:var(--border-subtle)] border-y border-[color:var(--border-subtle)]">
          {Object.entries(checks).map(([key, check]) => (
            <div key={key} className="flex min-h-16 items-center justify-between gap-4 py-3">
              <div><p className="text-sm font-medium">{check.label}{check.required ? ' (required)' : ''}</p><p className="text-xs text-[color:var(--text-muted)]">{check.detail}</p></div>
              <span className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">{check.status}</span>
            </div>
          ))}
        </div>

        {activePolicy.second_camera !== 'OFF' && (
          <section className="mt-6 border-y border-[color:var(--border-subtle)] py-5 text-center">
            <p className="mb-3 text-sm font-medium">Scan with the phone used as the second camera</p>
            {pairingQr ? <img src={pairingQr} alt="Second camera pairing QR code" className="mx-auto h-[220px] w-[220px]" /> : <p className="text-sm text-[color:var(--text-muted)]">Creating pairing code...</p>}
            {pairingUrl && <a href={pairingUrl} className="mt-3 block break-all text-xs text-[color:var(--text-muted)]">Open pairing link</a>}
          </section>
        )}

        {error && <p className="mt-4 text-sm text-[color:var(--status-fail)]">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={!acknowledged || running} onClick={runChecks} className="rounded-lg border border-[color:var(--border-strong)] px-5 py-2.5 text-sm font-medium disabled:opacity-40">{running ? 'Checking...' : 'Run system check'}</button>
          <button type="button" disabled={!finished || !requiredPassed || running} onClick={continueToAssessment} className="rounded-lg bg-[color:var(--text-primary)] px-5 py-2.5 text-sm font-semibold text-[color:var(--bg-canvas)] disabled:opacity-40">Continue</button>
        </div>
      </div>
    </main>
  )
}
