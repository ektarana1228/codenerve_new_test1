import { z } from 'zod'

export const RoleSchema = z.enum(['MASTER', 'ADMIN', 'STUDENT'])
export const AssessmentStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED'])
export const AssessmentKindSchema = z.enum(['CODING', 'PROJECT'])
export const LanguageSchema = z.enum(['PYTHON', 'JAVASCRIPT', 'TYPESCRIPT'])
export const AiuMetricSchema = z.enum([
  'PROMPT_QUALITY',
  'ITERATION_EFFICIENCY',
  'INDEPENDENT_EDITING',
  'CONTEXTUAL_RELEVANCE',
])
export const DifficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD'])
export const SessionStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUBMITTED', 'EXPIRED'])
export const ProctoringModeSchema = z.enum(['OFF', 'OPTIONAL', 'REQUIRED'])
export const ScoringStrictnessSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'EXTRA_HIGH'])
export const AiAssistantModeSchema = z.enum(['AGENTIC', 'NON_AGENTIC', 'DISABLED'])

export type Role = z.infer<typeof RoleSchema>
export type AssessmentStatus = z.infer<typeof AssessmentStatusSchema>
export type AssessmentKind = z.infer<typeof AssessmentKindSchema>
export type Language = z.infer<typeof LanguageSchema>
export type AiuMetric = z.infer<typeof AiuMetricSchema>
export type Difficulty = z.infer<typeof DifficultySchema>
export type SessionStatus = z.infer<typeof SessionStatusSchema>
export type ProctoringMode = z.infer<typeof ProctoringModeSchema>
export type ScoringStrictness = z.infer<typeof ScoringStrictnessSchema>
export type AiAssistantMode = z.infer<typeof AiAssistantModeSchema>
