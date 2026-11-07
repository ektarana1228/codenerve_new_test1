import { z } from 'zod'
import {
  LanguageSchema,
  AiuMetricSchema,
  DifficultySchema,
  AssessmentStatusSchema,
  AssessmentKindSchema,
  ProctoringModeSchema,
  ScoringStrictnessSchema,
  AiAssistantModeSchema,
} from './enums'

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const PasswordPolicySchema = z
  .string()
  .min(8)
  .max(20)
  .refine((value) => /[a-z]/.test(value), {
    message: 'Password must include at least one lowercase letter',
  })
  .refine((value) => /[A-Z]/.test(value), {
    message: 'Password must include at least one uppercase letter',
  })
  .refine((value) => /\d/.test(value), {
    message: 'Password must include at least one number',
  })
  .refine((value) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(value), {
    message: 'Password must include at least one special character',
  })

export const CreateAdminAccountRequestSchema = z.object({
  email: z.string().email(),
  password: PasswordPolicySchema,
})

export const CreateAdminSignupRequestSchema = CreateAdminAccountRequestSchema.extend({
  fullName: z.string().min(1).max(120).optional(),
  companyName: z.string().min(1).max(120).optional(),
})

// Candidate presents an invite token UUID plus the email the invite was sent
// to (verified server-side against InviteToken.candidateEmail). Name is just
// a display label and is never checked against the invite.
export const StartSessionRequestSchema = z.object({
  token: z.string().uuid(),
  candidate_name: z.string().min(1).max(255).optional(),
  candidate_email: z.string().email(),
})

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const SaveCodeRequestSchema = z.object({
  code: z.string(),
  remaining_seconds: z.number().int().nonnegative().optional(),
})

// ─── LLM Gateway ──────────────────────────────────────────────────────────────

export const LlmChatRequestSchema = z.object({
  prompt: z.string().min(1),
  session_id: z.string().uuid(),
})

// ─── Assessments ──────────────────────────────────────────────────────────────

// PROJECT-kind building blocks.
export const ConnectionDetailSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
})

export const SubmissionFileSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).default(''),
})

// A reference file the admin uploads for a PROJECT assessment. It is seeded into
// the candidate's VS Code workspace (under reference/). Content is base64 so
// binary assets (zips, notebooks, images) survive the round-trip. Paths must be
// relative and free of parent-directory traversal.
export const ReferenceFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(400)
    .refine((p) => !p.startsWith('/') && !p.includes('..') && !/^[a-zA-Z]:/.test(p), {
      message: 'Reference file path must be relative and must not contain ".."',
    }),
  contentBase64: z.string().max(8_000_000), // ~6 MB decoded per file
})

export const ProjectScoringCriterionSchema = z.object({
  key: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1500).refine((value) => value.trim().split(/\s+/).filter(Boolean).length <= 200, {
    message: 'Criterion description must be 200 words or fewer',
  }),
  weight: z.number().int().min(0).max(100),
})

const DEFAULT_PROJECT_SCORING_CRITERIA = [
  { key: 'acceptance_functional_correctness', name: 'Acceptance and Functional Correctness', description: 'Score whether the final submission implements the requested behavior, satisfies the task acceptance criteria and Done when requirements, and handles relevant edge cases. Do not award full credit merely because code exists or was produced by AI.', weight: 30 },
  { key: 'verification_regression_safety', name: 'Verification and Regression Safety', description: 'Score the evidence that the candidate tested or otherwise verified the change, investigated failures, and preserved existing behavior. Penalize missing validation, ignored contracts, regressions, and unsafe migration behavior.', weight: 20 },
  { key: 'technical_reasoning_ai_direction', name: 'Technical Reasoning and AI Direction', description: 'Score how effectively the candidate decomposed the task, gave the AI relevant constraints and context, evaluated its output, corrected mistakes, and used purposeful iterations rather than blindly accepting a generated answer.', weight: 20 },
  { key: 'independent_engineering_contribution', name: 'Independent Engineering Contribution', description: 'Score the candidate\'s own review, edits, decisions, debugging, and meaningful improvements beyond directly accepting AI-generated work. Full credit requires clear evidence of independent engineering judgment.', weight: 15 },
  { key: 'architecture_migration_quality', name: 'Architecture and Migration Quality', description: 'Score compatibility with the existing architecture, maintainability, data and configuration safety, migration sequencing, rollback awareness, and whether the solution addresses the root cause without damaging surrounding systems.', weight: 10 },
  { key: 'scope_code_quality', name: 'Scope and Code Quality', description: 'Score whether the changes are focused, clear, reviewable, and free from hard-coded shortcuts, dead code, unnecessary rewrites, formatting churn, and unrelated modifications.', weight: 5 },
]

