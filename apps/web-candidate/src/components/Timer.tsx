import { useEffect } from 'react'
import { useSessionStore } from '../store/session'

interface Props {
  onExpire: () => void
  paused?: boolean
  displaySeconds?: number | null
}

export function Timer({ onExpire, paused = false, displaySeconds }: Props) {
  const timeRemaining = useSessionStore((s) => s.timeRemaining)
  const setTimeRemaining = useSessionStore((s) => s.setTimeRemaining)
  const status = useSessionStore((s) => s.status)

  useEffect(() => {
    if (paused || status !== 'active') return
    if (timeRemaining === null) return
    if (timeRemaining <= 0) {
      onExpire()
      return
    }

    const id = setTimeout(() => {
      setTimeRemaining(timeRemaining - 1)
    }, 1000)

    return () => clearTimeout(id)
  }, [paused, timeRemaining, status, setTimeRemaining, onExpire])

  if (timeRemaining === null) return null

  const display = Math.max(0, displaySeconds ?? timeRemaining)
  const minutes = Math.floor(display / 60)
  const seconds = display % 60
  // Escalate by motion, not alarm (design.md §8): calm → warn <5:00 → breathe <1:00
  const isWarn = display < 300
  const isCritical = display < 60

  return (
    <span
      aria-label={`${minutes} minutes ${seconds} seconds remaining`}
      className={`font-mono text-lg font-bold tabular-nums ${isCritical ? 'ax-breathe' : ''}`}
      style={{ color: isWarn ? 'var(--status-warn)' : 'var(--text-primary)' }}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </span>
  )
}
