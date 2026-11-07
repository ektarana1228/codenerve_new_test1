import { useState } from 'react'
import { useSessionStore, serializeAllFiles } from '../store/session'
import { flushVscode, runCode, saveCode } from '../api/client'
import type { RunCodeResponse } from '../api/client'

interface Props {
  disabled?: boolean
  submitting?: boolean
  onSubmit?: () => void
  onCollapsedChange?: (collapsed: boolean) => void
  className?: string
  // PROJECT assessments have no test cases - show a submit-only, deliverable panel.
  projectMode?: boolean
}

type RunData = RunCodeResponse['data']
type Tab = 'testcase' | 'result'

// LeetCode-style verdict from the run result (no fabricated runtime - the API doesn't return one).
function verdict(r: RunData): { text: string; color: string } {
  if (r.status === 'timeout') return { text: 'Time Limit Exceeded', color: 'var(--status-warn)' }
  if (r.status === 'error') return { text: 'Runtime Error', color: 'var(--status-fail)' }
  return r.failed === 0
    ? { text: 'Accepted', color: 'var(--signal-green)' }
    : { text: 'Wrong Answer', color: 'var(--status-fail)' }
}

export function RunPanel({ disabled = false, submitting = false, onSubmit, onCollapsedChange, className = '', projectMode = false }: Props) {
  const session_id = useSessionStore((s) => s.session_id)
  const problem = useSessionStore((s) => s.problem)
  const files = useSessionStore((s) => s.files)
  const activeFile = useSessionStore((s) => s.activeFile)
  const examples = problem?.visible_test_cases ?? []

  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<RunData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('testcase')
  const [selected, setSelected] = useState(0)
  const [collapsed, setCollapsed] = useState(false)

  const handleRun = async () => {
    if (!session_id || running) return
    setRunning(true)
    setError(null)
    setResults(null)
    if (collapsed) {
      setCollapsed(false)
      onCollapsedChange?.(false)
    }
    try {
      if (!problem) throw new Error('No active problem')
      // CODING (Monaco): run the in-browser store code and persist it. PROJECT
      // (VS Code): flush the container workspace into the durable copy, run that.
      let code: string
      if (projectMode) {
        const { data: flushed } = await flushVscode(session_id)
        code = flushed.code
      } else {
        code = serializeAllFiles(files, activeFile)
        await saveCode(session_id, code).catch(() => {})
      }
      const res = await runCode(session_id, problem.id, code)
      setResults(res.data)
      setTab('result')
      setSelected(0)
    } catch {
      setError('Failed to run code. Please try again.')
      setTab('result')
    } finally {
      setRunning(false)
    }
  }

  // PROJECT: no test cases - a submit-only deliverable panel.
  if (projectMode) {
    return (
      <div className={`flex h-full min-h-0 flex-col bg-[color:var(--bg-raised)] ${className}`}>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[color:var(--bg-inset)] px-5 py-4 text-sm text-[color:var(--text-secondary)]">
          <p className="mb-2 font-medium text-[color:var(--text-primary)]">Deliverable-based assessment</p>
          <p>
            Build your solution in the editor. Make sure your workspace includes the required
            submission files listed in the brief - there are no test cases to run. Submit when you're
            done.
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end border-t border-[color:var(--border-subtle)] px-5 py-2.5">
          <button
            onClick={onSubmit}
            disabled={disabled || submitting}
            data-cursor="green"
            className="rounded-[8px] bg-[color:var(--signal-green)] px-4 py-1.5 text-sm font-semibold text-[color:var(--bg-canvas)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    )
  }

  const v = results ? verdict(results) : null
  const cases = results?.results ?? []
  const activeExample = examples[Math.min(selected, Math.max(0, examples.length - 1))]
  const activeCase = cases[Math.min(selected, Math.max(0, cases.length - 1))]

  const tabCls = (t: Tab) =>
    `border-b-2 px-1 pb-2 pt-1 text-sm transition-colors ${
      tab === t
        ? 'border-[color:var(--text-primary)] text-[color:var(--text-primary)]'
        : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
    }`

  return (
    <div className={`flex h-full min-h-0 flex-col bg-[color:var(--bg-raised)] ${className}`}>
      {!collapsed && (
        <>
          <div className="flex shrink-0 items-center gap-5 border-b border-[color:var(--border-subtle)] px-5 pt-2">
            <button className={tabCls('testcase')} onClick={() => setTab('testcase')}>Testcase</button>
            <button className={tabCls('result')} onClick={() => setTab('result')}>Result</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[color:var(--bg-inset)] px-5 py-4">
            {error && <p className="text-xs text-[color:var(--status-fail)]">{error}</p>}

            {tab === 'testcase' && !error && (
              examples.length === 0 ? (
                <p className="text-xs text-[color:var(--text-muted)]">No visible test cases for this problem.</p>
              ) : (
                <div className="space-y-3">
                  <CasePills count={examples.length} selected={selected} onSelect={setSelected} />
                  {activeExample && (
                    <div className="space-y-2 text-xs">
                      <Field label="Input" value={activeExample.input || '(empty)'} />
                      <Field label="Expected" value={activeExample.expected} />
                    </div>
                  )}
                </div>
              )
            )}

            {tab === 'result' && !error && (
              !results ? (
                <p className="text-xs text-[color:var(--text-muted)]">Run your code to see the result.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-baseline gap-3">
                    <span className="text-base font-semibold" style={{ color: v!.color }}>{v!.text}</span>
                    <span className="font-mono text-xs text-[color:var(--text-muted)]">
                      {results.passed} / {results.passed + results.failed} testcases passed
                    </span>
                  </div>
                  {cases.length > 0 && (
                    <CasePills
                      count={cases.length}
                      selected={selected}
                      onSelect={setSelected}
                      tone={(i) => (cases[i]?.status === 'pass' ? 'pass' : 'fail')}
                    />
                  )}
                  {activeCase && (
                    <div className="ax-rise-in space-y-2 text-xs">
                      <span style={{ color: activeCase.status === 'pass' ? 'var(--signal-green)' : 'var(--status-fail)' }}>
                        {activeCase.status === 'pass' ? 'Passed' : activeCase.status === 'error' ? 'Runtime error' : 'Failed'}
                      </span>
                      {activeExample && <Field label="Input" value={activeExample.input || '(empty)'} />}
                      {activeExample && <Field label="Expected" value={activeExample.expected} />}
                      <Field label="Actual output" value={activeCase.stdout || '(no output)'} fail={activeCase.status !== 'pass'} />
                      {activeCase.stderr && <Field label="Stderr" value={activeCase.stderr} fail />}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </>
      )}

      <div className="flex shrink-0 items-center justify-between border-t border-[color:var(--border-subtle)] px-5 py-2.5">
        <button
          onClick={() => {
            setCollapsed((current) => {
              const next = !current
              onCollapsedChange?.(next)
              return next
            })
          }}
          className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
        >
          Console
          <svg className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={disabled || running}
            data-cursor="green"
            className="flex items-center gap-2 rounded-[8px] border border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] px-4 py-1.5 text-sm font-medium text-[color:var(--signal-green)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border border-current/30 border-t-current" />
                Running
              </>
            ) : (
              'Run'
            )}
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled || submitting}
            data-cursor="green"
            className="rounded-[8px] bg-[color:var(--signal-green)] px-4 py-1.5 text-sm font-semibold text-[color:var(--bg-canvas)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CasePills({
  count,
  selected,
  onSelect,
  tone,
}: {
  count: number
  selected: number
  onSelect: (i: number) => void
  tone?: (i: number) => 'pass' | 'fail'
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }, (_, i) => {
        const active = i === selected
        const dot = tone ? (tone(i) === 'pass' ? 'var(--signal-green)' : 'var(--status-fail)') : undefined
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={`flex items-center gap-1.5 rounded-[8px] px-3 py-1 text-xs transition-colors ${
              active
                ? 'bg-[color:var(--bg-overlay)] text-[color:var(--text-primary)]'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-overlay)]'
            }`}
          >
            {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
            Case {i + 1}
          </button>
        )
      })}
    </div>
  )
}

function Field({ label, value, fail = false }: { label: string; value: string; fail?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-[color:var(--text-muted)]">{label}</p>
      <pre
        className="whitespace-pre-wrap break-words rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] px-3 py-2 font-mono"
        style={{ color: fail ? 'var(--status-fail)' : 'var(--text-primary)' }}
      >
        {value}
      </pre>
    </div>
  )
}
