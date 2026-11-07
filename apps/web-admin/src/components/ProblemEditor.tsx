import ReactMarkdown from 'react-markdown'
import { Field } from './Field'
import { inputCls, selectCls } from './formStyles'

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'

export type LocalTestCase = {
  id: string
  input: string
  expected: string
  isHidden: boolean
}

export type LocalProblem = {
  id: string
  bankId?: string
  libraryId?: string
  topic?: string
  testCaseCount?: number
  title: string
  difficulty: Difficulty
  description: string
  allowCopyPaste: boolean
  showPreview: boolean
  testCases: LocalTestCase[]
}

// ─── TestCase form ────────────────────────────────────────────────────────────

function TestCaseRow({
  tc,
  index,
  onChange,
  onRemove,
}: {
  tc: LocalTestCase
  index: number
  onChange: (updates: Partial<LocalTestCase>) => void
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

// ─── Problem form ─────────────────────────────────────────────────────────────

export function ProblemEditor({
  problem,
  index,
  onChange,
  onRemove,
}: {
  problem: LocalProblem
  index: number
  onChange: (updates: Partial<LocalProblem>) => void
  onRemove: () => void
}) {
  const visibleCount = problem.testCases.filter((tc) => !tc.isHidden).length
  const hiddenCount = problem.testCases.filter((tc) => tc.isHidden).length

  function addTestCase() {
    onChange({
      testCases: [
        ...problem.testCases,
        { id: crypto.randomUUID(), input: '', expected: '', isHidden: false },
      ],
    })
  }

  function updateTestCase(id: string, updates: Partial<LocalTestCase>) {
    onChange({
      testCases: problem.testCases.map((tc) => (tc.id === id ? { ...tc, ...updates } : tc)),
    })
  }

  function removeTestCase(id: string) {
    onChange({ testCases: problem.testCases.filter((tc) => tc.id !== id) })
  }

  return (
    <div className="rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)] overflow-hidden">
      <div className="flex items-center justify-between bg-[color:var(--bg-overlay)] px-4 py-3">
        <span className="text-sm font-medium text-[color:var(--text-primary)]">Problem {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">
          Remove problem
        </button>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Title">
            <input
              type="text"
              value={problem.title}
              onChange={(e) => onChange({ title: e.target.value })}
              className={inputCls}
              placeholder="e.g. Two Sum"
            />
          </Field>
          <Field label="Difficulty">
            <select
              value={problem.difficulty}
              onChange={(e) => onChange({ difficulty: e.target.value as Difficulty })}
              className={selectCls}
            >
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-canvas)] px-3 py-2.5 text-sm text-[color:var(--text-secondary)]">
          <input
            type="checkbox"
            checked={problem.allowCopyPaste}
            onChange={(e) => onChange({ allowCopyPaste: e.target.checked })}
            className="h-4 w-4 rounded border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] accent-[color:var(--signal-violet)]"
          />
          <span>Allow copy and paste for candidates on this problem</span>
        </label>

        {/* Markdown description */}
        <Field label="Problem description (Markdown)">
          <div className="overflow-hidden rounded-lg border border-[color:var(--border-strong)]">
            <div className="flex border-b border-[color:var(--border-strong)]">
              <button
                type="button"
                onClick={() => onChange({ showPreview: false })}
                className={`px-3 py-1.5 text-xs font-medium ${!problem.showPreview ? 'bg-[color:var(--bg-raised)] text-[color:var(--text-primary)] shadow-sm' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onChange({ showPreview: true })}
                className={`px-3 py-1.5 text-xs font-medium ${problem.showPreview ? 'bg-[color:var(--bg-raised)] text-[color:var(--text-primary)] shadow-sm' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'}`}
              >
                Preview
              </button>
            </div>
            {problem.showPreview ? (
              <div className="min-h-[120px] bg-[color:var(--bg-overlay)] px-4 py-3 prose prose-sm max-w-none text-[color:var(--text-secondary)]">
                {problem.description ? (
                  <ReactMarkdown>{problem.description}</ReactMarkdown>
                ) : (
                  <p className="text-[color:var(--text-secondary)] italic">Nothing to preview yet.</p>
                )}
              </div>
            ) : (
              <textarea
                rows={5}
                value={problem.description}
                onChange={(e) => onChange({ description: e.target.value })}
                className="w-full bg-[color:var(--bg-overlay)] px-3 py-3 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none font-mono resize-y"
                placeholder="# Problem Title&#10;&#10;Describe the problem…"
              />
            )}
          </div>
        </Field>

        {/* Test cases */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">
              Test Cases
              <span className="ml-2 font-normal text-[color:var(--text-secondary)]">
                ({visibleCount} visible, {hiddenCount} hidden)
              </span>
            </label>
            {(visibleCount === 0 || hiddenCount === 0) && problem.testCases.length > 0 && (
              <span className="text-xs text-[color:var(--status-warn)]">
                Need ≥1 visible and ≥1 hidden
              </span>
            )}
          </div>
          <div className="space-y-3">
            {problem.testCases.map((tc, i) => (
              <TestCaseRow
                key={tc.id}
                tc={tc}
                index={i}
                onChange={(updates) => updateTestCase(tc.id, updates)}
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
      </div>
    </div>
  )
}
