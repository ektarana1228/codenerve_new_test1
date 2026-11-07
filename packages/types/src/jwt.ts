import { z } from 'zod'

// ─── JWT payload shapes ───────────────────────────────────────────────────────
// Matches the JWT payload definitions in CLAUDE.md § Authentication

export const AdminJwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(['MASTER', 'ADMIN']),
  iat: z.number().int(),
  exp: z.number().int(),
})

export const CandidateJwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.literal('STUDENT'),
  session_id: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
})

// Discriminated union - use role to narrow to the specific payload type
export const JwtPayloadSchema = z.discriminatedUnion('role', [
  AdminJwtPayloadSchema,
  CandidateJwtPayloadSchema,
])

export type AdminJwtPayload = z.infer<typeof AdminJwtPayloadSchema>
export type CandidateJwtPayload = z.infer<typeof CandidateJwtPayloadSchema>
export type JwtPayload = z.infer<typeof JwtPayloadSchema>
