import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import { Field } from '../components/Field'
import { inputCls, selectCls } from '../components/formStyles'
import { ProblemEditor, type LocalProblem } from '../components/ProblemEditor'
import { TaskEditor, type LocalTask } from '../components/TaskEditor'
import { fileToBase64, formatBytes, base64Size, MAX_REFERENCE_FILE_BYTES, MAX_REFERENCE_TOTAL_BYTES, type LocalReferenceFile } from '../lib/files'
import {
  ApiException,
  listLibraryProblems,
  getLibraryProblem,
  createLibraryProblem,
  updateLibraryProblem,
  deleteLibraryProblem,
  listLibraryTasks,
  createLibraryTask,
  updateLibraryTask,
  deleteLibraryTask,
  type Language,
  type LibraryProblemSummary,
  type LibraryTaskEntry,
} from '../api/client'

type Kind = 'CODING' | 'PROJECT'

function blankProblem(): LocalProblem {
  return { id: crypto.randomUUID(), title: '', difficulty: 'EASY', description: '', allowCopyPaste: false, showPreview: false, testCases: [] }
}

function blankTask(): LocalTask {
  return { id: crypto.randomUUID(), title: '', description: '', doneWhen: [''], showPreview: false }
}

// ─── CODING problem create/edit form ─────────────────────────────────────────

function LibraryProblemForm({
  editingId,
  onDone,
}: {
  editingId?: string
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<LocalProblem>(blankProblem)
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!editingId)

  useQuery({
    queryKey: ['library-problem', editingId],
    queryFn: async () => {
      const { data } = await getLibraryProblem(editingId!)
      setProblem({
        id: data.id,
        title: data.title,
        difficulty: data.difficulty,
        description: data.description,
        allowCopyPaste: data.allow_copy_paste,
        showPreview: false,
        testCases: data.test_cases.map((tc) => ({ id: tc.id, input: tc.input, expected: tc.expected, isHidden: tc.is_hidden })),
      })
      setTopic(data.topic ?? '')
      setLoaded(true)
      return data
    },
    enabled: !!editingId,
  })

  function validate(): string | null {
    if (!problem.title.trim()) return 'Title is required.'
    if (!problem.description.trim()) return 'Description is required.'
    if (problem.testCases.length < 2) return 'Add at least 2 test cases.'
    if (!problem.testCases.some((tc) => !tc.isHidden)) return 'At least one visible test case is required.'
    if (!problem.testCases.some((tc) => tc.isHidden)) return 'At least one hidden test case is required.'
    return null
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: problem.title,
        topic: topic.trim() || undefined,
        description: problem.description,
        difficulty: problem.difficulty,
        allowCopyPaste: problem.allowCopyPaste,
        testCases: problem.testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden })),
      }
      return editingId ? updateLibraryProblem(editingId, payload) : createLibraryProblem(payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['library-problems'] })
      onDone()
    },
    onError: (err) => setError(err instanceof ApiException ? err.message : 'Failed to save problem.'),
  })

  function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError(null)
    mutation.mutate()
  }

  if (!loaded) return <p className="p-4 text-sm text-[color:var(--text-muted)]">Loading…</p>

  return (
    <div className="rounded-xl border border-[color:var(--signal-violet)] bg-[color:var(--bg-raised)] overflow-hidden">
      <div className="flex items-center justify-between bg-[color:var(--bg-overlay)] px-4 py-3">
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">{editingId ? 'Edit Problem' : 'New Problem'}</span>
        <button type="button" onClick={onDone} className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">Cancel</button>
      </div>
      <div className="space-y-4 p-4">
        {error && (
          <div className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">{error}</div>
        )}
        <Field label="Topic (optional)" hint="Free-text tag used for search, e.g. Arrays, Hash Maps.">
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} className={inputCls} placeholder="e.g. Sliding Window" />
        </Field>
        <ProblemEditor
          problem={problem}
          index={0}
          onChange={(updates) => setProblem((p) => ({ ...p, ...updates }))}
          onRemove={onDone}
        />
        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--border-subtle)] pt-4">
          <button type="button" onClick={onDone} className="rounded-lg px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-secondary)]">Cancel</button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={handleSave}
            className="rounded-lg bg-[color:var(--text-primary)] px-5 py-2 text-sm font-semibold text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save Problem'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PROJECT task create/edit form ────────────────────────────────────────────

