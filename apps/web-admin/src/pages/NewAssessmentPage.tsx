import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useQuery } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import { formatBytes, base64Size, MAX_REFERENCE_FILE_BYTES, MAX_REFERENCE_TOTAL_BYTES, type LocalReferenceFile } from '../lib/files'
import { Field } from '../components/Field'
import { inputCls, selectCls } from '../components/formStyles'
import { ProblemEditor, type LocalProblem } from '../components/ProblemEditor'
import { TaskEditor, type LocalTask } from '../components/TaskEditor'
import {
  ApiException,
  createAssessment,
  addProblemFromBank,
  addProblemFromLibrary,
  createProblem,
  listProblemBank,
  listLibraryProblems,
  listLibraryTasks,
  updateAssessment,
  type Language,
  type AiuMetric,
  type AssessmentKind,
  type ProctoringMode,
  type AiAssistantMode,
  type ScoringStrictness,
  type ProblemBankEntry,
  type LibraryProblemSummary,
  type LibraryTaskEntry,
  type ProjectScoringCriterion,
} from '../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type LocalConnectionDetail = { id: string; label: string; value: string }
type LocalSubmissionFile = { id: string; name: string; description: string }
type LocalProjectCriterion = ProjectScoringCriterion & { id: string; isDefault: boolean }

