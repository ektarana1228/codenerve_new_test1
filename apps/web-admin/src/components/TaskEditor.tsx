import ReactMarkdown from 'react-markdown'
import { Field } from './Field'
import { inputCls } from './formStyles'
import type { Difficulty } from './ProblemEditor'

export type LocalTask = {
  id: string
  title: string
  description: string
  doneWhen: string[]
  showPreview: boolean
  // Set when this task was added from the bug-fix bank or the library.
  difficulty?: Difficulty
  bugBankId?: string
  libraryId?: string
}

export function TaskEditor({
  task,
  index,
  onChange,
  onRemove,
}: {
  task: LocalTask
  index: number
  onChange: (updates: Partial<LocalTask>) => void
  onRemove: () => void
}) {
  function setCriterion(i: number, value: string) {
    onChange({ doneWhen: task.doneWhen.map((c, ci) => (ci === i ? value : c)) })
  }
  function addCriterion() {
    onChange({ doneWhen: [...task.doneWhen, ''] })
  }
  function removeCriterion(i: number) {
    onChange({ doneWhen: task.doneWhen.filter((_, ci) => ci !== i) })
  }

  return (
    <div className="rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)] overflow-hidden">
      <div className="flex items-center justify-between bg-[color:var(--bg-overlay)] px-4 py-3">
        <span className="text-sm font-medium text-[color:var(--text-primary)]">Task {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">
          Remove task
        </button>
      </div>
      <div className="space-y-4 p-4">
        <Field label="Title">
          <input
            type="text"
            value={task.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className={inputCls}
            placeholder="e.g. Run Overmorrow as a web app"
          />
        </Field>

        <Field label="Description (Markdown)">
          <div className="overflow-hidden rounded-lg border border-[color:var(--border-strong)]">
            <div className="flex border-b border-[color:var(--border-strong)]">
              <button
                type="button"
                onClick={() => onChange({ showPreview: false })}
                className={`px-3 py-1.5 text-xs font-medium ${!task.showPreview ? 'bg-[color:var(--bg-raised)] text-[color:var(--text-primary)] shadow-sm' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onChange({ showPreview: true })}
                className={`px-3 py-1.5 text-xs font-medium ${task.showPreview ? 'bg-[color:var(--bg-raised)] text-[color:var(--text-primary)] shadow-sm' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'}`}
              >
                Preview
              </button>
            </div>
            {task.showPreview ? (
              <div className="min-h-[100px] bg-[color:var(--bg-overlay)] px-4 py-3 prose prose-sm max-w-none text-[color:var(--text-secondary)]">
                {task.description ? (
                  <ReactMarkdown>{task.description}</ReactMarkdown>
                ) : (
                  <p className="italic text-[color:var(--text-secondary)]">Nothing to preview yet.</p>
                )}
              </div>
            ) : (
              <textarea
                rows={5}
                value={task.description}
                onChange={(e) => onChange({ description: e.target.value })}
                className="w-full resize-y bg-[color:var(--bg-overlay)] px-3 py-3 font-mono text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none"
                placeholder="What the candidate must do…"
              />
            )}
          </div>
        </Field>

        {/* Done-when acceptance criteria */}
        <div>
          <label className="mb-2 block text-xs font-medium text-[color:var(--text-secondary)]">
            Done when <span className="font-normal text-[color:var(--text-muted)]">(acceptance criteria)</span>
          </label>
          <div className="space-y-2">
            {task.doneWhen.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[color:var(--text-muted)]">•</span>
                <input
                  type="text"
                  value={c}
                  onChange={(e) => setCriterion(i, e.target.value)}
                  className={inputCls}
                  placeholder="e.g. the app builds for the web and runs in a browser"
                />
                <button
                  type="button"
                  onClick={() => removeCriterion(i)}
                  className="shrink-0 text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCriterion}
            className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add criterion
          </button>
        </div>
      </div>
    </div>
  )
}
