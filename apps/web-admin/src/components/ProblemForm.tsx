import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addProblemFromBank, addProblemFromLibrary, ApiException, createProblem, listProblemBank, listLibraryProblems, type Language, type ProblemBankEntry, type LibraryProblemSummary } from '../api/client'

// ─── Local types ──────────────────────────────────────────────────────────────

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'

type LocalTestCase = {
  id: string
  input: string
  expected: string
  isHidden: boolean
}

type LocalProblem = {
  title: string
  difficulty: Difficulty
  description: string
  allowCopyPaste: boolean
  showPreview: boolean
  testCases: LocalTestCase[]
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:border-[color:var(--signal-violet)] focus:outline-none focus:ring-1 focus:ring-[color:var(--signal-violet)]'

// ─── TestCaseRow ──────────────────────────────────────────────────────────────

function TestCaseRow({
  tc,
  index,
  onChange,
  onRemove,
}: {
  tc: LocalTestCase
  index: number
  onChange: (u: Partial<LocalTestCase>) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-[color:var(--text-secondary)]">Test Case {index + 1}</span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
            <input
              type="checkbox"
              checked={tc.isHidden}
              onChange={(e) => onChange({ isHidden: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] accent-[color:var(--signal-violet)]"
            />
            Hidden
          </label>
          <button type="button" onClick={onRemove} className="text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">
            Remove
          </button>
        </div>
      </div>
      {tc.isHidden && (
        <div className="mb-3 rounded-md bg-[color:var(--status-warn-dim)] px-3 py-2 text-xs text-[color:var(--status-warn)]">
          Hidden test cases are never shown to candidates.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-[color:var(--text-muted)]">Input (stdin)</label>
          <textarea
            rows={3}
            value={tc.input}
            onChange={(e) => onChange({ input: e.target.value })}
            className={`${inputCls} resize-y font-mono text-xs`}
            placeholder="stdin input…"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[color:var(--text-muted)]">Expected output</label>
          <textarea
            rows={3}
            value={tc.expected}
            onChange={(e) => onChange({ expected: e.target.value })}
            className={`${inputCls} resize-y font-mono text-xs`}
            placeholder="expected stdout…"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Blank problem factory ────────────────────────────────────────────────────

function blankProblem(): LocalProblem {
  return {
    title: '',
    difficulty: 'EASY',
    description: '',
    allowCopyPaste: false,
    showPreview: false,
    testCases: [],
  }
}

// ─── AddProblemPanel ──────────────────────────────────────────────────────────

export function AddProblemPanel({
  assessmentId,
  onAdded,
  onCancel,
}: {
  assessmentId: string
  onAdded: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<LocalProblem>(blankProblem)
  const [error, setError] = useState<string | null>(null)

  const visibleCount = problem.testCases.filter((tc) => !tc.isHidden).length
  const hiddenCount = problem.testCases.filter((tc) => tc.isHidden).length

  const mutation = useMutation({
    mutationFn: () =>
      createProblem(assessmentId, {
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        allowCopyPaste: problem.allowCopyPaste,
        testCases: problem.testCases.map((tc) => ({
          input: tc.input,
          expected: tc.expected,
          isHidden: tc.isHidden,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] })
      onAdded()
    },
    onError: (err) => {
      setError(err instanceof ApiException ? err.message : 'Failed to add problem. Try again.')
    },
  })

  function update(updates: Partial<LocalProblem>) {
    setProblem((p) => ({ ...p, ...updates }))
  }

  function addTestCase() {
    update({
      testCases: [
        ...problem.testCases,
        { id: crypto.randomUUID(), input: '', expected: '', isHidden: false },
      ],
    })
  }

  function updateTestCase(id: string, updates: Partial<LocalTestCase>) {
    update({ testCases: problem.testCases.map((tc) => (tc.id === id ? { ...tc, ...updates } : tc)) })
  }

  function removeTestCase(id: string) {
    update({ testCases: problem.testCases.filter((tc) => tc.id !== id) })
  }

  function validate(): string | null {
    if (!problem.title.trim()) return 'Problem title is required.'
    if (!problem.description.trim()) return 'Problem description is required.'
    if (problem.testCases.length < 2) return 'Add at least 2 test cases.'
    if (!problem.testCases.some((tc) => !tc.isHidden)) return 'At least one visible test case is required.'
    if (!problem.testCases.some((tc) => tc.isHidden)) return 'At least one hidden test case is required.'
    return null
  }

  function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="rounded-xl border border-[color:var(--signal-violet)] bg-[color:var(--bg-raised)] overflow-hidden">
      <div className="flex items-center justify-between bg-[color:var(--bg-overlay)] px-4 py-3">
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">New Problem</span>
        <button type="button" onClick={onCancel} className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
          Cancel
        </button>
      </div>

      <div className="space-y-4 p-4">
        {error && (
          <div className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
            {error}
          </div>
        )}

        {/* Title + difficulty */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Title *</label>
            <input
              type="text"
              value={problem.title}
              onChange={(e) => update({ title: e.target.value })}
              className={inputCls}
              placeholder="e.g. Two Sum"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Difficulty</label>
            <select
              value={problem.difficulty}
              onChange={(e) => update({ difficulty: e.target.value as Difficulty })}
              className={`${inputCls} cursor-pointer`}
            >
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Description (Markdown) *</label>
          <div className="overflow-hidden rounded-lg border border-[color:var(--border-strong)]">
            <div className="flex border-b border-[color:var(--border-strong)]">
              <button
                type="button"
                onClick={() => update({ showPreview: false })}
                className={`px-3 py-1.5 text-xs font-medium ${!problem.showPreview ? 'bg-[color:var(--bg-raised)] text-[color:var(--text-primary)] shadow-sm' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => update({ showPreview: true })}
                className={`px-3 py-1.5 text-xs font-medium ${problem.showPreview ? 'bg-[color:var(--bg-raised)] text-[color:var(--text-primary)] shadow-sm' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'}`}
              >
                Preview
              </button>
            </div>
            {problem.showPreview ? (
              <div className="min-h-[120px] bg-[color:var(--bg-overlay)] px-4 py-3 prose prose-sm max-w-none text-[color:var(--text-secondary)]">
                {problem.description
                  ? <ReactMarkdown>{problem.description}</ReactMarkdown>
                  : <p className="text-[color:var(--text-secondary)] italic">Nothing to preview yet.</p>}
              </div>
            ) : (
              <textarea
                rows={5}
                value={problem.description}
                onChange={(e) => update({ description: e.target.value })}
                className="w-full bg-[color:var(--bg-overlay)] px-3 py-3 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none font-mono resize-y"
                placeholder="# Problem Title&#10;&#10;Describe the problem…"
              />
            )}
          </div>
        </div>

        {/* Test cases */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">
              Test Cases
              <span className="ml-2 font-normal text-[color:var(--text-secondary)]">
                ({visibleCount} visible, {hiddenCount} hidden)
              </span>
            </label>
            {problem.testCases.length > 0 && (visibleCount === 0 || hiddenCount === 0) && (
              <span className="text-xs text-[color:var(--status-warn)]">Need ≥1 visible and ≥1 hidden</span>
            )}
          </div>
          <div className="space-y-3">
            {problem.testCases.map((tc, i) => (
              <TestCaseRow
                key={tc.id}
                tc={tc}
                index={i}
                onChange={(u) => updateTestCase(tc.id, u)}
                onRemove={() => removeTestCase(tc.id)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addTestCase}
            className="mt-3 flex items-center gap-1.5 text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add test case
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--border-subtle)] pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-secondary)]"
          >
            Cancel
          </button>
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

export function ProblemBankPanel({
  assessmentId,
  language,
  onAdded,
  onCancel,
}: {
  assessmentId: string
  language: Language
  onAdded: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ProblemBankEntry | null>(null)
  const bank = useQuery({
    queryKey: ['problem-bank', search, topic, difficulty, page],
    queryFn: () => listProblemBank({ search, topic, difficulty, page }),
  })
  const add = useMutation({
    mutationFn: (bankId: string) => addProblemFromBank(assessmentId, bankId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] })
      onAdded()
    },
  })
  const filter = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
    setSelected(null)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)]">
      <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-4 py-3">
        <div><p className="text-sm font-semibold">ApexCoder problem bank</p><p className="text-xs text-[color:var(--text-muted)]">{bank.data?.total ?? 500} original problems</p></div>
        <button type="button" onClick={onCancel} className="text-xs text-[color:var(--text-muted)]">Cancel</button>
      </div>
      <div className="grid gap-3 border-b border-[color:var(--border-subtle)] p-4 md:grid-cols-[1fr_180px_140px]">
        <input value={search} onChange={(event) => filter(setSearch, event.target.value)} placeholder="Search title, topic, or statement" className={inputCls} />
        <select value={topic} onChange={(event) => filter(setTopic, event.target.value)} className={inputCls}><option value="">All topics</option>{bank.data?.topics.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={difficulty} onChange={(event) => filter(setDifficulty, event.target.value)} className={inputCls}><option value="">All levels</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select>
      </div>
      <div className="grid min-h-[460px] md:grid-cols-[minmax(280px,1fr)_minmax(320px,1.2fr)]">
        <div className="max-h-[520px] overflow-y-auto border-r border-[color:var(--border-subtle)]">
          {bank.isLoading ? <p className="p-4 text-sm text-[color:var(--text-muted)]">Loading...</p> : bank.data?.data.map((problem) => (
            <button key={problem.id} type="button" onClick={() => setSelected(problem)} className={`block w-full border-b border-[color:var(--border-subtle)] p-3 text-left ${selected?.id === problem.id ? 'bg-[color:var(--bg-overlay)]' : 'hover:bg-[color:var(--bg-canvas)]'}`}>
              <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium">{problem.title}</p><span className="text-xs text-[color:var(--text-muted)]">{problem.difficulty}</span></div>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">{problem.topic} · {problem.test_case_count} tests</p>
            </button>
          ))}
          {!bank.isLoading && !bank.data?.data.length && <p className="p-4 text-sm text-[color:var(--text-muted)]">No matching problems.</p>}
        </div>
        <div className="max-h-[520px] overflow-y-auto p-4">
          {selected ? <div className="space-y-4">
            <div><h3 className="font-semibold">{selected.title}</h3><p className="mt-1 text-xs text-[color:var(--text-muted)]">{selected.time_complexity} time · {selected.space_complexity} space</p></div>
            <div className="prose prose-sm max-w-none text-[color:var(--text-secondary)]"><ReactMarkdown>{selected.description}</ReactMarkdown></div>
            <div><p className="mb-2 text-xs font-semibold uppercase text-[color:var(--text-muted)]">Reference solution ({language})</p><pre className="max-h-64 overflow-auto bg-[color:var(--bg-inset)] p-3 text-xs"><code>{selected.reference_solutions[language]}</code></pre></div>
            {add.isError && <p className="text-sm text-[color:var(--status-fail)]">{add.error instanceof Error ? add.error.message : 'Could not add problem.'}</p>}
            <button type="button" disabled={add.isPending} onClick={() => add.mutate(selected.id)} className="bg-[color:var(--text-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--bg-canvas)] disabled:opacity-50">{add.isPending ? 'Saving...' : 'Add to assessment'}</button>
          </div> : <p className="text-sm text-[color:var(--text-muted)]">Select a problem to review its statement and optimal solution.</p>}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] px-4 py-3 text-xs text-[color:var(--text-muted)]">
        <span>Page {bank.data?.page ?? page} of {bank.data?.pages ?? 1}</span>
        <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setSelected(null) }} className="border border-[color:var(--border-strong)] px-3 py-1.5 disabled:opacity-40">Previous</button><button type="button" disabled={page >= (bank.data?.pages ?? 1)} onClick={() => { setPage((value) => value + 1); setSelected(null) }} className="border border-[color:var(--border-strong)] px-3 py-1.5 disabled:opacity-40">Next</button></div>
      </div>
    </div>
  )
}

export function LibraryProblemPanel({
  assessmentId,
  onAdded,
  onCancel,
}: {
  assessmentId: string
  onAdded: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [page, setPage] = useState(1)
  const library = useQuery({
    queryKey: ['library-problems', search, difficulty, page],
    queryFn: () => listLibraryProblems({ search, difficulty, page }),
  })
  const add = useMutation({
    mutationFn: (libraryId: string) => addProblemFromLibrary(assessmentId, libraryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] })
      onAdded()
    },
  })
  const filter = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)]">
      <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-4 py-3">
        <div><p className="text-sm font-semibold">My library</p><p className="text-xs text-[color:var(--text-muted)]">{library.data?.total ?? 0} problems</p></div>
        <button type="button" onClick={onCancel} className="text-xs text-[color:var(--text-muted)]">Cancel</button>
      </div>
      <div className="grid gap-3 border-b border-[color:var(--border-subtle)] p-4 md:grid-cols-[1fr_140px]">
        <input value={search} onChange={(event) => filter(setSearch, event.target.value)} placeholder="Search title, topic, or statement" className={inputCls} />
        <select value={difficulty} onChange={(event) => filter(setDifficulty, event.target.value)} className={inputCls}><option value="">All levels</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select>
      </div>
      {add.isError && <p className="border-b border-[color:var(--border-subtle)] px-4 py-2 text-sm text-[color:var(--status-fail)]">{add.error instanceof ApiException ? add.error.message : 'Could not add problem.'}</p>}
      <div className="max-h-96 divide-y divide-[color:var(--border-subtle)] overflow-y-auto">
        {library.isLoading ? <p className="p-4 text-sm text-[color:var(--text-muted)]">Loading...</p> : library.data?.data.map((problem: LibraryProblemSummary) => (
          <button key={problem.id} type="button" disabled={add.isPending} onClick={() => add.mutate(problem.id)} className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-[color:var(--bg-canvas)] disabled:cursor-not-allowed disabled:opacity-45">
            <div><p className="text-sm font-medium">{problem.title}</p><p className="mt-1 text-xs text-[color:var(--text-muted)]">{problem.topic ?? 'No topic'} · {problem.test_case_count} tests</p></div>
            <span className="text-xs text-[color:var(--text-muted)]">{problem.difficulty}</span>
          </button>
        ))}
        {!library.isLoading && !library.data?.data.length && <p className="p-4 text-sm text-[color:var(--text-muted)]">No library problems yet.</p>}
      </div>
      <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] px-4 py-3 text-xs text-[color:var(--text-muted)]">
        <span>Page {library.data?.page ?? page} of {library.data?.pages ?? 1}</span>
        <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="border border-[color:var(--border-strong)] px-3 py-1.5 disabled:opacity-40">Previous</button><button type="button" disabled={page >= (library.data?.pages ?? 1)} onClick={() => setPage((value) => value + 1)} className="border border-[color:var(--border-strong)] px-3 py-1.5 disabled:opacity-40">Next</button></div>
      </div>
    </div>
  )
}
