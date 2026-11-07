/**
 * Direct HTTP helpers that call backend APIs outside the browser.
 * Used by global-setup and fixtures for seeding and token-injection.
 */

const AUTH_URL = process.env.AUTH_API_URL ?? 'http://localhost:3100'

export type AdminLoginResponse = {
  data: { access_token: string }
}

/** Log in as admin and return the JWT. Called from Node.js context (not browser). */
export async function adminLoginDirect(email: string, password: string): Promise<string> {
  const res = await fetch(`${AUTH_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Admin login failed (${res.status}): ${body}`)
  }
  const json = (await res.json()) as AdminLoginResponse
  return json.data.access_token
}

export type GenerateInviteResponse = {
  data: { token: string; invite_url: string }
}

/** Generate an invite token for an assessment via the auth API. */
export async function generateInviteTokenDirect(
  adminJwt: string,
  assessmentId: string,
  candidateName: string,
  candidateEmail: string,
): Promise<{ token: string; inviteUrl: string }> {
  const res = await fetch(`${AUTH_URL}/api/v1/auth/invite-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminJwt}`,
    },
    body: JSON.stringify({ assessment_id: assessmentId, candidate_name: candidateName, candidate_email: candidateEmail }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Generate invite failed (${res.status}): ${body}`)
  }
  const json = (await res.json()) as GenerateInviteResponse
  return { token: json.data.token, inviteUrl: json.data.invite_url }
}

/** Build the candidate app invite URL from a raw token UUID. */
export function buildInviteUrl(
  token: string,
  candidateBaseUrl = process.env.CANDIDATE_BASE_URL ?? 'http://localhost:3000',
): string {
  return `${candidateBaseUrl}/start?token=${token}`
}