const DEFAULT_PROJECT_CRITERIA_BY_KEY = new Map(DEFAULT_PROJECT_SCORING_CRITERIA.map((criterion) => [criterion.key, criterion]))

function canonicalizeProjectCriteria(criteria: z.infer<typeof ProjectScoringCriterionSchema>[]) {
  return criteria.map((criterion) => {
    const canonical = DEFAULT_PROJECT_CRITERIA_BY_KEY.get(criterion.key)
    return canonical ? { ...criterion, name: canonical.name, description: canonical.description } : criterion
  })
}

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1), // Markdown
  // "Done when" acceptance criteria - at least one bullet.
  doneWhen: z.array(z.string().min(1)).min(1),
  // Set when this task was added from the bug-fix bank - carries the SQS
  // iteration baseline and scopes solutionFiles lookups to this entry's files.
  difficulty: DifficultySchema.optional(),
  bugBankId: z.string().min(1).max(100).optional(),
})

export const CreateAssessmentRequestSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    kind: AssessmentKindSchema.default('CODING'),
    timeLimitMinutes: z.number().int().min(1).max(480),
    language: LanguageSchema,
    llmModel: z.string().min(1),
    codeWeight: z.number().int().min(0).max(100),
    aiuWeight: z.number().int().min(0).max(100),
    aiuMetrics: z.array(AiuMetricSchema).min(1),
    // Keys are lowercase AiuMetric values, values are integer percentages
    aiuMetricWeights: z.record(z.string(), z.number()),
    // Editor clipboard gate for the whole assessment (both kinds).
    allowCopyPaste: z.boolean().default(false),
    aiAssistantMode: AiAssistantModeSchema.optional(),
    scoringStrictness: ScoringStrictnessSchema.default('MEDIUM'),
    screenRecording: ProctoringModeSchema.default('OFF'),
    videoProctoring: ProctoringModeSchema.default('OFF'),
    microphoneRecording: ProctoringModeSchema.default('OFF'),
    secondCamera: ProctoringModeSchema.default('OFF'),
    // PROJECT kind only (ignored for CODING).
    allowedModels: z.array(z.string().min(1)).default([]),
    templateInfo: z.string().optional(),
    connectionDetails: z.array(ConnectionDetailSchema).default([]),
    submissionFiles: z.array(SubmissionFileSchema).default([]),
    referenceFiles: z.array(ReferenceFileSchema).max(200).default([]),
    projectScoringCriteria: z.array(ProjectScoringCriterionSchema).default(DEFAULT_PROJECT_SCORING_CRITERIA).transform(canonicalizeProjectCriteria),
    // Admin-only reference fix used by SQS scoring - never seeded to the
    // candidate workspace, never returned on any candidate-facing route.
    solutionFiles: z.array(ReferenceFileSchema).max(200).default([]),
    tasks: z.array(CreateTaskRequestSchema).default([]),
    scheduledStart: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .refine((d) => d.kind === 'PROJECT' || d.codeWeight + d.aiuWeight === 100, {
    message: 'codeWeight and aiuWeight must sum to 100',
    path: ['codeWeight'],
  })
  .refine((d) => d.kind === 'PROJECT' || (d.aiAssistantMode ?? 'DISABLED') === 'DISABLED', {
    message: 'Coding assessments require AI assistant mode to be disabled',
    path: ['aiAssistantMode'],
  })
  .refine(
    (d) => {
      if (d.kind === 'PROJECT') return true
      const sum = Object.values(d.aiuMetricWeights).reduce((a, b) => a + b, 0)
      return sum === 100
    },
    {
      message: 'AIU metric weights must sum to 100',
      path: ['aiuMetricWeights'],
    },
  )
  // PROJECT assessments must ship with at least one task.
  .refine((d) => d.kind !== 'PROJECT' || d.tasks.length >= 1, {
    message: 'A project assessment needs at least one task',
    path: ['tasks'],
  })
  .refine(
    (d) => d.kind !== 'PROJECT' || d.projectScoringCriteria.reduce((sum, c) => sum + c.weight, 0) === 100,
    {
      message: 'Project scoring criteria weights must sum to 100',
      path: ['projectScoringCriteria'],
    },
  )

export const UpdateAssessmentRequestSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    timeLimitMinutes: z.number().int().min(1).max(480).optional(),
    language: LanguageSchema.optional(),
    llmModel: z.string().min(1).optional(),
    codeWeight: z.number().int().min(0).max(100).optional(),
    aiuWeight: z.number().int().min(0).max(100).optional(),
    aiuMetrics: z.array(AiuMetricSchema).min(1).optional(),
    aiuMetricWeights: z.record(z.string(), z.number()).optional(),
    allowCopyPaste: z.boolean().optional(),
    aiAssistantMode: AiAssistantModeSchema.optional(),
    scoringStrictness: ScoringStrictnessSchema.optional(),
    projectScoringCriteria: z.array(ProjectScoringCriterionSchema).transform(canonicalizeProjectCriteria).optional(),
    screenRecording: ProctoringModeSchema.optional(),
    videoProctoring: ProctoringModeSchema.optional(),
    microphoneRecording: ProctoringModeSchema.optional(),
    secondCamera: ProctoringModeSchema.optional(),
    scheduledStart: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    status: AssessmentStatusSchema.optional(),
  })
  .refine(
    (d) => {
      if (d.codeWeight !== undefined && d.aiuWeight !== undefined) {
        return d.codeWeight + d.aiuWeight === 100
      }
      return true
    },
    {
      message: 'codeWeight and aiuWeight must sum to 100',
      path: ['codeWeight'],
    },
  )
  .refine(
    (d) => {
      if (d.aiuMetricWeights !== undefined) {
        const sum = Object.values(d.aiuMetricWeights).reduce((a, b) => a + b, 0)
        return sum === 100
      }
      return true
    },
    {
      message: 'AIU metric weights must sum to 100',
      path: ['aiuMetricWeights'],
    },
  )
  .refine(
    (d) => {
      if (d.projectScoringCriteria !== undefined) {
        return d.projectScoringCriteria.reduce((sum, c) => sum + c.weight, 0) === 100
      }
      return true
    },
    {
      message: 'Project scoring criteria weights must sum to 100',
      path: ['projectScoringCriteria'],
    },
  )

export const CreateTestCaseRequestSchema = z.object({
  input: z.string(),
  expected: z.string(),
  isHidden: z.boolean().default(false),
  category: z.enum(['BASIC', 'STANDARD', 'EDGE', 'ROBUSTNESS', 'PERFORMANCE']).default('STANDARD'),
  weight: z.number().finite().positive().default(1),
  isCritical: z.boolean().default(false),
})

// ─── Problems ─────────────────────────────────────────────────────────────────

export const CreateProblemRequestSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().min(1), // Markdown
    difficulty: DifficultySchema,
    allowCopyPaste: z.boolean().default(false),
    // Must supply at least 1 visible AND 1 hidden test case on creation (FR-02)
    testCases: z.array(CreateTestCaseRequestSchema).min(2),
  })
  .refine((d) => d.testCases.some((tc) => !tc.isHidden), {
    message: 'At least one visible test case is required',
    path: ['testCases'],
  })
  .refine((d) => d.testCases.some((tc) => tc.isHidden), {
    message: 'At least one hidden test case is required',
    path: ['testCases'],
  })

export const UpdateProblemRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  difficulty: DifficultySchema.optional(),
  allowCopyPaste: z.boolean().optional(),
})

// ─── Library (admin-authored, reusable problems/tasks) ───────────────────────

export const CreateLibraryProblemRequestSchema = z
  .object({
    title: z.string().min(1).max(255),
    topic: z.string().max(50).optional(),
    description: z.string().min(1), // Markdown
    difficulty: DifficultySchema,
    allowCopyPaste: z.boolean().default(false),
    testCases: z.array(CreateTestCaseRequestSchema).min(2),
  })
  .refine((d) => d.testCases.some((tc) => !tc.isHidden), {
    message: 'At least one visible test case is required',
    path: ['testCases'],
  })
  .refine((d) => d.testCases.some((tc) => tc.isHidden), {
    message: 'At least one hidden test case is required',
    path: ['testCases'],
  })

export const UpdateLibraryProblemRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  topic: z.string().max(50).optional(),
  description: z.string().min(1).optional(),
  difficulty: DifficultySchema.optional(),
  allowCopyPaste: z.boolean().optional(),
  testCases: z.array(CreateTestCaseRequestSchema).min(2).optional(),
})

export const CreateLibraryTaskRequestSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1), // Markdown
  difficulty: DifficultySchema, // used as the SQS iteration baseline, like bug-bank entries
  language: LanguageSchema,
  doneWhen: z.array(z.string().min(1)).min(1),
  referenceFiles: z.array(ReferenceFileSchema).max(200).default([]),
  solutionFiles: z.array(ReferenceFileSchema).max(200).default([]),
})

export const UpdateLibraryTaskRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  difficulty: DifficultySchema.optional(),
  language: LanguageSchema.optional(),
  doneWhen: z.array(z.string().min(1)).min(1).optional(),
  referenceFiles: z.array(ReferenceFileSchema).max(200).optional(),
  solutionFiles: z.array(ReferenceFileSchema).max(200).optional(),
})

// Adds a Task to an already-created PROJECT assessment (mirrors
// CreateTaskRequestSchema, used inline at assessment-creation time) plus
// optional files to merge into the assessment's referenceFiles/solutionFiles,
// and libraryProblemId to record the source when added from the library.
export const AddTaskRequestSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  doneWhen: z.array(z.string().min(1)).min(1),
  difficulty: DifficultySchema.optional(),
  bugBankId: z.string().min(1).max(100).optional(),
  referenceFiles: z.array(ReferenceFileSchema).max(200).default([]),
  solutionFiles: z.array(ReferenceFileSchema).max(200).default([]),
})

// ─── Test Cases ───────────────────────────────────────────────────────────────

export const UpdateTestCaseRequestSchema = CreateTestCaseRequestSchema.partial()

// ─── Invite Tokens ────────────────────────────────────────────────────────────

export const GenerateInviteTokenRequestSchema = z.object({
  assessment_id: z.string().uuid(),
  candidate_name: z.string().min(1),
  candidate_email: z.string().email(),
})

// ─── Token verification (service-to-service) ─────────────────────────────────

export const VerifyTokenRequestSchema = z.object({
  token: z.string().min(1),
})

// ─── System Config ────────────────────────────────────────────────────────────

export const UpdateSystemConfigRequestSchema = z.object({
  openrouterKey: z.string().min(1),
})

// ─── Inferred types ───────────────────────────────────────────────────────────

export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type CreateAdminAccountRequest = z.infer<typeof CreateAdminAccountRequestSchema>
export type CreateAdminSignupRequest = z.infer<typeof CreateAdminSignupRequestSchema>
export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>
export type SaveCodeRequest = z.infer<typeof SaveCodeRequestSchema>
export type LlmChatRequest = z.infer<typeof LlmChatRequestSchema>
export type CreateAssessmentRequest = z.infer<typeof CreateAssessmentRequestSchema>
export type ConnectionDetail = z.infer<typeof ConnectionDetailSchema>
export type SubmissionFile = z.infer<typeof SubmissionFileSchema>
export type ReferenceFile = z.infer<typeof ReferenceFileSchema>
export type ProjectScoringCriterion = z.infer<typeof ProjectScoringCriterionSchema>
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>
export type UpdateAssessmentRequest = z.infer<typeof UpdateAssessmentRequestSchema>
export type CreateProblemRequest = z.infer<typeof CreateProblemRequestSchema>
export type UpdateProblemRequest = z.infer<typeof UpdateProblemRequestSchema>
export type CreateLibraryProblemRequest = z.infer<typeof CreateLibraryProblemRequestSchema>
export type UpdateLibraryProblemRequest = z.infer<typeof UpdateLibraryProblemRequestSchema>
export type CreateLibraryTaskRequest = z.infer<typeof CreateLibraryTaskRequestSchema>
export type UpdateLibraryTaskRequest = z.infer<typeof UpdateLibraryTaskRequestSchema>
export type AddTaskRequest = z.infer<typeof AddTaskRequestSchema>
export type CreateTestCaseRequest = z.infer<typeof CreateTestCaseRequestSchema>
export type UpdateTestCaseRequest = z.infer<typeof UpdateTestCaseRequestSchema>
export type GenerateInviteTokenRequest = z.infer<typeof GenerateInviteTokenRequestSchema>
export type VerifyTokenRequest = z.infer<typeof VerifyTokenRequestSchema>
export type UpdateSystemConfigRequest = z.infer<typeof UpdateSystemConfigRequestSchema>
