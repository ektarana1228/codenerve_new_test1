import jwt from 'jsonwebtoken'
import { JwtPayloadSchema, type JwtPayload } from '@platform/types'

/**
 * Signs a JWT for an admin user. 8-hour expiry per spec.
 * Payload: { sub, role: "ADMIN" | "MASTER", iat, exp }
 */
export function signAdminToken(userId: string, secret: string, role: 'ADMIN' | 'MASTER' = 'ADMIN'): string {
  return jwt.sign({ sub: userId, role }, secret, { expiresIn: '8h' })
}

/**
 * Signs a JWT for a candidate session. Expiry is derived from the session's
 * expiresAt so the token and session die together.
 * Payload: { sub, role: "STUDENT", session_id, iat, exp }
 */
export function signCandidateToken(
  userId: string,
  sessionId: string,
  expiresAt: Date,
  secret: string,
): string {
  const expiresInSec = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  return jwt.sign(
    { sub: userId, role: 'STUDENT', session_id: sessionId },
    secret,
    { expiresIn: expiresInSec },
  )
}

/**
 * Verifies a JWT signature and parses the payload against our typed schema.
 * Throws JsonWebTokenError / TokenExpiredError on bad/expired signature.
 * Throws ZodError if the payload shape doesn't match.
 * Let callers decide how to surface these errors.
 */
export function verifyAndParseToken(token: string, secret: string): JwtPayload {
  const decoded = jwt.verify(token, secret)
  return JwtPayloadSchema.parse(decoded)
}
