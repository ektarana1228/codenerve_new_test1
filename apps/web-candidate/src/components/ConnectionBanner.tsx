import { useEffect, useRef, useState, useCallback } from 'react'
import { useSessionStore } from '../store/session'

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRY_INTERVAL_MS = 3_000   // retry every 3 seconds
const MAX_RETRY_MS = 60_000       // give up after 60 seconds

type BannerState = 'hidden' | 'reconnecting' | 'failed'

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Listens for the 'connection-lost' custom event dispatched by the API client
 * whenever a network-level fetch failure occurs.
 *
 * Retry loop:
 *   1. Retry GET /api/v1/sessions/:id every 3 seconds for up to 60 seconds
 *   2. On success: restore code + timeRemaining from server (server is source of truth)
 *   3. After 60 s without reconnect: switch to "please refresh" state
 *
 * Only activates when a session is in progress (session_id + token are set).
 * Does not block editor interaction at any point.
 */
export function ConnectionBanner() {
  const session_id = useSessionStore((s) => s.session_id)
  const token = useSessionStore((s) => s.token)
  const restoreFromServer = useSessionStore((s) => s.restoreFromServer)
  const setTimeRemaining = useSessionStore((s) => s.setTimeRemaining)

  const [bannerState, setBannerState] = useState<BannerState>('hidden')

  const retryStartRef = useRef<number>(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Reconnect attempt ────────────────────────────────────────────────────────

  const attemptReconnect = useCallback(async () => {
    if (!session_id || !token) return

    const elapsed = Date.now() - retryStartRef.current
    if (elapsed >= MAX_RETRY_MS) {
      setBannerState('failed')
      return
    }

    try {
      const res = await fetch(`/api/v1/sessions/${session_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) throw new Error('server error')

      const body = await res.json() as {
        data: { current_code: string; time_remaining: number | null }
      }

      // Restore from server - client never trusts its own local state (CLAUDE.md).
      // restoreFromServer handles both plain strings and multi-file JSON.
      if (typeof body.data.current_code === 'string') {
        restoreFromServer(body.data.current_code)
      }
      if (typeof body.data.time_remaining === 'number') {
        setTimeRemaining(body.data.time_remaining)
      }

      // Tell the VS Code frame to re-ensure - the orchestrator may have restarted
      // and lost its in-memory proxy record while we were offline.
      window.dispatchEvent(new CustomEvent('connection-restored'))

      setBannerState('hidden')
    } catch {
      // Still offline - schedule next attempt
      retryTimerRef.current = setTimeout(attemptReconnect, RETRY_INTERVAL_MS)
    }
  }, [session_id, token, restoreFromServer, setTimeRemaining])

  // ── Start reconnect loop ──────────────────────────────────────────────────────

  const startReconnecting = useCallback(() => {
    // Ignore if already reconnecting or no active session
    if (!session_id || !token) return
    if (bannerState === 'reconnecting') return

    retryStartRef.current = Date.now()
    setBannerState('reconnecting')

    // First attempt starts immediately
    retryTimerRef.current = setTimeout(attemptReconnect, RETRY_INTERVAL_MS)
  }, [session_id, token, bannerState, attemptReconnect])

  // ── Listen for 'connection-lost' events from the API client ──────────────────

  useEffect(() => {
    const handleConnectionLost = () => startReconnecting()
    window.addEventListener('connection-lost', handleConnectionLost)
    return () => window.removeEventListener('connection-lost', handleConnectionLost)
  }, [startReconnecting])

  // ── Cleanup pending timer on unmount ─────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current)
    }
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────────

  if (bannerState === 'hidden') return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2',
        'px-4 py-2.5 text-sm font-medium',
        bannerState === 'reconnecting'
          ? 'bg-[color:var(--status-warn)] text-white'
          : 'bg-[color:var(--status-fail)] text-white',
      ].join(' ')}
    >
      {bannerState === 'reconnecting' ? (
        <>
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          You've been disconnected. Reconnecting…
        </>
      ) : (
        <>
          <svg
            className="h-4 w-4 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          Please refresh the page. Your code is saved.
        </>
      )}
    </div>
  )
}
