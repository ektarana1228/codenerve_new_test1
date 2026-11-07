import { z } from 'zod'

// ─── Sandbox execution contract ───────────────────────────────────────────────
// Matches the interfaces defined in CLAUDE.md § Code Sandbox - Docker Runner

export const SandboxLanguageSchema = z.enum(['python', 'javascript', 'typescript'])

// Single source of truth for language -> file extension / comment prefix.
// Was independently duplicated as inline ternaries in api-core, vscode-orchestrator,
// and web-candidate - adding a language only requires an entry here now.
const FILE_EXT: Record<z.infer<typeof SandboxLanguageSchema>, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
}

const COMMENT_PREFIX: Record<z.infer<typeof SandboxLanguageSchema>, string> = {
  python: '#',
  javascript: '//',
  typescript: '//',
}

export function getFileExtension(language: z.infer<typeof SandboxLanguageSchema>): string {
  return FILE_EXT[language]
}

export function getCommentPrefix(language: z.infer<typeof SandboxLanguageSchema>): string {
  return COMMENT_PREFIX[language]
}

export const ExecutionRequestSchema = z.object({
  language: SandboxLanguageSchema,
  code: z.string(),
  testCases: z.array(
    z.object({
      id: z.string().uuid(),
      input: z.string(),
      expected: z.string(),
      isHidden: z.boolean(),
    }),
  ),
  // Optional helper files written alongside the main solution file.
  // Enables multi-file execution (e.g. solution.py imports helpers.py).
  extraFiles: z.array(z.object({
    filename: z.string().min(1),
    content: z.string(),
  })).optional(),
})

export const TestCaseResultSchema = z.object({
  testCaseId: z.string().uuid(),
  status: z.enum(['pass', 'fail', 'error']),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().min(0).optional(),
  // isHidden is stripped before this result reaches the client
})

export const ExecutionResultSchema = z.object({
  status: z.enum(['completed', 'timeout', 'error']),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  results: z.array(TestCaseResultSchema),
})

export type SandboxLanguage = z.infer<typeof SandboxLanguageSchema>
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>
export type TestCaseResult = z.infer<typeof TestCaseResultSchema>
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>
