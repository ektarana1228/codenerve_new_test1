import { useId } from 'react'

// apexcoder.io brand logo - gradient cube + wordmark. Inline SVG so it themes
// and scales cleanly (no raster asset). Wordmark uses design tokens (design.md) with
// hex fallbacks so it stays visible even where theme.css isn't loaded yet.

type LogoProps = {
  /** Height of the mark in px; wordmark scales with it. */
  size?: number
  /** Show the wordmark next to the mark. */
  withWordmark?: boolean
  /** Override the default "apexcoder.io" wordmark with a plain label (e.g. "ApexCoder"). */
  label?: string
  className?: string
}

export function Logo({ size = 32, withWordmark = true, label, className }: LogoProps) {
  // Unique gradient ids so multiple logos on one page don't collide (SSR-safe).
  const uid = useId()
  return (
    <span className={['inline-flex items-center gap-2.5', className].filter(Boolean).join(' ')}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={`${uid}-top`} x1="8" y1="6" x2="40" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3B82F6" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
          <linearGradient id={`${uid}-side`} x1="8" y1="14" x2="24" y2="42" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7C3AED" />
            <stop offset="1" stopColor="#D946EF" />
          </linearGradient>
          <linearGradient id={`${uid}-front`} x1="24" y1="16" x2="40" y2="42" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3B82F6" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        {/* isometric cube: top face, left face, right face */}
        <path d="M24 5 41 14.5 24 24 7 14.5 24 5Z" fill={`url(#${uid}-top)`} />
        <path d="M7 14.5 24 24v18.5L7 33V14.5Z" fill={`url(#${uid}-side)`} />
        <path d="M41 14.5 24 24v18.5L41 33V14.5Z" fill={`url(#${uid}-front)`} />
      </svg>
      {withWordmark && (
        <span
          className="font-sans font-bold tracking-tight"
          style={{ fontSize: size * 0.62, color: 'var(--text-primary, #0f1115)' }}
        >
          {label ? label : <>apexcoder<span style={{ color: 'var(--status-link, #2b6cf3)' }}>.io</span></>}
        </span>
      )}
    </span>
  )
}
