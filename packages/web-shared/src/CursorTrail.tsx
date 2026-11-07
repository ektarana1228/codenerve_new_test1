import { useEffect, useRef } from 'react'

// The "signal trail" (design.md §8): a soft violet glow that lags the pointer and warms
// toward an element's accent when hovering interactive targets marked data-cursor="green|violet".
// Single fixed layer, pointer-events:none, transform-driven, rAF-throttled. Off on coarse
// pointers and prefers-reduced-motion - it's ambient polish, nothing depends on it.
const ACCENTS: Record<string, string> = {
  green: 'var(--signal-green)',
  violet: 'var(--signal-violet)',
}

export function CursorTrail() {
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (coarse || reduce) return

    const dot = dotRef.current!
    let tx = window.innerWidth / 2
    let ty = window.innerHeight / 2
    let x = tx
    let y = ty
    let raf = 0

    function onMove(e: PointerEvent) {
      tx = e.clientX
      ty = e.clientY
      const target = (e.target as Element | null)?.closest('[data-cursor]')
      const accent = target ? ACCENTS[target.getAttribute('data-cursor') || ''] : undefined
      dot.style.background = accent || 'var(--signal-violet)'
      dot.style.width = dot.style.height = target ? '10px' : '16px'
    }

    function tick() {
      x += (tx - x) * 0.35 // lag → comet wake that catches up on stop
      y += (ty - y) * 0.35
      dot.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 16,
        height: 16,
        borderRadius: '9999px',
        background: 'var(--signal-violet)',
        opacity: 0.4,
        filter: 'blur(4px)',
        pointerEvents: 'none',
        zIndex: 9999,
        transition: 'width var(--dur-2), height var(--dur-2), background var(--dur-2)',
      }}
    />
  )
}
