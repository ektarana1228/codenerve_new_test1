import jwt from 'jsonwebtoken'

// The iframe and its WebSockets cannot send an Authorization header, so the
// proxy authenticates them with a short-lived, session-scoped token carried in
// the `tkn` query string. `ensure` mints it after validating the candidate's
// real JWT; the proxy only has to verify this cheap token per asset request.

const PROXY_AUD = 'vscode-proxy'
const TTL_SECONDS = 15 * 60

// Cookie carrying the proxy token. Set at `ensure` time and scoped to the
// session's base path, so the browser sends it on EVERY /vscode/<id>/* request -
// assets, redirects, and the WebSocket - not just the first (a query param only
// rides the first request; VS Code's own 302 to the base path drops it).
export const COOKIE_NAME = 'vs_proxy'

export function mintProxyToken(sessionId: string, secret: string): string {
  return jwt.sign({ sub: sessionId, aud: PROXY_AUD }, secret, { expiresIn: TTL_SECONDS })
}

export function proxyCookie(sessionId: string, token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/vscode/${sessionId}; HttpOnly; SameSite=Lax`
}

// Pull the proxy token out of a Cookie header, if present.
export function tokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE_NAME) return v.join('=')
  }
  return null
}

// Returns the session id the token is scoped to, or null if invalid/expired.
export function verifyProxyToken(token: string, secret: string): string | null {
  try {
    const decoded = jwt.verify(token, secret, { audience: PROXY_AUD }) as { sub?: string }
    return typeof decoded.sub === 'string' ? decoded.sub : null
  } catch {
    return null
  }
}
