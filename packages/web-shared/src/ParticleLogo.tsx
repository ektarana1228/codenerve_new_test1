import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'

// Same cube geometry/gradients as Logo.tsx and apexcoder-symbol.svg, sampled into a
// particle field so it can scatter away from the cursor and settle back. Canvas 2D only
// (no particle library) - the shape is fixed and small, hand-rolled is the smaller diff.

const R = 260 // internal sampling/render resolution, downscaled to `size` via CSS
const STEP = 2 // sampling stride - lower = denser grain, more particles (perf cost is O(1/STEP²))
const ROT_MS = 9000 // matches the CSS cube's 9s revolution (theme.css .ax-cube)
const REPEL_RADIUS = 50
const REPEL_STRENGTH = 7
const SPRING = 0.02
const DAMPING = 0.85

type Particle = { radius: number; baseAngle: number; ox: number; oy: number; vx: number; vy: number; color: string }

function sampleParticles(): Particle[] {
  const c = document.createElement('canvas')
  c.width = R
  c.height = R
  const ctx = c.getContext('2d')!
  const s = R / 48
  ctx.scale(s, s)

  const top = ctx.createLinearGradient(8, 6, 40, 24)
  top.addColorStop(0, '#3B82F6')
  top.addColorStop(1, '#2563EB')
  const side = ctx.createLinearGradient(8, 14, 24, 42)
  side.addColorStop(0, '#7C3AED')
  side.addColorStop(1, '#D946EF')
  const front = ctx.createLinearGradient(24, 16, 40, 42)
  front.addColorStop(0, '#3B82F6')
  front.addColorStop(1, '#8B5CF6')

  ctx.fillStyle = top
  ctx.fill(new Path2D('M24 5 41 14.5 24 24 7 14.5 24 5Z'))
  ctx.fillStyle = side
  ctx.fill(new Path2D('M7 14.5 24 24v18.5L7 33V14.5Z'))
  ctx.fillStyle = front
  ctx.fill(new Path2D('M41 14.5 24 24v18.5L41 33V14.5Z'))

  const { data } = ctx.getImageData(0, 0, R, R)
  const cx = R / 2
  const cy = R / 2
  const particles: Particle[] = []
  for (let y = 0; y < R; y += STEP) {
    for (let x = 0; x < R; x += STEP) {
      const i = (y * R + x) * 4
      if (data[i + 3] < 128) continue
      const dx = x - cx
      const dy = y - cy
      particles.push({
        radius: Math.hypot(dx, dy),
        baseAngle: Math.atan2(dy, dx),
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
        color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`,
      })
    }
  }
  return particles
}

export function ParticleLogo({ size = 96, className }: { size?: number; className?: string }) {
  const reduce = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // Backing store must match physical pixels or the browser upscales it, blockifying the dots.
    const dpr = window.devicePixelRatio || 1
    canvas.width = R * dpr
    canvas.height = R * dpr
    ctx.scale(dpr, dpr)
    const particles = sampleParticles()
    const cx = R / 2
    const cy = R / 2

    function draw(angleOffset: number) {
      ctx.clearRect(0, 0, R, R)
      const mouse = mouseRef.current
      for (const p of particles) {
        const angle = p.baseAngle + angleOffset
        const homeX = cx + p.radius * Math.cos(angle)
        const homeY = cy + p.radius * Math.sin(angle)

        if (mouse) {
          const ddx = homeX + p.ox - mouse[0]
          const ddy = homeY + p.oy - mouse[1]
          const dist = Math.hypot(ddx, ddy) || 0.001
          if (dist < REPEL_RADIUS) {
            const force = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH
            p.vx += (ddx / dist) * force
            p.vy += (ddy / dist) * force
          }
        }
        p.vx += -p.ox * SPRING
        p.vy += -p.oy * SPRING
        p.vx *= DAMPING
        p.vy *= DAMPING
        p.ox += p.vx
        p.oy += p.vy

        ctx.fillStyle = p.color
        ctx.fillRect(homeX + p.ox, homeY + p.oy, 2.2, 2.2)
      }
    }

    if (reduce) {
      draw(0)
      return
    }

    let rafId: number
    const start = performance.now()
    function frame(now: number) {
      draw(((now - start) % ROT_MS) * ((2 * Math.PI) / ROT_MS))
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [reduce])

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scale = R / rect.width
    mouseRef.current = [(e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale]
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      width={R}
      height={R}
      className={className}
      style={{ width: size, height: size }}
      onPointerMove={reduce ? undefined : handlePointerMove}
      onPointerLeave={reduce ? undefined : () => (mouseRef.current = null)}
    />
  )
}
