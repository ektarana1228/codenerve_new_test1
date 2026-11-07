import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TaskEditor, type LocalTask } from './TaskEditor'
import {
  ApiException,
  createTask,
  listProjectBugBank,
  listLibraryTasks,
  type Language,
  type ProjectBugBankEntry,
  type LibraryTaskEntry,
} from '../api/client'

function blankTask(): LocalTask {
  return { id: crypto.randomUUID(), title: '', description: '', doneWhen: [''], showPreview: false }
}

// ─── Manual task authoring ────────────────────────────────────────────────────

export function AddTaskPanel({
  assessmentId,
  onAdded,
  onCancel,
}: {
  assessmentId: string
  onAdded: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [task, setTask] = useState<LocalTask>(blankTask)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      createTask(assessmentId, {
        title: task.title,
        description: task.description,
        doneWhen: task.doneWhen.map((c) => c.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] })
      onAdded()
    },
    onError: (err) => setError(err instanceof ApiException ? err.message : 'Failed to add task. Try again.'),
  })

  function validate(): string | null {
    if (!task.title.trim()) return 'Task title is required.'
    if (!task.description.trim()) return 'Task description is required.'
    if (task.doneWhen.filter((c) => c.trim()).length === 0) return 'At least one "Done when" criterion is required.'
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
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">New Task</span>
        <button type="button" onClick={onCancel} className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">Cancel</button>
      </div>
      <div className="space-y-4 p-4">
        {error && (
          <div className="rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">{error}</div>
        )}
        <TaskEditor task={task} index={0} onChange={(updates) => setTask((t) => ({ ...t, ...updates }))} onRemove={onCancel} />
        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--border-subtle)] pt-4">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-secondary)]">Cancel</button>
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

// ─── Bug-fix bank + library task picker ───────────────────────────────────────

export function TaskBankPanel({
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
  const bugBank = useQuery({
    queryKey: ['project-bug-bank', language],
    queryFn: () => listProjectBugBank(language),
  })
  const libraryTasks = useQuery({
    queryKey: ['library-tasks', language],
    queryFn: () => listLibraryTasks({ language }),
  })

  const add = useMutation({
    mutationFn: (entry: { title: string; description: string; doneWhen: string[]; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; referenceFiles: Array<{ path: string; contentBase64: string }>; solutionFiles: Array<{ path: string; contentBase64: string }> }) =>
      createTask(assessmentId, entry),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] })
      onAdded()
    },
  })

  function addBugBankEntry(entry: ProjectBugBankEntry) {
    add.mutate({
      title: entry.title,
      description: entry.description,
      doneWhen: entry.done_when,
      difficulty: entry.difficulty,
      referenceFiles: entry.files,
      solutionFiles: entry.solution_files,
    })
  }

  function addLibraryEntry(entry: LibraryTaskEntry) {
    add.mutate({
      title: entry.title,
      description: entry.description,
      doneWhen: entry.done_when,
      difficulty: entry.difficulty,
      referenceFiles: entry.files,
      solutionFiles: entry.solution_files,
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)]">
      <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-4 py-3">
        <p className="text-sm font-semibold">Bug-fix bank & library tasks for {language}</p>
        <button type="button" onClick={onCancel} className="text-xs text-[color:var(--text-muted)]">Cancel</button>
      </div>
      {add.isError && (
        <p className="border-b border-[color:var(--border-subtle)] px-4 py-2 text-sm text-[color:var(--status-fail)]">
          {add.error instanceof ApiException ? add.error.message : 'Could not add task.'}
        </p>
      )}
      <div className="max-h-96 divide-y divide-[color:var(--border-subtle)] overflow-y-auto">
        {(bugBank.isLoading || libraryTasks.isLoading) && <p className="p-4 text-sm text-[color:var(--text-muted)]">Loading…</p>}
        {bugBank.data?.data.map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={add.isPending}
            onClick={() => addBugBankEntry(entry)}
            className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-[color:var(--bg-overlay)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{entry.title}</p>
              <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">Built-in · {entry.files.length} file{entry.files.length === 1 ? '' : 's'}</p>
            </div>
            <span className="shrink-0 text-xs text-[color:var(--text-muted)]">{entry.difficulty}</span>
          </button>
        ))}
        {libraryTasks.data?.data.map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={add.isPending}
            onClick={() => addLibraryEntry(entry)}
            className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-[color:var(--bg-overlay)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{entry.title}</p>
              <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">My library · {entry.files.length} file{entry.files.length === 1 ? '' : 's'}</p>
            </div>
            <span className="shrink-0 text-xs text-[color:var(--text-muted)]">{entry.difficulty}</span>
          </button>
        ))}
        {!bugBank.isLoading && !libraryTasks.isLoading && !bugBank.data?.data.length && !libraryTasks.data?.data.length && (
          <p className="p-4 text-sm text-[color:var(--text-muted)]">No bug-fix bank or library entries for {language} yet.</p>
        )}
      </div>
    </div>
  )
}
