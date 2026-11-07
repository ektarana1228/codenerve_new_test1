import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  DockviewReact,
  themeLight,
  themeVisualStudio,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { useSessionStore, serializeAllFiles } from '../store/session'
import { submitSession, saveCode, getSession, logProctoringEvent, uploadProctoringRecording, uploadProctoringScreenshot, getMobilePairing, exitSession } from '../api/client'
import { ThemeToggle, Logo } from '@platform/web-shared'
import { MonacoEditor } from '../components/MonacoEditor'
import { Timer } from '../components/Timer'
import { ChatPanel } from '../components/ChatPanel'
import { RunPanel } from '../components/RunPanel'
import { ProjectBriefPanel } from '../components/ProjectBriefPanel'
import { captureJpeg, getProctoringMedia, startProctoringRecordings, stopProctoringMedia, stopProctoringRecordings } from '../proctoring/media'

// Serialize the store's open files into the durable code payload (multi-file →
// JSON envelope, single-file → raw string). Used by the CODING autosave/submit.
function serializeStoreCode(): string {
  const { files, activeFile } = useSessionStore.getState()
  return serializeAllFiles(files, activeFile)
}

// Push the candidate's latest work into the durable Session.currentCode before
// scoring reads it. PROJECT lives in the VS Code container (flush); CODING lives
// in the browser store (saveCode). Best-effort - never throws.
async function persistWorkspace(sessionId: string): Promise<void> {
  await saveCode(sessionId, serializeStoreCode()).catch(() => {})
}

function formatLanguage(language: string | null) {
  if (!language) return 'Code'
  return language.charAt(0).toUpperCase() + language.slice(1).toLowerCase()
}

function formatDifficulty(difficulty?: string) {
  if (!difficulty) return 'Problem'
  return difficulty.charAt(0) + difficulty.slice(1).toLowerCase()
}

const iconBtn =
  'flex h-8 w-8 items-center justify-center rounded-[8px] text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--bg-overlay)] hover:text-[color:var(--text-primary)]'
const INTERNAL_FULLSCREEN_CHANGE_EVENT = 'apexcoder-internal-fullscreen-change'
const BEFORE_EXIT_SAVE_EVENT = 'apexcoder-before-exit-save'

// Behavioral-integrity strikes (tab-hide / fullscreen-exit / second-camera drop) before auto-submit.
const MAX_VIOLATIONS = 3

// One retry, then a logged event on final failure, so a real evidence gap is
// visible on the admin timeline instead of silently vanishing.
async function uploadEvidence(sessionId: string, kind: string, action: () => Promise<unknown>) {
  let delay = 1_000
  for (;;) {
    try {
      await action()
      return
    } catch (error) {
      console.error('Evidence upload attempt failed; retrying', error)
      if (!navigator.onLine) {
        await new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }))
      } else {
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.min(delay * 2, 30_000)
      }
      await logProctoringEvent(sessionId, 'DESKTOP', 'EVIDENCE_UPLOAD_FAILED', { kind }).catch(() => {})
    }
  }
}

// Page-level actions the docked editor panel needs (submit lives on the page for the modal).
type Actions = { requestSubmit: () => void; submitting: boolean }
const ActionsCtx = createContext<Actions>({ requestSubmit: () => {}, submitting: false })

