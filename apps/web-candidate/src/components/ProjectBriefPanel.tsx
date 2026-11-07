import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSessionStore } from '../store/session'

// Candidate-facing brief for a PROJECT-kind assessment: the task list with
// "Done when" acceptance criteria, provided template notes,
// optional connection details, and the required submission files. Mirrors the
// structure of the paper handouts (App Migration / MCP Server).
export function ProjectBriefPanel() {
  const project = useSessionStore((s) => s.project)
  const assessment = useSessionStore((s) => s.assessment)

  // Local, self-tracking checkboxes - purely for the candidate's own use.
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => setChecked((c) => ({ ...c, [key]: !c[key] }))

  if (!project) return null

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--bg-raised)]">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 text-[15px] leading-7 text-[color:var(--text-secondary)]">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Assessment</p>
          <h1 className="text-[1.5rem] font-semibold leading-tight text-[color:var(--text-primary)]">{assessment?.title}</h1>
        </div>

        {/* Provided template */}
        {project.template_info && (
          <section>
            <div className="mb-3 max-w-none [&_code]:rounded [&_code]:bg-[color:var(--bg-inset)] [&_code]:px-1.5 [&_code]:py-0.5 [&_li]:my-1 [&_ul]:pl-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.template_info}</ReactMarkdown>
            </div>
          </section>
        )}

        {/* Connection details */}
        {project.connection_details.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[color:var(--text-primary)]">Connection details</h2>
            <div className="overflow-hidden rounded-[10px] border border-[color:var(--border-subtle)]">
              {project.connection_details.map((c, i) => (
                <div key={i} className="flex justify-between gap-4 border-b border-[color:var(--border-subtle)] px-4 py-2.5 text-sm last:border-0">
                  <span className="font-mono text-[color:var(--text-muted)]">{c.label}</span>
                  <span className="break-all text-right font-mono text-[color:var(--text-primary)]">{c.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tasks */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Tasks</h2>
          {project.tasks.map((task, i) => (
            <div key={task.id} className="rounded-[10px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-4">
              <h3 className="mb-2 text-base font-semibold text-[color:var(--text-primary)]">
                Task {i + 1} - {task.title}
              </h3>
              <div className="mb-3 max-w-none [&_code]:rounded [&_code]:bg-[color:var(--bg-inset)] [&_code]:px-1.5 [&_code]:py-0.5 [&_li]:my-1 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-[color:var(--bg-inset)] [&_pre]:p-3 [&_table]:block [&_table]:overflow-x-auto [&_ul]:pl-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
              </div>
              {task.done_when.length > 0 && (
                <div className="rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-inset)] p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Done when</p>
                  <ul className="space-y-1.5">
                    {task.done_when.map((c, ci) => {
                      const key = `${task.id}:${ci}`
                      return (
                        <li key={ci}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm text-[color:var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={!!checked[key]}
                              onChange={() => toggle(key)}
                              className="mt-0.5 h-4 w-4 rounded border-[color:var(--border-strong)] accent-[color:var(--signal-green)]"
                            />
                            <span className={checked[key] ? 'text-[color:var(--text-muted)] line-through' : ''}>{c}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </section>

        {/* Submission requirements */}
        {project.submission_files.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[color:var(--text-primary)]">Submission requirements</h2>
            <ul className="space-y-1.5 text-sm">
              {project.submission_files.map((s, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-[color:var(--text-primary)]">{s.name}</span>
                  {s.description && <span className="text-[color:var(--text-muted)]">- {s.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
