import type { AiAssistantMode, AssessmentKind } from './enums'

// ─── Capability model ─────────────────────────────────────────────────────────
//
// `AiAssistantMode` is the recruiter-facing contract: one value, persisted on the
// assessment and snapshotted onto every session.
//
// Enforcement code must NOT branch on the mode directly - it resolves the mode to
// a capability set and branches on that, so every service derives the same meaning
// from one place, and a future mode is an additive change here rather than a new
// conditional at every call site.

export interface AssistantCapabilities {
  /** Assistant is reachable at all. When false, every assistant route must 403. */
  enabled: boolean
  /** May receive the candidate workspace and traverse/read/write files in it. */
  workspaceAccess: boolean
  /** May be offered tool definitions (list_files / read_file / write_file). */
  tools: boolean
  /** May receive the current editor buffer as context (single file, truncated). */
  activeFileContext: boolean
  /** May return file edits for the client to apply to the editor. */
  applyEdits: boolean
}

const CAPABILITIES: Record<AiAssistantMode, AssistantCapabilities> = {
  AGENTIC: {
    enabled: true,
    workspaceAccess: true,
    tools: true,
    activeFileContext: true,
    applyEdits: true,
  },
  // Chat, explanations and snippets only. No repo read, no multi-file edit, no
  // auto-apply, and therefore no path to test files or hidden test cases.
  NON_AGENTIC: {
    enabled: true,
    workspaceAccess: false,
    tools: false,
    activeFileContext: true,
    applyEdits: false,
  },
  DISABLED: {
    enabled: false,
    workspaceAccess: false,
    tools: false,
    activeFileContext: false,
    applyEdits: false,
  },
}

/**
 * Resolve a persisted mode to its capability set. Unknown, null or missing values
 * fail closed to DISABLED - never open.
 */
export function resolveAssistantCapabilities(
  mode: AiAssistantMode | string | null | undefined,
): AssistantCapabilities {
  return CAPABILITIES[mode as AiAssistantMode] ?? CAPABILITIES.DISABLED
}

/**
 * The default assistant mode for a newly created assessment of a given kind.
 * A default, not a lock for PROJECT-kind assessments.
 *
 * CODING  -> DISABLED: AI assistance is disabled for DSA/code-correctness
 *            sessions to preserve the signal the assessment exists to measure.
 * PROJECT -> AGENTIC:     multi-file work mirrors real engineering, and how well
 *            the candidate directs the agent is itself part of the evaluation.
 */
export function defaultAiAssistantModeForKind(kind: AssessmentKind): AiAssistantMode {
  return kind === 'PROJECT' ? 'AGENTIC' : 'DISABLED'
}