// ─── Problem panel ────────────────────────────────────────────────────────────
function ProblemPanel() {
  const problem = useSessionStore((s) => s.problem)
  const problems = useSessionStore((s) => s.problems)
  const activeProblemIndex = useSessionStore((s) => s.activeProblemIndex)
  const setActiveProblem = useSessionStore((s) => s.setActiveProblem)
  const switchProblem = (index: number) => {
    if (index === activeProblemIndex) return
    const { session_id, status, files, activeFile } = useSessionStore.getState()
    if (session_id && status === 'active') {
      void saveCode(session_id, serializeAllFiles(files, activeFile)).catch(() => {})
    }
    setActiveProblem(index)
  }
  const visibleExamples = problem?.visible_test_cases ?? []
  const difficultyDot =
    problem?.difficulty === 'EASY'
      ? 'var(--signal-green)'
      : problem?.difficulty === 'HARD'
        ? 'var(--status-fail)'
        : 'var(--status-warn)'
  const displayedSolutionFile = problems.length > 1
    ? `problem-${String(activeProblemIndex + 1).padStart(2, '0')}.${problem?.solution_file?.split('.').pop() ?? 'py'}`
    : problem?.solution_file

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--bg-raised)]">
      {problems.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[color:var(--border-subtle)] px-3 py-2" role="tablist" aria-label="Assessment problems">
          {problems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === activeProblemIndex}
              title={item.title}
              onClick={() => switchProblem(index)}
              className={`shrink-0 rounded-[6px] px-3 py-1.5 text-xs font-medium ${index === activeProblemIndex ? 'bg-[color:var(--text-primary)] text-[color:var(--bg-canvas)]' : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-overlay)] hover:text-[color:var(--text-primary)]'}`}
            >
              Problem {index + 1}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-[1.6rem] font-semibold leading-none text-[color:var(--text-primary)]">{problem?.title}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--bg-overlay)] px-3 py-1 text-xs font-semibold text-[color:var(--text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: difficultyDot }} />
            {formatDifficulty(problem?.difficulty)}
          </span>
        </div>

        {displayedSolutionFile && <p className="mb-5 text-xs text-[color:var(--text-muted)]">Write this solution in <code className="font-mono text-[color:var(--text-secondary)]">{displayedSolutionFile}</code>.</p>}

        <div className="mb-5 max-w-none text-[15px] leading-8 text-[color:var(--text-secondary)] [&_code]:rounded-md [&_code]:bg-[color:var(--bg-inset)] [&_code]:px-1.5 [&_code]:py-0.5 [&_li]:my-1 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-[color:var(--bg-inset)] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-[color:var(--text-primary)] [&_ul]:pl-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{problem?.description ?? ''}</ReactMarkdown>
        </div>

        {visibleExamples.length > 0 && (
          <div className="space-y-4">
            {visibleExamples.map((testCase, index) => (
              <div key={testCase.id} className="rounded-[10px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Example {index + 1}</p>
                <div className="space-y-3 text-sm text-[color:var(--text-secondary)]">
                  <div>
                    <p className="mb-1 text-[color:var(--text-muted)]">Input</p>
                    <pre className="whitespace-pre-wrap break-words rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-inset)] px-3 py-3 font-mono text-[color:var(--text-primary)]">
                      {testCase.input || '(empty)'}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[color:var(--text-muted)]">Expected</p>
                    <pre className="whitespace-pre-wrap break-words rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-inset)] px-3 py-3 font-mono text-[color:var(--text-primary)]">
                      {testCase.expected}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Editor panel ─────────────────────────────────────────────────────────────
// Full VS Code (openvscode-server) embedded in a same-origin iframe. VS Code owns
// the workspace filesystem - its own explorer/tabs manage files, so the old
// app-managed tab bar is gone. Autosave is durable server-side (orchestrator sync
// loop); this panel also flushes on an interval for immediate "Saved" feedback.
// Shared editor chrome: language + lock badge, a "Saved" flash, and a fullscreen
// toggle. Wraps both the CODING and PROJECT editors so they share one header theme.
function EditorShell({ savedVisible, children }: { savedVisible: boolean; children: React.ReactNode }) {
  const language = useSessionStore((s) => s.language)
  const [isFull, setIsFull] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onFs = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = () => {
    window.dispatchEvent(new Event(INTERNAL_FULLSCREEN_CHANGE_EVENT))
    if (document.fullscreenElement === sectionRef.current) void document.exitFullscreen()
    else void sectionRef.current?.requestFullscreen?.()
  }

  return (
    <div ref={sectionRef} className="flex h-full min-h-0 flex-col bg-[color:var(--bg-raised)]">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[color:var(--border-subtle)] px-5 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--text-secondary)]">
          <svg className="h-4 w-4 text-[color:var(--text-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          {formatLanguage(language)}
          <span className="text-xs text-[color:var(--text-muted)]">· locked</span>
        </div>

        <div className="flex items-center gap-1">
          <span className={`mr-1 text-xs text-[color:var(--text-muted)] transition-opacity ${savedVisible ? 'opacity-100' : 'opacity-0'}`}>Saved</span>
          <button type="button" onClick={toggleFullscreen} className={iconBtn} aria-label={isFull ? 'Exit full screen' : 'Full screen'}>
            {isFull ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" /></svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15M3.75 20.25h4.5m-4.5 0v-4.5m0 4.5L9 15" /></svg>
            )}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function EditorPanel() {
  const session_id = useSessionStore((s) => s.session_id)
  const status = useSessionStore((s) => s.status)
  const isSubmitted = status === 'submitted' || status === 'expired'

  const [savedVisible, setSavedVisible] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashSaved = () => {
    setSavedVisible(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSavedVisible(false), 1200)
  }
  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current) }, [])

  return (
    <EditorShell savedVisible={savedVisible}>
      {session_id && <CodingEditor readOnly={isSubmitted} onSaved={flashSaved} />}
    </EditorShell>
  )
}

// CODING (DSA) editor: in-browser Monaco backed by the Zustand store. Owns its
// own autosave (2s debounced + 10s interval PATCH /sessions/:id/code) and
// restores from the server on reconnection - no VS Code container involved.
function CodingEditor({ readOnly, onSaved }: { readOnly: boolean; onSaved: () => void }) {
  const session_id = useSessionStore((s) => s.session_id)
  const language = useSessionStore((s) => s.language)
  const status = useSessionStore((s) => s.status)
  const code = useSessionStore((s) => s.code)
  const activeFile = useSessionStore((s) => s.activeFile)
  const setCode = useSessionStore((s) => s.setCode)
  const restoreFromServer = useSessionStore((s) => s.restoreFromServer)
  const allowCopyPaste = useSessionStore((s) => s.assessment?.allow_copy_paste ?? false)

  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashNotice = (msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 2000)
  }

  const save = () => {
    if (!session_id || status !== 'active') return
    saveCode(session_id, serializeStoreCode()).then(onSaved).catch(() => {})
  }

  // Debounced save 2s after the last keystroke.
  const handleChange = (value: string) => {
    setCode(value)
    if (status !== 'active') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(save, 2000)
  }

  // Interval save every 10s (durability even if the candidate stops typing).
  useEffect(() => {
    if (!session_id || status !== 'active') return
    const id = setInterval(save, 10_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session_id, status])

  // Restore code from the server on reconnection - the server is the source of truth.
  useEffect(() => {
    const onRestored = () => {
      if (!session_id) return
      getSession(session_id).then((res) => restoreFromServer(res.data.current_code)).catch(() => {})
    }
    window.addEventListener('connection-restored', onRestored)
    return () => window.removeEventListener('connection-restored', onRestored)
  }, [session_id, restoreFromServer])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [])

  useEffect(() => {
    const onBeforeExitSave = (event: Event) => {
      if (!session_id || status !== 'active') return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const pending = saveCode(session_id, serializeStoreCode()).then(onSaved).catch(() => {})
      ;(event as CustomEvent<{ add?: (promise: Promise<unknown>) => void }>).detail?.add?.(pending)
    }
    window.addEventListener(BEFORE_EXIT_SAVE_EVENT, onBeforeExitSave)
    return () => window.removeEventListener(BEFORE_EXIT_SAVE_EVENT, onBeforeExitSave)
  }, [session_id, status, onSaved])

  return (
    <div className="relative h-full w-full">
      {notice && (
        <div className="absolute right-3 top-3 z-10 rounded-[8px] border border-[color:var(--status-warn)] bg-[color:var(--bg-overlay)] px-3 py-1.5 text-xs text-[color:var(--status-warn)] shadow">
          {notice}
        </div>
      )}
      <MonacoEditor
        language={language ?? 'python'}
        value={code}
        readOnly={readOnly}
        onChange={handleChange}
        allowCopyPaste={allowCopyPaste}
        onClipboardBlocked={(action) => flashNotice(`${action[0].toUpperCase()}${action.slice(1)} is disabled for this problem.`)}
        onLargePaste={() => flashNotice('Large paste blocked (over 500 characters).')}
      />
    </div>
  )
}

// Description panel branches by assessment kind: CODING → problem + examples,
// PROJECT → task brief with "Done when" criteria, provided models, etc.
function ProjectEditorPanel() {
  const session_id = useSessionStore((s) => s.session_id)
  const language = useSessionStore((s) => s.language)
  const status = useSessionStore((s) => s.status)
  const code = useSessionStore((s) => s.code)
  const setCode = useSessionStore((s) => s.setCode)
  const files = useSessionStore((s) => s.files)
  const activeFile = useSessionStore((s) => s.activeFile)
  const setActiveFile = useSessionStore((s) => s.setActiveFile)
  const addFile = useSessionStore((s) => s.addFile)
  const removeFile = useSessionStore((s) => s.removeFile)
  const restoreFromServer = useSessionStore((s) => s.restoreFromServer)
  const allowCopyPaste = useSessionStore((s) => s.assessment?.allow_copy_paste ?? false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [savedVisible, setSavedVisible] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const isSubmitted = status === 'submitted' || status === 'expired'
  const names = Object.keys(files).sort((a, b) => a.localeCompare(b))

  const flashSaved = () => {
    setSavedVisible(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSavedVisible(false), 1200)
  }

  const save = () => {
    if (!session_id || status !== 'active') return
    saveCode(session_id, serializeStoreCode()).then(flashSaved).catch(() => {})
  }

  const createFile = () => {
    const name = window.prompt('File path')
    if (!name?.trim()) return
    addFile(name.trim().replace(/\\/g, '/'))
  }

  useEffect(() => {
    if (!session_id || status !== 'active') return
    const id = setInterval(save, 10_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session_id, status])

  useEffect(() => {
    const onRestored = () => {
      if (!session_id) return
      getSession(session_id).then((res) => restoreFromServer(res.data.current_code)).catch(() => {})
    }
    window.addEventListener('connection-restored', onRestored)
    return () => window.removeEventListener('connection-restored', onRestored)
  }, [session_id, restoreFromServer])

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  useEffect(() => {
    const onBeforeExitSave = (event: Event) => {
      if (!session_id || status !== 'active') return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const pending = saveCode(session_id, serializeStoreCode()).then(flashSaved).catch(() => {})
      ;(event as CustomEvent<{ add?: (promise: Promise<unknown>) => void }>).detail?.add?.(pending)
    }
    window.addEventListener(BEFORE_EXIT_SAVE_EVENT, onBeforeExitSave)
    return () => window.removeEventListener(BEFORE_EXIT_SAVE_EVENT, onBeforeExitSave)
  }, [session_id, status])

  const handleChange = (value: string) => {
    setCode(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(save, 1200)
  }

  return (
    <EditorShell savedVisible={savedVisible}>
      <div className="flex h-full min-h-0 min-w-0 overflow-hidden bg-[color:var(--bg-raised)]">
      <aside className={`flex shrink-0 flex-col overflow-hidden border-r border-[color:var(--border-subtle)] bg-[color:var(--bg-inset)] transition-[width] duration-150 ${filesCollapsed ? 'w-10' : 'w-48'}`}>
        <div className={`flex h-10 shrink-0 items-center border-b border-[color:var(--border-subtle)] ${filesCollapsed ? 'justify-center px-1' : 'justify-between px-3'}`}>
          {!filesCollapsed && <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Files</span>}
          <div className="flex items-center">
            {!filesCollapsed && <button type="button" onClick={createFile} className={iconBtn} aria-label="New file">+</button>}
            <button type="button" onClick={() => setFilesCollapsed((value) => !value)} className={iconBtn} aria-label={filesCollapsed ? 'Expand files' : 'Collapse files'} title={filesCollapsed ? 'Expand files' : 'Collapse files'}>
              {filesCollapsed ? '›' : '‹'}
            </button>
          </div>
        </div>
        {!filesCollapsed && <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {names.map((name) => (
            <div key={name} className="group flex items-center gap-1 px-2">
              <button
                type="button"
                onClick={() => setActiveFile(name)}
                title={name}
                className={`min-w-0 flex-1 truncate rounded-[6px] px-2 py-1.5 text-left text-xs ${name === activeFile ? 'bg-[color:var(--bg-overlay)] text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-overlay)]'}`}
              >
                {name}
              </button>
              {names.length > 1 && (
                <button type="button" onClick={() => removeFile(name)} className="h-7 w-7 rounded-[6px] text-[color:var(--text-muted)] opacity-0 hover:bg-[color:var(--bg-overlay)] hover:text-[color:var(--status-fail)] group-hover:opacity-100" aria-label={`Remove ${name}`}>
                  x
                </button>
              )}
            </div>
          ))}
        </div>}
      </aside>
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <MonacoEditor
          language={language ?? 'typescript'}
          value={code}
          readOnly={isSubmitted}
          onChange={handleChange}
          allowCopyPaste={allowCopyPaste}
          wordWrap="off"
        />
      </div>
      </div>
    </EditorShell>
  )
}

function DescriptionPanel() {
  const kind = useSessionStore((s) => s.kind)
  return kind === 'PROJECT' ? <ProjectBriefPanel /> : <ProblemPanel />
}

// ─── Console panel (Testcase / Result) - its own dockable, resizable panel ──────
function ConsolePanel(props: IDockviewPanelProps) {
  const status = useSessionStore((s) => s.status)
  const kind = useSessionStore((s) => s.kind)
  const isSubmitted = status === 'submitted' || status === 'expired'
  const { requestSubmit, submitting } = useContext(ActionsCtx)
  // PROJECT assessments are deliverable-based - no test cases to run.
  return (
    <RunPanel
      disabled={isSubmitted}
      submitting={submitting}
      onSubmit={requestSubmit}
      onCollapsedChange={(collapsed) => props.api.setSize({ height: collapsed ? 48 : 240 })}
      projectMode={kind === 'PROJECT'}
    />
  )
}

// Stable component map + default docked layout (drag/dock/split are user-driven from here).
const DOCK_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  problem: DescriptionPanel,
  editor: EditorPanel,
  projectEditor: ProjectEditorPanel,
  console: ConsolePanel,
  chat: () => <ChatPanel />,
}

function readDockTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? themeLight : themeVisualStudio
}

function onDockReady(event: DockviewReadyEvent) {
  const isProject = useSessionStore.getState().kind === 'PROJECT'
  const aiAssistantMode = useSessionStore.getState().assessment?.ai_assistant_mode
  const showAiAssistant = aiAssistantMode !== 'DISABLED'
  event.api.addPanel({ id: 'problem', component: 'problem', title: 'Description' })
  event.api.addPanel({ id: 'editor', component: isProject ? 'projectEditor' : 'editor', title: 'Solution', position: { referencePanel: 'problem', direction: 'right' } })
  // Disabled assistant mode should not reserve a dead panel; give that space to the editor/console.
  if (showAiAssistant) {
    event.api.addPanel({ id: 'chat', component: 'chat', title: 'AI Assistant', position: { referencePanel: 'editor', direction: 'right' } })
  }
  // CODING runs test cases, so it gets a console; PROJECT is deliverable-based.
  if (!isProject) {
    const consolePanel = event.api.addPanel({ id: 'console', component: 'console', title: 'Console', position: { referencePanel: 'editor', direction: 'below' } })
    consolePanel.api.setSize({ height: 240 })
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────
export function AssessPage() {
  const session_id = useSessionStore((s) => s.session_id)
  const language = useSessionStore((s) => s.language)
  const status = useSessionStore((s) => s.status)
  const timeRemaining = useSessionStore((s) => s.timeRemaining)
  const assessment = useSessionStore((s) => s.assessment)
  const kind = useSessionStore((s) => s.kind)

  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [violationWarning, setViolationWarning] = useState<string | null>(null)
  const [clipboardWarning, setClipboardWarning] = useState<string | null>(null)
  const [dockTheme, setDockTheme] = useState(readDockTheme)
  const [isFull, setIsFull] = useState(() => Boolean(document.fullscreenElement))
  const [exitRemaining, setExitRemaining] = useState<number | null>(null)
  const navigate = useNavigate()
  const expireCalledRef = useRef(false)
  const violationCountRef = useRef(0)
  const violationReasonsRef = useRef<string[]>([])
  const mobileConnectedRef = useRef(true)
  const suppressFullscreenViolationRef = useRef(false)

  const isSubmitted = status === 'submitted' || status === 'expired'
  const isLowTime = timeRemaining !== null && timeRemaining < 300 && timeRemaining > 0

  useEffect(() => {
    const obs = new MutationObserver(() => setDockTheme(readDockTheme()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const handleViolation = useCallback(async () => {
    if (expireCalledRef.current) return
    expireCalledRef.current = true
    try {
      await persistWorkspace(session_id!)
      await stopProctoringRecordings()
      await submitSession(session_id!)
    } catch {
      // Best effort.
    }
    stopProctoringMedia()
    navigate('/complete?status=violation', { replace: true })
  }, [session_id, navigate])

  const recordViolation = useCallback((type: string, label: string) => {
    if (session_id) void logProctoringEvent(session_id, 'DESKTOP', type).catch(() => {})
    violationCountRef.current += 1
    violationReasonsRef.current.push(label)
    const remaining = MAX_VIOLATIONS - violationCountRef.current
    if (remaining > 0) {
      setViolationWarning(`Warning ${violationCountRef.current}/${MAX_VIOLATIONS}. Reason: ${label}. ${remaining} warning${remaining === 1 ? '' : 's'} remaining before your assessment is automatically submitted.`)
    } else {
      const reasons = violationReasonsRef.current.map((reason, index) => `${index + 1}. ${reason}`).join(' ')
      setViolationWarning(`Warning ${MAX_VIOLATIONS}/${MAX_VIOLATIONS}. Reason: ${label}. Policy violations exceeded. Recorded reasons: ${reasons}. Submitting your assessment automatically.`)
      void handleViolation()
    }
  }, [session_id, handleViolation])

  useEffect(() => {
    if (!session_id) return
    const media = getProctoringMedia()

    const record = (type: string) => logProctoringEvent(session_id, 'DESKTOP', type).catch(() => {})
    const onVisibility = () => (document.hidden ? recordViolation('TAB_HIDDEN', 'Tab switch detected') : record('TAB_VISIBLE'))
    const onInternalFullscreenChange = () => {
      suppressFullscreenViolationRef.current = true
      window.setTimeout(() => {
        suppressFullscreenViolationRef.current = false
      }, 750)
    }
    const onFullscreenChange = () => {
      if (suppressFullscreenViolationRef.current) return
      if (!document.fullscreenElement) recordViolation('FULLSCREEN_EXITED', 'Fullscreen exited')
    }
    const onOffline = () => record('NETWORK_LOST')
    const onOnline = () => record('NETWORK_RESTORED')
    const ended = (type: string) => () => record(type)
    const screenEnded = () => recordViolation('SCREEN_STOPPED', 'Screen sharing stopped')
    const cameraEnded = ended('CAMERA_STOPPED')
    const microphoneEnded = ended('MICROPHONE_STOPPED')

    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener(INTERNAL_FULLSCREEN_CHANGE_EVENT, onInternalFullscreenChange)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    media.screen?.getVideoTracks().forEach((track) => track.addEventListener('ended', screenEnded))
    media.device?.getVideoTracks().forEach((track) => track.addEventListener('ended', cameraEnded))
    media.device?.getAudioTracks().forEach((track) => track.addEventListener('ended', microphoneEnded))
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener(INTERNAL_FULLSCREEN_CHANGE_EVENT, onInternalFullscreenChange)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      media.screen?.getVideoTracks().forEach((track) => track.removeEventListener('ended', screenEnded))
      media.device?.getVideoTracks().forEach((track) => track.removeEventListener('ended', cameraEnded))
      media.device?.getAudioTracks().forEach((track) => track.removeEventListener('ended', microphoneEnded))
    }
  }, [session_id, recordViolation])

  useEffect(() => {
    if (!session_id || !assessment) return
    const media = getProctoringMedia()
    const capture = async () => {
      if (assessment.proctoring.screen_recording !== 'OFF' && media.screen) {
        const image = await captureJpeg(media.screen, 1280)
        await uploadEvidence(session_id, 'SCREEN', () => uploadProctoringScreenshot(session_id, 'SCREEN', image))
      }
      if (assessment.proctoring.video_proctoring !== 'OFF' && media.device) {
        const image = await captureJpeg(media.device, 640)
        await uploadEvidence(session_id, 'WEBCAM', () => uploadProctoringScreenshot(session_id, 'WEBCAM', image))
      }
    }
    const first = setTimeout(() => void capture().catch(() => {}), 5000)
    const interval = setInterval(() => void capture().catch(() => {}), 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(interval)
    }
  }, [session_id, assessment])

  useEffect(() => {
    if (!session_id || !assessment) return
    const policy = assessment.proctoring
    startProctoringRecordings(
      {
        screen: policy.screen_recording !== 'OFF',
        webcam: policy.video_proctoring !== 'OFF',
        microphone: policy.microphone_recording !== 'OFF',
      },
      (kind, mimeType, data) => uploadEvidence(session_id, kind, () => uploadProctoringRecording(session_id, kind, mimeType, data)),
    )
    return () => { void stopProctoringRecordings() }
  }, [session_id, assessment])

  useEffect(() => {
    if (!session_id) return
    const flushBeforeBrowserExit = (event: BeforeUnloadEvent) => {
      // Start finalising the active clips while the browser's native leave
      // confirmation keeps this page alive. Controlled exits await this fully.
      void stopProctoringRecordings()
      event.preventDefault()
      event.returnValue = ''
    }
    const flushOnPageHide = () => { void stopProctoringRecordings() }
    window.addEventListener('beforeunload', flushBeforeBrowserExit)
    window.addEventListener('pagehide', flushOnPageHide)
    return () => {
      window.removeEventListener('beforeunload', flushBeforeBrowserExit)
      window.removeEventListener('pagehide', flushOnPageHide)
    }
  }, [session_id])

  // Nothing else polls mobile-pairing status once the exam starts (SystemCheckPage
  // only polls pre-exam), so a second-camera drop mid-exam would otherwise go unnoticed.
  useEffect(() => {
    if (!session_id || assessment?.proctoring.second_camera !== 'REQUIRED') return
    const poll = setInterval(() => {
      void getMobilePairing(session_id).then((response) => {
        if (response.data.connected) {
          mobileConnectedRef.current = true
        } else if (mobileConnectedRef.current) {
          mobileConnectedRef.current = false
          recordViolation('MOBILE_DISCONNECTED', 'Second camera disconnected')
        }
      }).catch(() => {})
    }, 15_000)
    return () => clearInterval(poll)
  }, [session_id, assessment, recordViolation])

  // Track document-level fullscreen so we can offer a re-enter affordance if the
  // candidate leaves fullscreen (e.g. by pressing Esc).
  useEffect(() => {
    const onFs = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Candidate assessment integrity: while an assessment session is active, block
  // copy/cut/paste everywhere inside this page (brief, editor, AI chat, console).
  // This is intentionally scoped to AssessPage only; login/admin/other pages are
  // not affected.
  useEffect(() => {
    if (!session_id || isSubmitted) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const notify = (action: string) => {
      setClipboardWarning(`${action} is disabled during the assessment.`)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setClipboardWarning(null), 2200)
    }
    const block = (event: Event, action: string) => {
      event.preventDefault()
      event.stopPropagation()
      notify(action)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'c') block(event, 'Copy')
      if (key === 'x') block(event, 'Cut')
      if (key === 'v') block(event, 'Paste')
    }
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') block(event, 'Paste')
    }
    const onCopy = (event: ClipboardEvent) => block(event, 'Copy')
    const onCut = (event: ClipboardEvent) => block(event, 'Cut')
    const onPaste = (event: ClipboardEvent) => block(event, 'Paste')
    const onDrop = (event: DragEvent) => block(event, 'Drop')
    const onContextMenu = (event: MouseEvent) => block(event, 'Right click')

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('beforeinput', onBeforeInput, true)
    document.addEventListener('copy', onCopy, true)
    document.addEventListener('cut', onCut, true)
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('beforeinput', onBeforeInput, true)
      document.removeEventListener('copy', onCopy, true)
      document.removeEventListener('cut', onCut, true)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [session_id, isSubmitted])

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const openExitConfirm = () => {
    setExitRemaining(useSessionStore.getState().timeRemaining)
    setShowExitConfirm(true)
  }

  const cancelExitConfirm = () => {
    setShowExitConfirm(false)
    setExitRemaining(null)
  }

  const doSubmit = useCallback(async () => {
    if (!session_id) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Push the live workspace to the durable copy before scoring reads it.
      await persistWorkspace(session_id)
      await stopProctoringRecordings()
      await submitSession(session_id)
      stopProctoringMedia()
      // Session is reset on the completion page - resetting here would trip the
      // `!session_id` guard below and redirect to /start before /complete lands.
      navigate('/complete?status=submitted', { replace: true })
    } catch {
      setSubmitError('Submission failed. Please try again.')
      setSubmitting(false)
    }
  }, [session_id, navigate])

  const handleExit = async () => {
    const frozenRemaining = exitRemaining ?? useSessionStore.getState().timeRemaining
    setExitRemaining(frozenRemaining)
    setShowExitConfirm(false)
    setSubmitting(true)
    setSubmitError(null)
    try {
      const pendingSaves: Promise<unknown>[] = []
      window.dispatchEvent(new CustomEvent(BEFORE_EXIT_SAVE_EVENT, { detail: { add: (promise: Promise<unknown>) => pendingSaves.push(promise) } }))
      await Promise.allSettled(pendingSaves)
      const code = serializeStoreCode()
      await saveCode(session_id!, code).catch(() => {})
      await stopProctoringRecordings()
      await exitSession(session_id!, code, frozenRemaining)
      stopProctoringMedia()
      navigate('/complete?status=exited', { replace: true })
    } catch {
      setExitRemaining(null)
      setSubmitError('Exit failed. Your assessment is still active. Please try again.')
      setSubmitting(false)
    }
  }

  const handleExpire = useCallback(async () => {
    if (expireCalledRef.current) return
    expireCalledRef.current = true
    try {
      await persistWorkspace(session_id!)
      await stopProctoringRecordings()
      await submitSession(session_id!)
      stopProctoringMedia()
    } catch {
      // Best effort.
    }
    stopProctoringMedia()
    navigate('/complete?status=expired', { replace: true })
  }, [session_id, navigate])

  // Guard AFTER all hooks so hook order stays stable across renders.
  if (!session_id || !language) {
    return <Navigate to="/start" replace />
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[color:var(--bg-canvas)] font-sans text-[color:var(--text-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] px-4">
        <Logo size={30} />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-[8px] bg-[color:var(--bg-overlay)] px-3 py-1.5">
            <svg className="h-4 w-4 text-[color:var(--text-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <Timer onExpire={handleExpire} paused={exitRemaining !== null} displaySeconds={exitRemaining} />
          </div>
          {!isFull && (
            <button
              type="button"
              onClick={enterFullscreen}
              className="flex items-center gap-1.5 rounded-[8px] border border-[color:var(--border-strong)] px-3 py-1.5 text-sm font-medium text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-overlay)] hover:text-[color:var(--text-primary)]"
              title="Enter full screen"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15M3.75 20.25h4.5m-4.5 0v-4.5m0 4.5L9 15" />
              </svg>
              Full screen
            </button>
          )}
          <ThemeToggle />
          {kind === 'PROJECT' && !isSubmitted && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={submitting}
              data-cursor="green"
              className="rounded-[8px] bg-[color:var(--signal-green)] px-4 py-1.5 text-sm font-semibold text-[color:var(--bg-canvas)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
          <button
            type="button"
            onClick={openExitConfirm}
            className="rounded-[8px] border border-[color:var(--border-strong)] px-3 py-1.5 text-sm font-medium text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-overlay)] hover:text-[color:var(--text-primary)]"
          >
            Exit
          </button>
          <div className="h-8 w-8 rounded-full bg-[color:var(--bg-overlay)]" aria-hidden="true" />
        </div>
      </header>

      {(submitError || violationWarning || clipboardWarning || (isLowTime && !isSubmitted) || isSubmitted) && (
        <div className="space-y-2 px-2 pt-2">
          {violationWarning && !isSubmitted && (
            <div className="rounded-[10px] border border-[color:var(--status-warn)] bg-[color:var(--bg-raised)] px-4 py-3 text-sm text-[color:var(--status-warn)]">
              {violationWarning}
            </div>
          )}
          {clipboardWarning && !isSubmitted && (
            <div className="rounded-[10px] border border-[color:var(--status-warn)] bg-[color:var(--bg-raised)] px-4 py-3 text-sm text-[color:var(--status-warn)]">
              {clipboardWarning}
            </div>
          )}
          {isLowTime && !isSubmitted && (
            <div className="rounded-[10px] border border-[color:var(--status-warn)] bg-[color:var(--bg-raised)] px-4 py-3 text-sm text-[color:var(--status-warn)]">
              5 minutes remaining. Your work will be submitted automatically.
            </div>
          )}
          {isSubmitted && (
            <div className="rounded-[10px] border border-[color:var(--signal-green)] bg-[color:var(--bg-raised)] px-4 py-3 text-sm text-[color:var(--signal-green)]">
              {status === 'expired' ? "Time's up. Your work has been submitted automatically." : 'Assessment submitted. Results are being processed.'}
            </div>
          )}
          {submitError && (
            <div className="rounded-[10px] border border-[color:var(--status-fail)] bg-[color:var(--bg-raised)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
              {submitError}
            </div>
          )}
        </div>
      )}

      <main className="min-h-0 flex-1 p-1">
        <ActionsCtx.Provider value={{ requestSubmit: () => setShowConfirm(true), submitting }}>
          <DockviewReact components={DOCK_COMPONENTS} onReady={onDockReady} theme={dockTheme} disableDnd className="ax-dock h-full" />
        </ActionsCtx.Provider>
      </main>

      {assessment?.proctoring.video_proctoring !== 'OFF' && (
        <WebcamPreview />
      )}

      {showConfirm && (
        <ConfirmModal
          title="Submit Assessment"
          message="Are you sure? You cannot undo this."
          confirmLabel={submitting ? 'Submitting...' : 'Submit'}
          onConfirm={() => { setShowConfirm(false); void doSubmit() }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {showExitConfirm && (
        <ConfirmModal
          title="Exit Assessment"
          message="Do you want to exit?"
          confirmLabel="Exit"
          confirmClassName="bg-[color:var(--status-fail)] text-white hover:opacity-90"
          onConfirm={() => { void handleExit() }}
          onCancel={cancelExitConfirm}
        />
      )}
    </div>
  )
}

function WebcamPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [large, setLarge] = useState(false)
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, window.innerWidth - 196),
    y: Math.max(64, window.innerHeight - 156),
  }))

  useEffect(() => {
    const stream = getProctoringMedia().device
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!box) return
    const dx = event.clientX - box.left
    const dy = event.clientY - box.top
    const move = (next: PointerEvent) => {
      setPos({
        x: Math.min(Math.max(0, next.clientX - dx), window.innerWidth - box.width),
        y: Math.min(Math.max(0, next.clientY - dy), window.innerHeight - box.height),
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  return (
    <div
      className={`fixed z-30 min-h-[96px] min-w-[144px] resize overflow-hidden border border-[color:var(--border-strong)] bg-black ${large ? 'h-[220px] w-[340px]' : 'h-[120px] w-[180px]'}`}
      style={{ left: pos.x, top: pos.y }}
    >
      <div onPointerDown={startDrag} className="flex h-7 cursor-move items-center justify-end gap-1 bg-black/70 px-1">
        <button type="button" onClick={() => setLarge((value) => !value)} className="rounded px-2 text-xs text-white hover:bg-white/15">
          {large ? 'Small' : 'Expand'}
        </button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline aria-label="Webcam preview" className="h-[calc(100%-28px)] w-full object-cover" />
    </div>
  )
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  // Default confirm = green (correctness commit). Destructive callers pass a fail-red class.
  confirmClassName = 'bg-[color:var(--signal-green)] text-[color:var(--bg-canvas)] hover:opacity-90',
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  confirmClassName?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-[10px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-6"
        style={{ boxShadow: 'var(--shadow-float)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className="mb-2 text-lg font-semibold text-[color:var(--text-primary)]">{title}</h3>
        <p className="mb-6 text-sm text-[color:var(--text-secondary)]">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-[8px] border border-[color:var(--border-strong)] px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-raised)] hover:text-[color:var(--text-primary)]">
            Cancel
          </button>
          <button onClick={onConfirm} className={`rounded-[8px] px-4 py-2 text-sm font-medium transition ${confirmClassName}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
