// Shared browser code for web-candidate and web-admin.

// Parse a raw token or a pasted invite URL (?token=...) down to the bare token.
export function parseInviteToken(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.searchParams.get('token') || null
  } catch {
    return trimmed // not a URL - treat as the token itself
  }
}

export { Logo } from './Logo'
export { SpinningCube } from './SpinningCube'
export { ParticleLogo } from './ParticleLogo'
export { Reveal } from './Reveal'
export { LandingPage } from './LandingPage'
export { ThemeToggle } from './ThemeToggle'
export { CursorTrail } from './CursorTrail'
export { ADMIN_URL, CANDIDATE_URL } from './appUrls'