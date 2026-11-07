// apexcoder brand cube in real 3D CSS (no dependency), revolving continuously on Y.
// Reduced-motion rests it facing front (see theme.css). Decorative → aria-hidden.
const FACE_BG: Record<string, string> = {
  front: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
  back: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
  right: 'linear-gradient(135deg,#7c3aed,#d946ef)',
  left: 'linear-gradient(135deg,#7c3aed,#d946ef)',
  top: 'linear-gradient(135deg,#60a5fa,#3b82f6)',
  bottom: 'linear-gradient(135deg,#4f46e5,#2563eb)',
}

export function SpinningCube({ size = 76, className = '' }: { size?: number; className?: string }) {
  const h = size / 2
  const faceTransform: Record<string, string> = {
    front: `translateZ(${h}px)`,
    back: `rotateY(180deg) translateZ(${h}px)`,
    right: `rotateY(90deg) translateZ(${h}px)`,
    left: `rotateY(-90deg) translateZ(${h}px)`,
    top: `rotateX(90deg) translateZ(${h}px)`,
    bottom: `rotateX(-90deg) translateZ(${h}px)`,
  }
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{ width: size, height: size, perspective: size * 6 }}
    >
      <div className="ax-cube" style={{ position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d' }}>
        {Object.keys(faceTransform).map((k) => (
          <div
            key={k}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              background: FACE_BG[k],
              transform: faceTransform[k],
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 8,
            }}
          />
        ))}
      </div>
    </div>
  )
}