type FormState = {
  title: string
  description: string
  kind: AssessmentKind
  timeLimitMinutes: number
  language: Language
  llmModel: string
  codeWeight: number
  aiuWeight: number
  aiuMetrics: AiuMetric[]
  aiuMetricWeights: Record<string, number>
  allowCopyPaste: boolean
  aiAssistantMode: AiAssistantMode
  scoringStrictness: ScoringStrictness
  screenRecording: ProctoringMode
  videoProctoring: ProctoringMode
  microphoneRecording: ProctoringMode
  secondCamera: ProctoringMode
  problems: LocalProblem[]
  // PROJECT kind.
  templateInfo: string
  connectionDetails: LocalConnectionDetail[]
  submissionFiles: LocalSubmissionFile[]
  referenceFiles: LocalReferenceFile[]
  projectScoringCriteria: LocalProjectCriterion[]
  // Admin-only reference fix for bug-fix bank tasks - never seeded to the
  // candidate workspace, write-only (used by SQS scoring).
  solutionFiles: LocalReferenceFile[]
  tasks: LocalTask[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AIU_METRIC_DEFS: Array<{ id: AiuMetric; key: string; label: string; description: string }> = [
  { id: 'PROMPT_QUALITY', key: 'prompt_quality', label: 'Correctness', description: 'Weighted functional test results' },
  { id: 'ITERATION_EFFICIENCY', key: 'iteration_efficiency', label: 'Efficiency', description: 'Weighted performance test results' },
  { id: 'INDEPENDENT_EDITING', key: 'independent_editing', label: 'Robustness', description: 'Weighted edge and robustness test results' },
  { id: 'CONTEXTUAL_RELEVANCE', key: 'contextual_relevance', label: 'Code Quality', description: 'Deterministic source quality checks' },
]

const DEFAULT_METRICS: AiuMetric[] = ['PROMPT_QUALITY', 'ITERATION_EFFICIENCY', 'INDEPENDENT_EDITING', 'CONTEXTUAL_RELEVANCE']
const DEFAULT_WEIGHTS = { prompt_quality: 25, iteration_efficiency: 25, independent_editing: 25, contextual_relevance: 25 }
const STRICTNESS_OPTIONS: Array<{ id: ScoringStrictness; label: string }> = [
  { id: 'LOW', label: 'Low' },
  { id: 'MEDIUM', label: 'Medium' },
  { id: 'HIGH', label: 'High' },
  { id: 'EXTRA_HIGH', label: 'Extra high' },
]
const LLM_MODELS = [
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B Instruct' },
]
const DEFAULT_PROJECT_CRITERIA: LocalProjectCriterion[] = [
  { id: 'acceptance_functional_correctness', key: 'acceptance_functional_correctness', name: 'Acceptance and Functional Correctness', description: 'Score whether the final submission implements the requested behavior, satisfies the task acceptance criteria and Done when requirements, and handles relevant edge cases. Do not award full credit merely because code exists or was produced by AI.', weight: 30, isDefault: true },
  { id: 'verification_regression_safety', key: 'verification_regression_safety', name: 'Verification and Regression Safety', description: 'Score the evidence that the candidate tested or otherwise verified the change, investigated failures, and preserved existing behavior. Penalize missing validation, ignored contracts, regressions, and unsafe migration behavior.', weight: 20, isDefault: true },
  { id: 'technical_reasoning_ai_direction', key: 'technical_reasoning_ai_direction', name: 'Technical Reasoning and AI Direction', description: 'Score how effectively the candidate decomposed the task, gave the AI relevant constraints and context, evaluated its output, corrected mistakes, and used purposeful iterations rather than blindly accepting a generated answer.', weight: 20, isDefault: true },
  { id: 'independent_engineering_contribution', key: 'independent_engineering_contribution', name: 'Independent Engineering Contribution', description: 'Score the candidate\'s own review, edits, decisions, debugging, and meaningful improvements beyond directly accepting AI-generated work. Full credit requires clear evidence of independent engineering judgment.', weight: 15, isDefault: true },
  { id: 'architecture_migration_quality', key: 'architecture_migration_quality', name: 'Architecture and Migration Quality', description: 'Score compatibility with the existing architecture, maintainability, data and configuration safety, migration sequencing, rollback awareness, and whether the solution addresses the root cause without damaging surrounding systems.', weight: 10, isDefault: true },
  { id: 'scope_code_quality', key: 'scope_code_quality', name: 'Scope and Code Quality', description: 'Score whether the changes are focused, clear, reviewable, and free from hard-coded shortcuts, dead code, unnecessary rewrites, formatting churn, and unrelated modifications.', weight: 5, isDefault: true },
]

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-6">
      <h2 className="mb-5 text-sm font-semibold text-[color:var(--text-secondary)] uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  )
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function NewAssessmentPage() {
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    kind: 'CODING',
    timeLimitMinutes: 60,
    language: 'PYTHON',
    llmModel: 'openai/gpt-4o-mini',
    codeWeight: 60,
    aiuWeight: 40,
    aiuMetrics: DEFAULT_METRICS,
    aiuMetricWeights: { ...DEFAULT_WEIGHTS },
    allowCopyPaste: false,
    // Mirrors the server-side kind default (CODING -> DISABLED, PROJECT -> AGENTIC).
    aiAssistantMode: 'DISABLED',
    scoringStrictness: 'MEDIUM',
    screenRecording: 'OFF',
    videoProctoring: 'OFF',
    microphoneRecording: 'OFF',
    secondCamera: 'OFF',
    problems: [],
    templateInfo: '',
    connectionDetails: [],
    submissionFiles: [],
    referenceFiles: [],
    projectScoringCriteria: DEFAULT_PROJECT_CRITERIA,
    solutionFiles: [],
    tasks: [],
  })

  const isProject = form.kind === 'PROJECT'

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const knownLlmModel = LLM_MODELS.some((model) => model.id === form.llmModel)
  const [showProblemBank, setShowProblemBank] = useState(false)
  const [bankSearch, setBankSearch] = useState('')
  const [bankTopic, setBankTopic] = useState('')
  const [bankDifficulty, setBankDifficulty] = useState('')
  const [bankPage, setBankPage] = useState(1)
  const bank = useQuery({
    queryKey: ['problem-bank', bankSearch, bankTopic, bankDifficulty, bankPage],
    queryFn: () => listProblemBank({ search: bankSearch, topic: bankTopic, difficulty: bankDifficulty, page: bankPage }),
    enabled: showProblemBank,
  })

  const [showLibraryProblems, setShowLibraryProblems] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryDifficulty, setLibraryDifficulty] = useState('')
  const [libraryPage, setLibraryPage] = useState(1)
  const library = useQuery({
    queryKey: ['library-problems', librarySearch, libraryDifficulty, libraryPage],
    queryFn: () => listLibraryProblems({ search: librarySearch, difficulty: libraryDifficulty, page: libraryPage }),
    enabled: showLibraryProblems,
  })

  const [showLibraryTasks, setShowLibraryTasks] = useState(false)
  const libraryTasks = useQuery({
    queryKey: ['library-tasks', form.language],
    queryFn: () => listLibraryTasks({ language: form.language }),
    enabled: showLibraryTasks,
  })

  // ── Updaters ────────────────────────────────────────────────────────────────

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleCodeWeightChange(value: number) {
    setForm((f) => ({ ...f, codeWeight: value, aiuWeight: 100 - value }))
  }

  function toggleMetric(metric: AiuMetric, metricKey: string) {
    setForm((f) => {
      const isChecked = f.aiuMetrics.includes(metric)
      const metrics = isChecked
        ? f.aiuMetrics.filter((m) => m !== metric)
        : [...f.aiuMetrics, metric]
      const weights = { ...f.aiuMetricWeights }
      if (isChecked) delete weights[metricKey]
      else weights[metricKey] = 0
      return { ...f, aiuMetrics: metrics, aiuMetricWeights: weights }
    })
  }

  function setMetricWeight(key: string, value: number) {
    setForm((f) => ({ ...f, aiuMetricWeights: { ...f.aiuMetricWeights, [key]: value } }))
  }

  function addProblem() {
    setForm((f) => ({
      ...f,
      problems: [...f.problems, {
          id: crypto.randomUUID(),
          title: '',
          difficulty: 'EASY',
          description: '',
          allowCopyPaste: false,
          showPreview: false,
          testCases: [],
        }],
    }))
  }

  function addBankProblem(problem: ProblemBankEntry) {
    setForm((current) => ({
      ...current,
      problems: [...current.problems, {
        id: crypto.randomUUID(),
        bankId: problem.id,
        topic: problem.topic,
        testCaseCount: problem.test_case_count,
        title: problem.title,
        difficulty: problem.difficulty,
        description: problem.description,
        allowCopyPaste: false,
        showPreview: false,
        testCases: [],
      }],
    }))
    setShowProblemBank(false)
  }

  function addLibraryProblem(problem: LibraryProblemSummary) {
    setForm((current) => ({
      ...current,
      problems: [...current.problems, {
        id: crypto.randomUUID(),
        libraryId: problem.id,
        topic: problem.topic ?? undefined,
        testCaseCount: problem.test_case_count,
        title: problem.title,
        difficulty: problem.difficulty,
        description: problem.description,
        allowCopyPaste: problem.allow_copy_paste,
        showPreview: false,
        testCases: [],
      }],
    }))
    setShowLibraryProblems(false)
  }

  function updateProblem(id: string, updates: Partial<LocalProblem>) {
    setForm((f) => ({
      ...f,
      problems: f.problems.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }))
  }

  function removeProblem(id: string) {
    setForm((f) => ({ ...f, problems: f.problems.filter((p) => p.id !== id) }))
  }

  // ── PROJECT-kind updaters ─────────────────────────────────────────────────────

  function updateTask(id: string, updates: Partial<LocalTask>) {
    setForm((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)) }))
  }
  function removeTask(id: string) {
    setForm((f) => ({ ...f, tasks: f.tasks.filter((t) => t.id !== id) }))
  }

  function addConnectionDetail() {
    setForm((f) => ({
      ...f,
      connectionDetails: [...f.connectionDetails, { id: crypto.randomUUID(), label: '', value: '' }],
    }))
  }
  function updateConnectionDetail(id: string, updates: Partial<LocalConnectionDetail>) {
    setForm((f) => ({
      ...f,
      connectionDetails: f.connectionDetails.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  }
  function removeConnectionDetail(id: string) {
    setForm((f) => ({ ...f, connectionDetails: f.connectionDetails.filter((c) => c.id !== id) }))
  }

  function addSubmissionFile() {
    setForm((f) => ({
      ...f,
      submissionFiles: [...f.submissionFiles, { id: crypto.randomUUID(), name: '', description: '' }],
    }))
  }
  function updateSubmissionFile(id: string, updates: Partial<LocalSubmissionFile>) {
    setForm((f) => ({
      ...f,
      submissionFiles: f.submissionFiles.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }))
  }
  function removeSubmissionFile(id: string) {
    setForm((f) => ({ ...f, submissionFiles: f.submissionFiles.filter((s) => s.id !== id) }))
  }

  function addProjectCriterion() {
    const id = crypto.randomUUID()
    setForm((f) => ({
      ...f,
      projectScoringCriteria: [
        ...f.projectScoringCriteria,
        { id, key: `custom_${id.replace(/-/g, '')}`, name: '', description: '', weight: 0, isDefault: false },
      ],
    }))
  }

  function updateProjectCriterion(id: string, updates: Partial<LocalProjectCriterion>) {
    setForm((f) => ({
      ...f,
      projectScoringCriteria: f.projectScoringCriteria.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  }

  function removeProjectCriterion(id: string) {
    setForm((f) => ({ ...f, projectScoringCriteria: f.projectScoringCriteria.filter((c) => c.id !== id || c.isDefault) }))
  }

  // Merges a library task entry into the form: its reference files are seeded
  // to the candidate workspace, its solution files are stored admin-only for
  // SQS scoring, and a Task is created from its title/description/doneWhen.
  // libraryId is a client-side dedup marker only - not sent to the server,
  // since Task has no separate library-provenance column.
  function addLibraryBankTask(entry: LibraryTaskEntry) {
    setForm((f) => ({
      ...f,
      referenceFiles: [
        ...f.referenceFiles,
        ...entry.files.map((file) => ({
          id: crypto.randomUUID(),
          path: file.path,
          contentBase64: file.contentBase64,
          size: base64Size(file.contentBase64),
        })),
      ],
      solutionFiles: [
        ...f.solutionFiles,
        ...entry.solution_files.map((file) => ({
          id: crypto.randomUUID(),
          path: file.path,
          contentBase64: file.contentBase64,
          size: base64Size(file.contentBase64),
        })),
      ],
      tasks: [
        ...f.tasks,
        {
          id: crypto.randomUUID(),
          title: entry.title,
          description: entry.description,
          doneWhen: entry.done_when,
          showPreview: false,
          difficulty: entry.difficulty,
          libraryId: entry.id,
        },
      ],
    }))
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const activeMetricDefs = AIU_METRIC_DEFS.filter((m) => form.aiuMetrics.includes(m.id))
  const aiuWeightTotal = activeMetricDefs.reduce(
    (sum, m) => sum + (form.aiuMetricWeights[m.key] ?? 0),
    0,
  )
  const aiuWeightValid = activeMetricDefs.length === 0 || aiuWeightTotal === 100
  const projectCriteriaTotal = form.projectScoringCriteria.reduce((sum, c) => sum + c.weight, 0)
  const projectCriteriaValid = projectCriteriaTotal === 100

  // ── Validation ───────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!form.title.trim()) return 'Assessment title is required.'

    if (isProject) {
      if (!projectCriteriaValid) return `Project criteria weights must sum to 100% (currently ${projectCriteriaTotal}%).`
      for (const c of form.projectScoringCriteria) {
        if (!c.name.trim()) return 'All project criteria need a name.'
        if (!c.description.trim()) return 'All project criteria need an evaluation description.'
        if (wordCount(c.description) > 200) return `Criterion "${c.name}" description must be 200 words or fewer.`
      }
      if (form.tasks.length === 0) return 'Add at least one task.'
      for (const t of form.tasks) {
        if (!t.title.trim()) return 'All tasks need a title.'
        if (!t.description.trim()) return 'All tasks need a description.'
        if (t.doneWhen.filter((c) => c.trim()).length === 0)
          return `Task "${t.title || 'Untitled'}" needs at least one "Done when" criterion.`
      }
      for (const c of form.connectionDetails) {
        if (!c.label.trim() || !c.value.trim()) return 'Connection details need both a label and a value.'
      }
      for (const s of form.submissionFiles) {
        if (!s.name.trim()) return 'Submission files need a name.'
      }
      const oversized = form.referenceFiles.find((r) => r.size > MAX_REFERENCE_FILE_BYTES)
      if (oversized) return `Reference file "${oversized.path}" exceeds ${formatBytes(MAX_REFERENCE_FILE_BYTES)}.`
      const totalRef = form.referenceFiles.reduce((sum, r) => sum + r.size, 0)
      if (totalRef > MAX_REFERENCE_TOTAL_BYTES)
        return `Reference files exceed the ${formatBytes(MAX_REFERENCE_TOTAL_BYTES)} total limit.`
      return null
    }

    if (form.aiuMetrics.length === 0) return 'Select at least one AIU metric.'
    if (!aiuWeightValid) return `AIU metric weights must sum to 100 (currently ${aiuWeightTotal}).`

    if (form.problems.length === 0) return 'Add at least one problem or choose one from the bank.'
    for (const p of form.problems) {
      if (p.bankId || p.libraryId) continue
      if (!p.title.trim()) return 'All problems need a title.'
      if (!p.description.trim()) return 'All problems need a description.'
      if (p.testCases.length < 2) return `Problem "${p.title}" needs at least 2 test cases.`
      if (!p.testCases.some((tc) => !tc.isHidden))
        return `Problem "${p.title}" needs at least one visible test case.`
      if (!p.testCases.some((tc) => tc.isHidden))
        return `Problem "${p.title}" needs at least one hidden test case.`
    }
    return null
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSave(publish: boolean) {
    const validationError = validate()
    if (validationError) {
      setSubmitError(validationError)
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const payload = {
        title: form.title,
        ...(form.description ? { description: form.description } : {}),
        kind: form.kind,
        timeLimitMinutes: form.timeLimitMinutes,
        language: form.language,
        llmModel: form.llmModel,
        codeWeight: isProject ? 100 : form.codeWeight,
        aiuWeight: isProject ? 0 : form.aiuWeight,
        aiuMetrics: form.aiuMetrics,
        aiuMetricWeights: Object.fromEntries(
          activeMetricDefs.map((m) => [m.key, form.aiuMetricWeights[m.key] ?? 0]),
        ),
        allowCopyPaste: form.allowCopyPaste,
        aiAssistantMode: form.aiAssistantMode,
        scoringStrictness: form.scoringStrictness,
        screenRecording: form.screenRecording,
        videoProctoring: form.videoProctoring,
        microphoneRecording: form.microphoneRecording,
        secondCamera: form.secondCamera,
        // PROJECT-kind fields - tasks are authored inline (unlike problems).
        ...(isProject && {
          allowedModels: [form.llmModel],
          ...(form.templateInfo.trim() ? { templateInfo: form.templateInfo } : {}),
          connectionDetails: form.connectionDetails.map((c) => ({ label: c.label, value: c.value })),
          submissionFiles: form.submissionFiles.map((s) => ({ name: s.name, description: s.description })),
          referenceFiles: form.referenceFiles.map((r) => ({ path: r.path, contentBase64: r.contentBase64 })),
          projectScoringCriteria: form.projectScoringCriteria.map((c) => ({
            key: c.key,
            name: c.name,
            description: c.description,
            weight: c.weight,
          })),
          solutionFiles: form.solutionFiles.map((r) => ({ path: r.path, contentBase64: r.contentBase64 })),
          tasks: form.tasks.map((t) => ({
            title: t.title,
            description: t.description,
            doneWhen: t.doneWhen.map((c) => c.trim()).filter(Boolean),
            ...(t.difficulty ? { difficulty: t.difficulty } : {}),
            ...(t.bugBankId ? { bugBankId: t.bugBankId } : {}),
          })),
        }),
      }

      const { data: assessment } = await createAssessment(payload)

      // Problems are only for CODING assessments (added after create). PROJECT
      // tasks are created inline with the assessment above.
      if (!isProject) {
        for (const problem of form.problems) {
          if (problem.bankId) {
            await addProblemFromBank(assessment.id, problem.bankId)
          } else if (problem.libraryId) {
            await addProblemFromLibrary(assessment.id, problem.libraryId)
          } else {
            await createProblem(assessment.id, {
            title: problem.title,
            description: problem.description,
            difficulty: problem.difficulty,
            allowCopyPaste: problem.allowCopyPaste,
            testCases: problem.testCases.map((tc) => ({
              input: tc.input,
              expected: tc.expected,
              isHidden: tc.isHidden,
            })),
            })
          }
        }
      }

      if (publish) {
        await updateAssessment(assessment.id, { status: 'ACTIVE' })
      }

      navigate(`/assessments/${assessment.id}`)
    } catch (err) {
      setSubmitError(
        err instanceof ApiException ? err.message : 'Failed to create assessment. Try again.',
      )
      setSubmitting(false)
    }
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center gap-3">
        <Link to="/assessments" className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
          ← Assessments
        </Link>
        <span className="text-[color:var(--text-secondary)]">/</span>
        <h1 className="text-xl font-bold text-[color:var(--text-primary)]">New Assessment</h1>
      </div>

      <div className="max-w-3xl space-y-6">

        {/* ── Type ─────────────────────────────────────────────────── */}
        <Section title="Assessment Type">
          <div className="grid grid-cols-2 gap-4">
            {([
              { id: 'CODING', label: 'Coding', desc: 'LeetCode-style problems with hidden/visible test cases, auto-scored.' },
              { id: 'PROJECT', label: 'Project / Migration', desc: 'Open-ended tasks with "Done when" criteria, a provided template & models, and a submission spec.' },
            ] as const).map((opt) => {
              const active = form.kind === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setField('kind', opt.id)
                    setField('aiAssistantMode', opt.id === 'PROJECT' ? 'AGENTIC' : 'DISABLED')
                  }}
                  className={`rounded-lg border-2 p-4 text-left transition-colors ${active ? 'border-[color:var(--signal-violet)] bg-[color:var(--bg-inset)]' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] hover:border-[color:var(--border-strong)]'}`}
                  aria-pressed={active}
                >
                  <span className="block text-sm font-semibold text-[color:var(--text-primary)]">{opt.label}</span>
                  <span className="mt-1 block text-xs text-[color:var(--text-muted)]">{opt.desc}</span>
                </button>
              )
            })}
          </div>
        </Section>

        {/* ── Basic info ───────────────────────────────────────────── */}
        <Section title="Assessment Info">
          <div className="space-y-4">
            <Field label="Title *">
              <input
                type="text"
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                className={inputCls}
                placeholder="e.g. Software Engineer - Stage 1"
              />
            </Field>
            <Field label="Description (optional)">
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                className={`${inputCls} resize-y`}
                placeholder="Internal notes about this assessment batch…"
              />
            </Field>
          </div>
        </Section>

        {/* ── Configuration ────────────────────────────────────────── */}
        <Section title="Proctoring">
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['screenRecording', 'Screen recording'],
              ['videoProctoring', 'Webcam recording'],
              ['microphoneRecording', 'Microphone recording'],
              ['secondCamera', 'Second camera'],
            ] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <select
                  value={form[key]}
                  onChange={(e) => setField(key, e.target.value as ProctoringMode)}
                  className={selectCls}
                >
                  <option value="OFF">Off</option>
                  <option value="OPTIONAL">Optional</option>
                  <option value="REQUIRED">Required</option>
                </select>
              </Field>
            ))}
          </div>
        </Section>

        {/* ── Editor ───────────────────────────────────────────────── */}
        <Section title="Editor">
          <label className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
            <input
              type="checkbox"
              checked={form.allowCopyPaste}
              onChange={(e) => setField('allowCopyPaste', e.target.checked)}
              className="h-4 w-4 rounded border-[color:var(--border-strong)]"
            />
            Allow copy &amp; paste in the code editor
          </label>
          <p className="mt-2 text-xs text-[color:var(--text-muted)]">
            Applies to every candidate in this assessment (coding and project). Off by default for integrity.
          </p>
        </Section>

        <Section title="Configuration">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Time limit (minutes)">
              <input
                type="number"
                min={1}
                max={480}
                value={form.timeLimitMinutes}
                onChange={(e) => setField('timeLimitMinutes', Math.max(1, Number(e.target.value)))}
                className={inputCls}
              />
            </Field>
            <Field label="Language">
              <select
                value={form.language}
                onChange={(e) => setField('language', e.target.value as Language)}
                className={selectCls}
              >
                <option value="PYTHON">Python</option>
                <option value="JAVASCRIPT">JavaScript</option>
                <option value="TYPESCRIPT">TypeScript</option>
              </select>
            </Field>
            <Field label="LLM model">
              <select
                value={knownLlmModel ? form.llmModel : 'CUSTOM'}
                onChange={(e) => setField('llmModel', e.target.value === 'CUSTOM' ? '' : e.target.value)}
                className={selectCls}
              >
                {LLM_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>{model.label} - {model.id}</option>
                ))}
                <option value="CUSTOM">Custom OpenRouter model...</option>
              </select>
              {!knownLlmModel && (
                <input
                  type="text"
                  value={form.llmModel}
                  onChange={(e) => setField('llmModel', e.target.value)}
                  className={`${inputCls} mt-2`}
                  placeholder="provider/model-name"
                />
              )}
              <p className="mt-2 text-xs text-[color:var(--text-muted)]">OpenRouter model used for AI judging and assistant features</p>
            </Field>
            {isProject && (
              <Field label="AI assistant mode">
                <select
                  value={form.aiAssistantMode}
                  onChange={(e) => setField('aiAssistantMode', e.target.value as AiAssistantMode)}
                  className={selectCls}
                >
                  <option value="AGENTIC">Agentic</option>
                  <option value="NON_AGENTIC">Non-Agentic</option>
                  <option value="DISABLED">Disabled</option>
                </select>
                <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                  Agentic and Non-Agentic modes are available for project/migration assessments and are used by the evaluation.
                </p>
              </Field>
            )}
            {isProject && (
              <Field label="Scoring strictness">
                <select
                  value={form.scoringStrictness}
                  onChange={(e) => setField('scoringStrictness', e.target.value as ScoringStrictness)}
                  className={selectCls}
                >
                  {STRICTNESS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[color:var(--text-muted)]">How strictly project submissions are graded</p>
              </Field>
            )}
          </div>
        </Section>

        {/* ── Score weights ─────────────────────────────────────────── */}
        {!isProject && <Section title="Score Weights">
          <p className="mb-4 text-xs text-[color:var(--text-muted)]">
            Code correctness and AI usage scores are combined using these weights. They must sum
            to 100%.
          </p>
          <div className="space-y-4">
            {/* Code weight slider */}
            <div>
              <div className="mb-1.5 flex justify-between text-xs text-[color:var(--text-secondary)]">
                <span>Code Correctness</span>
                <span className="font-semibold text-[color:var(--text-primary)]">{form.codeWeight}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={form.codeWeight}
                onChange={(e) => handleCodeWeightChange(Number(e.target.value))}
                className="w-full accent-[color:var(--signal-green)]"
              />
            </div>
            {/* AIU weight (auto) */}
            <div>
              <div className="mb-1.5 flex justify-between text-xs text-[color:var(--text-secondary)]">
                <span>Technical Evaluation</span>
                <span className="font-semibold text-[color:var(--text-primary)]">{form.aiuWeight}%</span>
              </div>
              <div className="h-2 rounded-full bg-[color:var(--bg-overlay)]">
                <div
                  className="h-2 rounded-full bg-[color:var(--signal-violet)]"
                  style={{ width: `${form.aiuWeight}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-[color:var(--text-secondary)]">Automatically set to {100 - form.codeWeight}%</p>
            </div>
          </div>
        </Section>}

        {/* ── AIU metrics ───────────────────────────────────────────── */}
        {!isProject && <Section title="Technical Evaluation Criteria">
          <p className="mb-4 text-xs text-[color:var(--text-muted)]">
            Correctness, Efficiency, Robustness, and Code Quality are evaluated deterministically and weighted equally.
          </p>
          <div className="space-y-3">
            {AIU_METRIC_DEFS.map((m) => {
              const isChecked = form.aiuMetrics.includes(m.id)
              return (
                <div
                  key={m.id}
                  className={`rounded-lg border p-4 transition-colors ${isChecked ? 'border-[color:var(--signal-violet)] bg-[color:var(--bg-inset)]' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)]'}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={m.id}
                      checked={isChecked}
                      disabled
                      onChange={() => toggleMetric(m.id, m.key)}
                      className="mt-0.5 h-4 w-4 rounded border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] accent-[color:var(--signal-violet)]"
                    />
                    <label htmlFor={m.id} className="flex-1 cursor-pointer">
                      <span className="text-sm font-medium text-[color:var(--text-primary)]">{m.label}</span>
                      <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{m.description}</p>
                    </label>
                    {isChecked && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={form.aiuMetricWeights[m.key] ?? 0}
                          disabled
                          onChange={(e) => setMetricWeight(m.key, Number(e.target.value))}
                          className="w-16 rounded border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-2 py-1 text-right text-sm text-[color:var(--text-primary)] focus:border-[color:var(--signal-violet)] focus:outline-none"
                        />
                        <span className="text-xs text-[color:var(--text-muted)]">%</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {activeMetricDefs.length > 0 && (
            <div className={`mt-3 rounded-lg px-4 py-2.5 text-sm font-medium ${aiuWeightValid ? 'bg-[color:var(--signal-green-dim)] text-[color:var(--signal-green)]' : 'bg-[color:var(--status-warn-dim)] text-[color:var(--status-warn)]'}`}>
              Metric weights total: {aiuWeightTotal}% {aiuWeightValid ? '✓' : `(need 100%)`}
            </div>
          )}
        </Section>}

        {/* ── Problems (CODING only) ───────────────────────────────── */}
        {!isProject && (
          <Section title="Problems">
            <div className="space-y-6">
              {form.problems.map((p, i) => (
                p.bankId || p.libraryId ? (
                  <div key={p.id} className="border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div><p className="text-sm font-semibold">{i + 1}. {p.title}</p><p className="mt-1 text-xs text-[color:var(--text-muted)]">{p.libraryId ? 'My library' : 'Problem bank'} · {p.topic} · {p.difficulty} · {p.testCaseCount} tests</p></div>
                      <button type="button" onClick={() => removeProblem(p.id)} className="text-xs text-[color:var(--status-fail)]">Remove</button>
                    </div>
                  </div>
                ) : (
                  <ProblemEditor key={p.id} problem={p} index={i} onChange={(updates) => updateProblem(p.id, updates)} onRemove={() => removeProblem(p.id)} />
                )
              ))}
              {!showProblemBank && !showLibraryProblems && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <button type="button" onClick={() => setShowProblemBank(true)} className="border border-[color:var(--border-strong)] py-4 text-sm font-semibold">Choose from 500 problems</button>
                  <button type="button" onClick={() => setShowLibraryProblems(true)} className="border border-[color:var(--border-strong)] py-4 text-sm font-semibold">Choose from my library</button>
                  <button type="button" onClick={addProblem} className="bg-[color:var(--text-primary)] py-4 text-sm font-semibold text-[color:var(--bg-canvas)]">Add Problem manually</button>
                </div>
              )}
              {showProblemBank && (
                <div className="overflow-hidden border border-[color:var(--border-strong)]">
                  <div className="grid gap-3 border-b border-[color:var(--border-subtle)] p-3 md:grid-cols-[1fr_160px_130px]"><input value={bankSearch} onChange={(e) => { setBankSearch(e.target.value); setBankPage(1) }} placeholder="Search 500 problems" className={inputCls}/><select value={bankTopic} onChange={(e) => { setBankTopic(e.target.value); setBankPage(1) }} className={selectCls}><option value="">All topics</option>{bank.data?.topics.map((topic) => <option key={topic}>{topic}</option>)}</select><select value={bankDifficulty} onChange={(e) => { setBankDifficulty(e.target.value); setBankPage(1) }} className={selectCls}><option value="">All levels</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select></div>
                  <div className="max-h-80 divide-y divide-[color:var(--border-subtle)] overflow-y-auto">{bank.isLoading ? <p className="p-4 text-sm text-[color:var(--text-muted)]">Loading...</p> : bank.data?.data.map((problem) => { const alreadyAdded = form.problems.some((item) => item.bankId === problem.id); return <button key={problem.id} type="button" disabled={alreadyAdded} onClick={() => addBankProblem(problem)} className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-[color:var(--bg-overlay)] disabled:cursor-not-allowed disabled:opacity-45"><div><p className="text-sm font-medium">{problem.title}</p><p className="text-xs text-[color:var(--text-muted)]">{problem.topic} · {problem.test_case_count} tests</p></div><span className="text-xs text-[color:var(--text-muted)]">{alreadyAdded ? 'Added' : problem.difficulty}</span></button> })}</div>
                  <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] p-3 text-xs"><button type="button" onClick={() => setShowProblemBank(false)}>Cancel</button><div className="flex items-center gap-3"><button type="button" disabled={bankPage <= 1} onClick={() => setBankPage((page) => page - 1)} className="disabled:opacity-40">Previous</button><span>{bankPage} / {bank.data?.pages ?? 1}</span><button type="button" disabled={bankPage >= (bank.data?.pages ?? 1)} onClick={() => setBankPage((page) => page + 1)} className="disabled:opacity-40">Next</button></div></div>
                </div>
              )}
              {showLibraryProblems && (
                <div className="overflow-hidden border border-[color:var(--border-strong)]">
                  <div className="grid gap-3 border-b border-[color:var(--border-subtle)] p-3 md:grid-cols-[1fr_130px]"><input value={librarySearch} onChange={(e) => { setLibrarySearch(e.target.value); setLibraryPage(1) }} placeholder="Search my library" className={inputCls}/><select value={libraryDifficulty} onChange={(e) => { setLibraryDifficulty(e.target.value); setLibraryPage(1) }} className={selectCls}><option value="">All levels</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select></div>
                  <div className="max-h-80 divide-y divide-[color:var(--border-subtle)] overflow-y-auto">
                    {library.isLoading ? <p className="p-4 text-sm text-[color:var(--text-muted)]">Loading...</p> : library.data?.data.map((problem) => { const alreadyAdded = form.problems.some((item) => item.libraryId === problem.id); return <button key={problem.id} type="button" disabled={alreadyAdded} onClick={() => addLibraryProblem(problem)} className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-[color:var(--bg-overlay)] disabled:cursor-not-allowed disabled:opacity-45"><div><p className="text-sm font-medium">{problem.title}</p><p className="text-xs text-[color:var(--text-muted)]">{problem.topic ?? 'No topic'} · {problem.test_case_count} tests</p></div><span className="text-xs text-[color:var(--text-muted)]">{alreadyAdded ? 'Added' : problem.difficulty}</span></button> })}
                    {!library.isLoading && library.data?.data.length === 0 && <p className="p-4 text-sm text-[color:var(--text-muted)]">No library problems yet - add some from the Library tab.</p>}
                  </div>
                  <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] p-3 text-xs"><button type="button" onClick={() => setShowLibraryProblems(false)}>Cancel</button><div className="flex items-center gap-3"><button type="button" disabled={libraryPage <= 1} onClick={() => setLibraryPage((page) => page - 1)} className="disabled:opacity-40">Previous</button><span>{libraryPage} / {library.data?.pages ?? 1}</span><button type="button" disabled={libraryPage >= (library.data?.pages ?? 1)} onClick={() => setLibraryPage((page) => page + 1)} className="disabled:opacity-40">Next</button></div></div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── PROJECT-kind sections ────────────────────────────────── */}
        {isProject && (
          <>
            <Section title="Project Scoring Criteria">
              <p className="mb-4 text-xs text-[color:var(--text-muted)]">
                Criteria weights must total 100%. Default criteria cannot be removed; set their weight to 0% if unused.
              </p>
              <p className="mb-4 text-xs text-[color:var(--text-muted)]">
                To keep scoring fair for all candidates, use one model and one strictness level for the assessment; do not change them after candidates are invited.
              </p>
              <div className="space-y-3">
                {form.projectScoringCriteria.map((c) => (
                  <div key={c.id} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_90px]">
                      <input
                        type="text"
                        value={c.name}
                        disabled={c.isDefault}
                        onChange={(e) => updateProjectCriterion(c.id, { name: e.target.value })}
                        className={inputCls}
                        placeholder="Criteria name"
                      />
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={c.weight}
                          onChange={(e) => updateProjectCriterion(c.id, { weight: Number(e.target.value) })}
                          className="w-16 rounded border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-2 py-2 text-right text-sm text-[color:var(--text-primary)] focus:border-[color:var(--signal-violet)] focus:outline-none"
                        />
                        <span className="text-xs text-[color:var(--text-muted)]">%</span>
                      </div>
                    </div>
                    {c.isDefault ? (
                      <p className="mt-3 rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] px-3 py-2 text-sm leading-6 text-[color:var(--text-secondary)]">
                        {c.description}
                      </p>
                    ) : (
                      <textarea
                        rows={3}
                        value={c.description}
                        onChange={(e) => updateProjectCriterion(c.id, { description: e.target.value })}
                        className={`${inputCls} mt-3 resize-y`}
                        placeholder="How you want to evaluate this criterion. This becomes part of the LLM grading prompt."
                      />
                    )}
                    <div className="mt-2 flex items-center justify-between text-xs text-[color:var(--text-muted)]">
                      <span>{wordCount(c.description)} / 200 words</span>
                      {!c.isDefault && (
                        <button type="button" onClick={() => removeProjectCriterion(c.id)} className="text-[color:var(--status-fail)]">
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className={`mt-3 rounded-lg px-4 py-2.5 text-sm font-medium ${projectCriteriaValid ? 'bg-[color:var(--signal-green-dim)] text-[color:var(--signal-green)]' : 'bg-[color:var(--status-warn-dim)] text-[color:var(--status-warn)]'}`}>
                Criteria weights total: {projectCriteriaTotal}% {projectCriteriaValid ? 'OK' : '(need 100%)'}
              </div>
              <button type="button" onClick={addProjectCriterion} className="mt-3 flex items-center gap-1.5 text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add criterion
              </button>
            </Section>

            {/* Provided template */}
            <Section title="Provided Template">
              <div className="space-y-4">
                <Field label="Template / provided info (Markdown)" hint="Describe the template repo and any provided keys (do not paste real secrets).">
                  <textarea
                    rows={4}
                    value={form.templateInfo}
                    onChange={(e) => setField('templateInfo', e.target.value)}
                    className={`${inputCls} resize-y font-mono`}
                    placeholder="The submission template includes a .env.setup with an OpenRouter API key…"
                  />
                </Field>
              </div>
            </Section>

            {/* Connection details */}
            <Section title="Connection Details">
              <p className="mb-4 text-xs text-[color:var(--text-muted)]">
                Optional key/value pairs shown to candidates (e.g. API_BASE_URL, CLIENT_ID).
              </p>
              <div className="space-y-3">
                {form.connectionDetails.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) => updateConnectionDetail(c.id, { label: e.target.value })}
                      className={`${inputCls} font-mono`}
                      placeholder="API_BASE_URL"
                    />
                    <input
                      type="text"
                      value={c.value}
                      onChange={(e) => updateConnectionDetail(c.id, { value: e.target.value })}
                      className={`${inputCls} font-mono`}
                      placeholder="http://assessment.example.com"
                    />
                    <button type="button" onClick={() => removeConnectionDetail(c.id)} className="shrink-0 text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addConnectionDetail} className="mt-3 flex items-center gap-1.5 text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add connection detail
              </button>
            </Section>

            {/* Tasks */}
            <Section title="Tasks">
              <div className="space-y-6">
                {form.tasks.map((t, i) => (
                  <TaskEditor
                    key={t.id}
                    task={t}
                    index={i}
                    onChange={(updates) => updateTask(t.id, updates)}
                    onRemove={() => removeTask(t.id)}
                  />
                ))}
                {!showLibraryTasks ? (
                  <button
                    type="button"
                    onClick={() => setShowLibraryTasks(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[color:var(--border-strong)] py-4 text-sm text-[color:var(--text-muted)] transition-colors hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-secondary)]"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Choose from Library
                  </button>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-[color:var(--border-strong)]">
                    <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-3 py-2">
                      <span className="text-xs text-[color:var(--text-muted)]">
                        {libraryTasks.data?.data.length ?? 0} library tasks for {form.language}
                      </span>
                      <button type="button" onClick={() => setShowLibraryTasks(false)} className="text-xs text-[color:var(--text-muted)]">
                        Close
                      </button>
                    </div>
                    <div className="max-h-96 divide-y divide-[color:var(--border-subtle)] overflow-y-auto">
                      {libraryTasks.isLoading && <p className="p-4 text-sm text-[color:var(--text-muted)]">Loading…</p>}
                      {libraryTasks.data?.data.map((entry) => {
                        const alreadyAdded = form.tasks.some((t) => t.libraryId === entry.id)
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => addLibraryBankTask(entry)}
                            className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-[color:var(--bg-overlay)] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{entry.title}</p>
                              <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">
                                {entry.files.length} file{entry.files.length === 1 ? '' : 's'}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs text-[color:var(--text-muted)]">
                              {alreadyAdded ? 'Added' : entry.difficulty}
                            </span>
                          </button>
                        )
                      })}
                      {!libraryTasks.isLoading && libraryTasks.data?.data.length === 0 && (
                        <p className="p-4 text-sm text-[color:var(--text-muted)]">
                          No library tasks for {form.language} yet - add some from the Library tab.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {/* Submission requirements */}
            <Section title="Submission Requirements">
              <p className="mb-4 text-xs text-[color:var(--text-muted)]">
                Files the candidate must include in their submission (name + what it is).
              </p>
              <div className="space-y-3">
                {form.submissionFiles.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={s.name}
                      onChange={(e) => updateSubmissionFile(s.id, { name: e.target.value })}
                      className={`${inputCls} w-1/3 font-mono`}
                      placeholder="design-decision.md"
                    />
                    <input
                      type="text"
                      value={s.description}
                      onChange={(e) => updateSubmissionFile(s.id, { description: e.target.value })}
                      className={inputCls}
                      placeholder="2-3 paragraphs: the approach you chose, and why"
                    />
                    <button type="button" onClick={() => removeSubmissionFile(s.id)} className="shrink-0 text-xs text-[color:var(--status-fail)] hover:text-[color:var(--status-fail)]">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addSubmissionFile} className="mt-3 flex items-center gap-1.5 text-xs text-[color:var(--status-link)] hover:text-[color:var(--status-link)]">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add submission file
              </button>
            </Section>
          </>
        )}

        {/* ── Submit bar ────────────────────────────────────────────── */}
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] px-6 py-4">
          {submitError && (
            <div className="mb-4 rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
              {submitError}
            </div>
          )}
          <div className="flex items-center justify-between">
            <Link to="/assessments" className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
              Cancel
            </Link>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSave(false)}
                className="rounded-lg border border-[color:var(--border-strong)] px-5 py-2 text-sm font-medium text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--bg-overlay)] disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save as Draft'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSave(true)}
                className="rounded-lg bg-[color:var(--text-primary)] px-5 py-2 text-sm font-semibold text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
