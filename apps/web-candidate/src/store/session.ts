import { create } from 'zustand'
import { getFileExtension, type SandboxLanguage } from '@platform/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Language = SandboxLanguage

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  turnNumber?: number
}

export type VisibleTestCase = {
  id: string
  input: string
  expected: string
}

export type Problem = {
  id: string
  title: string
  description: string
  difficulty: string
  allow_copy_paste: boolean
  solution_file?: string
  visible_test_cases: VisibleTestCase[]
}

export type AssessmentMeta = {
  title: string
  time_limit_minutes: number
  language: string
  llm_model: string
  ai_assistant_mode?: 'AGENTIC' | 'NON_AGENTIC' | 'DISABLED'
  allowed_models?: string[]
  allow_copy_paste?: boolean
  proctoring: {
    screen_recording: 'OFF' | 'OPTIONAL' | 'REQUIRED'
    video_proctoring: 'OFF' | 'OPTIONAL' | 'REQUIRED'
    microphone_recording: 'OFF' | 'OPTIONAL' | 'REQUIRED'
    second_camera: 'OFF' | 'OPTIONAL' | 'REQUIRED'
  }
}

export type AssessmentKind = 'CODING' | 'PROJECT'

export type ProjectTask = {
  id: string
  order: number
  title: string
  description: string
  done_when: string[]
}

export type ProjectBrief = {
  template_info: string | null
  allowed_models: string[]
  connection_details: Array<{ label: string; value: string }>
  submission_files: Array<{ name: string; description: string }>
  tasks: ProjectTask[]
}

// ─── File utilities ───────────────────────────────────────────────────────────

export function getMainFilename(lang: Language): string {
  return `solution.${getFileExtension(lang)}`
}

// Returns the file extension (without dot) for a language.
export function getLangExtension(lang: Language): string {
  return getFileExtension(lang)
}

// Serializes all open files for the API save/run calls.
// Single-file sessions send the plain code string; multi-file sends JSON.
export function serializeAllFiles(files: Record<string, string>, mainFile: string): string {
  const keys = Object.keys(files)
  if (keys.length <= 1) return files[mainFile] ?? ''
  return JSON.stringify({ __multifile__: true, main: mainFile, files })
}

// Parses a raw code string from the server into a files map.
function parseServerCode(
  raw: string,
  lang: Language,
): { files: Record<string, string>; activeFile: string } {
  const mainFile = getMainFilename(lang)
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      parsed.__multifile__ === true &&
      typeof parsed.files === 'object' &&
      parsed.files !== null
    ) {
      const files = parsed.files as Record<string, string>
      const active = typeof parsed.main === 'string' ? parsed.main : mainFile
      return { files, activeFile: active }
    }
  } catch {
    // plain string
  }
  return { files: { [mainFile]: raw }, activeFile: mainFile }
}

// ─── Store shape ──────────────────────────────────────────────────────────────

type SessionState = {
  session_id: string | null
  token: string | null
  status: 'idle' | 'active' | 'submitted' | 'expired'
  timeRemaining: number | null
  language: Language | null
  // Active file content - kept in sync with files[activeFile].
  // Components that only need to read/write the current editor content use this.
  code: string
  // All open files: filename → content
  files: Record<string, string>
  activeFile: string
  chatHistory: ChatMessage[]
  kind: AssessmentKind
  problems: Problem[]
  activeProblemIndex: number
  problem: Problem | null
  project: ProjectBrief | null
  assessment: AssessmentMeta | null
}

