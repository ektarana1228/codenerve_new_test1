import { z } from 'zod'
import { LanguageSchema } from './enums'

// ─── Envelope helpers ─────────────────────────────────────────────────────────

/** Wraps any schema in { data: T } */
export const apiSuccess = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({ data: dataSchema })

/** Wraps any schema in { data: T[], next_cursor: string | null } */
export const apiList = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    next_cursor: z.string().nullable(),
  })

// TypeScript utility generics - use when you don't need runtime Zod parsing
export type ApiSuccess<T> = { data: T }
export type ApiList<T> = { data: T[]; next_cursor: string | null }

// ─── Error shapes ─────────────────────────────────────────────────────────────

export const ApiErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'UNDER_REVIEW',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'SESSION_EXPIRED',
  'TOKEN_USED',
  'TOKEN_EXPIRED',
  'RATE_LIMITED',
  'EXECUTION_TIMEOUT',
  'SUBMISSION_LOCKED',
  'LLM_TIMEOUT',
  'STORAGE_UNAVAILABLE',
  'CONFLICT',
  'INTERNAL_SERVER_ERROR',
])

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
  }),
})

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>

// ─── Auth responses ───────────────────────────────────────────────────────────

export const LoginResponseSchema = z.object({
  data: z.object({
    access_token: z.string(),
  }),
})

export const StartSessionResponseSchema = z.object({
  data: z.object({
    access_token: z.string(),
    session_id: z.string().uuid(),
    problem: z.object({
      id: z.string().uuid(),
      title: z.string(),
      description: z.string(),
      difficulty: z.string(),
      allow_copy_paste: z.boolean(),
      visible_test_cases: z.array(
        z.object({
          id: z.string().uuid(),
          input: z.string(),
          expected: z.string(),
        }),
      ),
    }),
    assessment: z.object({
      title: z.string(),
      time_limit_minutes: z.number().int(),
      language: LanguageSchema,
      llm_model: z.string(),
    }),
  }),
})

// ─── Code auto-save response ──────────────────────────────────────────────────

export const SaveCodeResponseSchema = z.object({
  data: z.object({
    saved_at: z.string().datetime(),
  }),
})

// ─── LLM gateway response ─────────────────────────────────────────────────────

export const LlmChatResponseSchema = z.object({
  data: z.object({
    response: z.string(),
    turn_number: z.number().int().positive(),
  }),
})

// ─── Inferred types ───────────────────────────────────────────────────────────

export type LoginResponse = z.infer<typeof LoginResponseSchema>
export type StartSessionResponse = z.infer<typeof StartSessionResponseSchema>
export type SaveCodeResponse = z.infer<typeof SaveCodeResponseSchema>
export type LlmChatResponse = z.infer<typeof LlmChatResponseSchema>