function LibraryTaskForm({
  entry,
  onDone,
}: {
  entry?: LibraryTaskEntry
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [task, setTask] = useState<LocalTask>(() => entry
    ? { id: entry.id, title: entry.title, description: entry.description, doneWhen: entry.done_when, showPreview: false }
    : blankTask())
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>(entry?.difficulty ?? 'EASY')
  const [language, setLanguage] = useState<Language>(entry?.language ?? 'PYTHON')
  const [referenceFiles, setReferenceFiles] = useState<LocalReferenceFile[]>(() =>
    (entry?.files ?? []).map((f) => ({ id: crypto.randomUUID(), path: f.path, contentBase64: f.contentBase64, size: base64Size(f.contentBase64) })))
  const [solutionFiles, setSolutionFiles] = useState<LocalReferenceFile[]>(() =>
    (entry?.solution_files ?? []).map((f) => ({ id: crypto.randomUUID(), path: f.path, contentBase64: f.contentBase64, size: base64Size(f.contentBase64) })))
  const [error, setError] = useState<string | null>(null)

  async function addFiles(fileList: FileList | null, setter: typeof setReferenceFiles) {
    if (!fileList || fileList.length === 0) return
    const added: LocalReferenceFile[] = []
    for (const file of Array.from(fileList)) {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      added.push({ id: crypto.randomUUID(), path, contentBase64: await fileToBase64(file), size: file.size })
    }
    setter((current) => [...current, ...added])
  }

  function validate(): string | null {
    if (!task.title.trim()) return 'Title is required.'
    if (!task.description.trim()) return 'Description is required.'
    if (task.doneWhen.filter((c) => c.trim()).length === 0) return 'At least one "Done when" criterion is required.'
    const oversized = [...referenceFiles, ...solutionFiles].find((r) => r.size > MAX_REFERENCE_FILE_BYTES)
    if (oversized) return `File "${oversized.path}" exceeds ${formatBytes(MAX_REFERENCE_FILE_BYTES)}.`
    const total = [...referenceFiles, ...solutionFiles].reduce((sum, r) => sum + r.size, 0)
    if (total > MAX_REFERENCE_TOTAL_BYTES) return `Files exceed the ${formatBytes(MAX_REFERENCE_TOTAL_BYTES)} total limit.`
    return null
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: task.title,
        description: task.description,
        difficulty,
        language,
        doneWhen: task.doneWhen.map((c) => c.trim()).filter(Boolean),
        referenceFiles: referenceFiles.map((r) => ({ path: r.path, contentBase64: r.contentBase64 })),
        solutionFiles: solutionFiles.map((r) => ({ path: r.path, contentBase64: r.contentBase64 })),
      }
      return entry ? updateLibraryTask(entry.id, payload) : createLibraryTask(payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['library-tasks'] })
      onDone()
    },
    onError: (err) => setError(err instanceof ApiException ? err.message : 'Failed to save task.'),
  })

  function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError(null)
    mutation.mutate()
  }

  function fileRow(files: LocalReferenceFile[], setter: typeof setReferenceFiles, label: string) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-medium text-[color:var(--text-secondary)]">{label}</label>
          <label className="cursor-pointer rounded-lg border border-[color:var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-overlay)]">
            Add files
            <input type="file" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files, setter); e.target.value = '' }} />
          </label>
        </div>
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-xs">
                <span className="min-w-0 truncate font-mono text-[color:var(--text-primary)]">{r.path}</span>
                <div className="flex shrink-0 items-center gap-3 pl-3">
                  <span className="text-[color:var(--text-muted)]">{formatBytes(r.size)}</span>
                  <button type="button" onClick={() => setter((current) => current.filter((f) => f.id !== r.id))} className="text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[color:var(--signal-violet)] bg-[color:var(--bg-raised)] overflow-hidden">
      <div className="flex items-center justify-between bg-[color:var(--bg-overlay)] px-4 py-3">
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">{entry ? 'Edit Task' : 'New Task'}</span>
        <button type="button" onClick={onDone} className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">Cancel</button>
      </div>
      <div className="space-y-4 p-4">
        {error && (
          <div className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">{error}</div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Difficulty" hint="Used as the AI-usage iteration baseline.">
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'EASY' | 'MEDIUM' | 'HARD')} className={selectCls}>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className={selectCls}>
              <option value="PYTHON">Python</option>
              <option value="JAVASCRIPT">JavaScript</option>
              <option value="TYPESCRIPT">TypeScript</option>
            </select>
          </Field>
        </div>
        <TaskEditor task={task} index={0} onChange={(updates) => setTask((t) => ({ ...t, ...updates }))} onRemove={onDone} />
        {fileRow(referenceFiles, setReferenceFiles, 'Reference files (seeded into the candidate workspace)')}
        {fileRow(solutionFiles, setSolutionFiles, 'Solution files (admin-only, used for AI-assisted grading)')}
        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--border-subtle)] pt-4">
          <button type="button" onClick={onDone} className="rounded-lg px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-secondary)]">Cancel</button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={handleSave}
            className="rounded-lg bg-[color:var(--text-primary)] px-5 py-2 text-sm font-semibold text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save Task'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Coding tab ────────────────────────────────────────────────────────────────

function CodingLibraryTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [page, setPage] = useState(1)
  const [panel, setPanel] = useState<'closed' | 'new' | string>('closed') // string = editing id

  const { data, isLoading } = useQuery({
    queryKey: ['library-problems', search, difficulty, page],
    queryFn: () => listLibraryProblems({ search, difficulty, page }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLibraryProblem(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library-problems'] }),
  })

  function handleDelete(problem: LibraryProblemSummary) {
    if (!confirm(`Delete "${problem.title}" from the library? This cannot be undone.`)) return
    deleteMutation.mutate(problem.id)
  }

  if (panel === 'new') return <LibraryProblemForm onDone={() => setPanel('closed')} />
  if (panel !== 'closed') return <LibraryProblemForm editingId={panel} onDone={() => setPanel('closed')} />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search my library" className={inputCls} />
        <select value={difficulty} onChange={(e) => { setDifficulty(e.target.value); setPage(1) }} className={selectCls}>
          <option value="">All levels</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
        <button type="button" onClick={() => setPanel('new')} className="rounded-lg bg-[color:var(--text-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--bg-canvas)]">New Problem</button>
      </div>

      {isLoading ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : data?.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[color:var(--border-strong)] py-8 text-center text-sm text-[color:var(--text-muted)]">
          No library problems yet - create one to reuse it across assessments.
        </div>
      ) : (
        <div className="space-y-2">
          {data?.data.map((problem) => (
            <div key={problem.id} className="flex items-center justify-between gap-4 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[color:var(--text-primary)]">{problem.title}</p>
                <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                  {problem.topic ?? 'No topic'} · {problem.difficulty} · {problem.test_case_count} tests
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button type="button" onClick={() => setPanel(problem.id)} className="text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]">Edit</button>
                <button type="button" onClick={() => handleDelete(problem)} className="text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-3 text-xs text-[color:var(--text-muted)]">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">Previous</button>
          <span>{page} / {data.pages}</span>
          <button type="button" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  )
}

// ─── Project tab ────────────────────────────────────────────────────────────────

function ProjectLibraryTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [panel, setPanel] = useState<'closed' | 'new' | LibraryTaskEntry>('closed')

  const { data, isLoading } = useQuery({
    queryKey: ['library-tasks', search],
    queryFn: () => listLibraryTasks({ search }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLibraryTask(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library-tasks'] }),
  })

  function handleDelete(entry: LibraryTaskEntry) {
    if (!confirm(`Delete "${entry.title}" from the library? This cannot be undone.`)) return
    deleteMutation.mutate(entry.id)
  }

  if (panel === 'new') return <LibraryTaskForm onDone={() => setPanel('closed')} />
  if (panel !== 'closed') return <LibraryTaskForm entry={panel} onDone={() => setPanel('closed')} />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search my library" className={inputCls} />
        <button type="button" onClick={() => setPanel('new')} className="rounded-lg bg-[color:var(--text-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--bg-canvas)]">New Task</button>
      </div>

      {isLoading ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : data?.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[color:var(--border-strong)] py-8 text-center text-sm text-[color:var(--text-muted)]">
          No library tasks yet - create one to reuse it across PROJECT assessments.
        </div>
      ) : (
        <div className="space-y-2">
          {data?.data.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-4 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[color:var(--text-primary)]">{entry.title}</p>
                <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                  {entry.language} · {entry.difficulty} · {entry.files.length} file{entry.files.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button type="button" onClick={() => setPanel(entry)} className="text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]">Edit</button>
                <button type="button" onClick={() => handleDelete(entry)} className="text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function LibraryPage() {
  const [kind, setKind] = useState<Kind>('CODING')

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[color:var(--text-primary)]">Library</h1>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          Author reusable problems and tasks here, then pick them when creating a new
          assessment or adding to an existing one.
        </p>
      </div>

      <div className="mb-6 flex gap-2">
        {([
          { id: 'CODING', label: 'Coding Problems' },
          { id: 'PROJECT', label: 'Project Tasks' },
        ] as const).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setKind(opt.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${kind === opt.id ? 'bg-[color:var(--text-primary)] text-[color:var(--bg-canvas)]' : 'border border-[color:var(--border-strong)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-overlay)]'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="max-w-3xl">
        {kind === 'CODING' ? <CodingLibraryTab /> : <ProjectLibraryTab />}
      </div>
    </Layout>
  )
}