type SessionActions = {
  setSession: (payload: {
    session_id: string
    token: string
    kind?: AssessmentKind
    problems?: Problem[]
    problem: Problem | null
    project?: ProjectBrief | null
    assessment: AssessmentMeta
    current_code?: string
    time_remaining?: number | null
  }) => void
  setLanguage: (lang: Language) => void
  setActiveProblem: (index: number) => void
  setToken: (token: string) => void
  // Updates content of the currently active file
  setCode: (code: string) => void
  setActiveFile: (name: string) => void
  addFile: (name: string) => void
  removeFile: (name: string) => void
  // Applies a batch of AI-assistant file edits (path → full new content).
  applyEdits: (edits: Record<string, string>) => void
  // Restores all files from a serialized server response (reconnection flow)
  restoreFromServer: (raw: string) => void
  setTimeRemaining: (seconds: number) => void
  addChatMessage: (msg: ChatMessage) => void
  setStatus: (status: SessionState['status']) => void
  reset: () => void
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: SessionState = {
  session_id: null,
  token: null,
  status: 'idle',
  timeRemaining: null,
  language: null,
  code: '',
  files: {},
  activeFile: '',
  chatHistory: [],
  kind: 'CODING',
  problems: [],
  activeProblemIndex: 0,
  problem: null,
  project: null,
  assessment: null,
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSessionStore = create<SessionState & SessionActions>((set) => ({
  ...INITIAL_STATE,

  setSession: ({ session_id, token, kind, problems = [], problem, project, assessment, current_code, time_remaining }) =>
    set(() => {
      const language = assessment.language as Language
      const restored = current_code ? parseServerCode(current_code, language) : null
      if (restored && problems.length === 1) {
        const expected = problems[0]?.solution_file ?? getMainFilename(language)
        if (!(expected in restored.files) && Object.keys(restored.files).length === 1) {
          const previous = Object.keys(restored.files)[0]!
          restored.files = { [expected]: restored.files[previous] ?? '' }
          restored.activeFile = expected
        }
      }
      return {
      session_id,
      token,
      status: 'active',
      language,
      kind: kind ?? 'CODING',
      problems: problems.length > 0 ? problems : problem ? [problem] : [],
      activeProblemIndex: 0,
      problem: problems[0] ?? problem,
      project: project ?? null,
      assessment,
      ...(restored ? { files: restored.files, activeFile: restored.activeFile, code: restored.files[restored.activeFile] ?? '' } : {}),
      timeRemaining: typeof time_remaining === 'number' ? time_remaining : assessment.time_limit_minutes * 60,
      }
    }),

  setLanguage: (language) =>
    set((state) => {
      if (state.language === language && Object.keys(state.files).length > 0) {
        return { language }
      }
      const mainFile = getMainFilename(language)
      return { language, activeFile: mainFile, files: { [mainFile]: '' }, code: '' }
    }),

  setActiveProblem: (index) => set((state) => {
    const problem = state.problems[index] ?? state.problem
    const multiProblem = state.problems.length > 1
    const extension = getFileExtension(state.language ?? 'python')
    const activeFile = multiProblem
      ? `problem-${String(index + 1).padStart(2, '0')}.${extension}`
      : problem?.solution_file ?? state.activeFile
    const files = { ...state.files }
    if (multiProblem) {
      const firstFile = `problem-01.${extension}`
      const legacyFile = `solution.${extension}`
      if (!(firstFile in files) && legacyFile in files) files[firstFile] = files[legacyFile] ?? ''
      delete files[legacyFile]
    }
    if (activeFile && !(activeFile in files)) files[activeFile] = ''
    return {
      activeProblemIndex: index,
      problem,
      files,
      activeFile,
      code: files[activeFile] ?? '',
    }
  }),

  setToken: (token) => set({ token }),

  setCode: (content) =>
    set((state) => ({
      code: content,
      files: { ...state.files, [state.activeFile]: content },
    })),

  setActiveFile: (name) =>
    set((state) => ({
      activeFile: name,
      code: state.files[name] ?? '',
    })),

  addFile: (name) =>
    set((state) => ({
      files: { ...state.files, [name]: '' },
      activeFile: name,
      code: '',
    })),

  removeFile: (name) =>
    set((state) => {
      const newFiles = { ...state.files }
      delete newFiles[name]
      const mainFile = getMainFilename(state.language ?? 'javascript')
      return {
        files: newFiles,
        activeFile: mainFile,
        code: newFiles[mainFile] ?? '',
      }
    }),

  restoreFromServer: (raw) =>
    set((state) => {
      if (!state.language) return {}
      const { files, activeFile } = parseServerCode(raw, state.language)
      return { files, activeFile, code: files[activeFile] ?? '' }
    }),

  applyEdits: (edits) =>
    set((state) => {
      if (Object.keys(edits).length === 0) return {}
      const files = { ...state.files, ...edits }
      // Keep the visible editor content in sync if the active file was edited.
      const code = state.activeFile in edits ? edits[state.activeFile] : state.code
      return { files, code }
    }),

  setTimeRemaining: (seconds) => set({ timeRemaining: seconds }),

  addChatMessage: (msg) =>
    set((state) => ({ chatHistory: [...state.chatHistory, msg] })),

  setStatus: (status) => set({ status }),

  reset: () => set(INITIAL_STATE),
}))
