/**
 * API-facing entity schemas.
 *
 * These mirror the Prisma models but are used for API serialisation and
 * request/response validation - not for DB access. DB access uses the
 * Prisma-generated types from @platform/db directly.
 *
 * Dates are ISO 8601 strings (JSON wire format).
 * Internal-only fields (passwordHash, openrouterKeyEncrypted) are omitted.
 */

import { z } from 'zod'
import {
  RoleSchema,
  AssessmentStatusSchema,
  LanguageSchema,
  AiuMetricSchema,
  DifficultySchema,
  SessionStatusSchema,
  ProctoringModeSchema,
} from './enums'

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: RoleSchema,
  createdAt: z.string().datetime(),
  // passwordHash intentionally excluded - never sent over the wire
})

export const InviteTokenSchema = z.object({
  id: z.string().uuid(),
  token: z.string().uuid(),
  assessmentId: z.string().uuid(),
  candidateName: z.string(),
  candidateEmail: z.string().email().nullish(),
  usedAt: z.string().datetime().nullish(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
})

export const AssessmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullish(),
  createdBy: z.string().uuid(),
  timeLimitMinutes: z.number().int().positive(),
  language: LanguageSchema,
  llmModel: z.string(),
  projectScoringCriteria: z.array(z.object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    weight: z.number(),
  })).optional(),
  codeWeight: z.number().int().min(0).max(100),
  aiuWeight: z.number().int().min(0).max(100),
  aiuMetrics: z.array(AiuMetricSchema),
  aiuMetricWeights: z.record(z.string(), z.number()),
  screenRecording: ProctoringModeSchema,
  videoProctoring: ProctoringModeSchema,
  microphoneRecording: ProctoringModeSchema,
  secondCamera: ProctoringModeSchema,
  status: AssessmentStatusSchema,
  scheduledStart: z.string().datetime().nullish(),
  expiresAt: z.string().datetime().nullish(),
  createdAt: z.string().datetime(),
})

export const ProblemSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  title: z.string(),
  description: z.string(), // Markdown
  difficulty: DifficultySchema,
  createdAt: z.string().datetime(),
})

export const TestCaseSchema = z.object({
  id: z.string().uuid(),
  problemId: z.string().uuid(),
  input: z.string(),
  expected: z.string(),
  isHidden: z.boolean(),
  category: z.enum(['BASIC', 'STANDARD', 'EDGE', 'ROBUSTNESS', 'PERFORMANCE']).default('STANDARD'),
  weight: z.number().positive().default(1),
  isCritical: z.boolean().default(false),
  createdAt: z.string().datetime(),
})

// Variant returned to candidates - isHidden is stripped (all visible by definition at this point)
export const VisibleTestCaseSchema = z.object({
  id: z.string().uuid(),
  input: z.string(),
  expected: z.string(),
})

export const SessionSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  candidateId: z.string().uuid(),
  language: LanguageSchema,
  status: SessionStatusSchema,
  currentCode: z.string(),
  startedAt: z.string().datetime().nullish(),
  submittedAt: z.string().datetime().nullish(),
  expiresAt: z.string().datetime().nullish(),
})

export const SessionScoreSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  codeCorrectnessScore: z.number().min(0).max(100),
  aiuScores: z.record(z.string(), z.number()),
  aiuTotalScore: z.number().min(0).max(100),
  totalScore: z.number().min(0).max(100),
  scoredAt: z.string().datetime(),
})

export const InteractionLogSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  turnNumber: z.number().int().positive(),
  activeFile: z.string().nullable().optional(),
  contextSnapshot: z.string().nullable().optional(),
  aiEdits: z.record(z.string(), z.object({ before: z.string(), after: z.string() })).nullable().optional(),
  promptText: z.string(),
  responseText: z.string(),
  timestamp: z.string().datetime(),
})

// SystemConfig exposes no secret fields
export const SystemConfigSchema = z.object({
  id: z.string(),
  hasOpenrouterKey: z.boolean(), // derived: true when openrouterKeyEncrypted is non-null
  updatedAt: z.string().datetime(),
})

export type User = z.infer<typeof UserSchema>
export type InviteToken = z.infer<typeof InviteTokenSchema>
export type Assessment = z.infer<typeof AssessmentSchema>
export type Problem = z.infer<typeof ProblemSchema>
export type TestCase = z.infer<typeof TestCaseSchema>
export type VisibleTestCase = z.infer<typeof VisibleTestCaseSchema>
export type Session = z.infer<typeof SessionSchema>
export type SessionScore = z.infer<typeof SessionScoreSchema>
export type InteractionLog = z.infer<typeof InteractionLogSchema>
export type SystemConfig = z.infer<typeof SystemConfigSchema>
