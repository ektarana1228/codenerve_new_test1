import { z } from 'zod'
import { callJudge } from './llmJudgeClient'
import { decodeReferenceFiles, filesForTask, parseWorkspaceFiles } from './multifile'

export type ProjectTaskLike = {
  id: string
  title: string
  description: string
  doneWhen: unknown
  difficulty: string | null
  bugBankId: string | null
}

export type ProjectScoringCriterion = {
  key: string
  name: string
  description: string
  weight: number
}

export type ScoringStrictness = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH'

export const DEFAULT_PROJECT_CRITERIA: ProjectScoringCriterion[] = [
  {
    key: 'acceptance_functional_correctness',
    name: 'Acceptance and Functional Correctness',
    description: 'Score whether the final submission implements the requested behavior, satisfies the task acceptance criteria and Done when requirements, and handles relevant edge cases. Do not award full credit merely because code exists or was produced by AI.',
    weight: 30,
  },
  {
    key: 'verification_regression_safety',
    name: 'Verification and Regression Safety',
    description: 'Score the evidence that the candidate tested or otherwise verified the change, investigated failures, and preserved existing behavior. Penalize missing validation, ignored contracts, regressions, and unsafe migration behavior.',
    weight: 20,
  },
  {
    key: 'technical_reasoning_ai_direction',
    name: 'Technical Reasoning and AI Direction',
    description: 'Score how effectively the candidate decomposed the task, gave the AI relevant constraints and context, evaluated its output, corrected mistakes, and used purposeful iterations rather than blindly accepting a generated answer.',
    weight: 20,
  },
  {
    key: 'independent_engineering_contribution',
    name: 'Independent Engineering Contribution',
    description: 'Score the candidate\'s own review, edits, decisions, debugging, and meaningful improvements beyond directly accepting AI-generated work. Full credit requires clear evidence of independent engineering judgment.',
    weight: 15,
  },
  {
    key: 'architecture_migration_quality',
    name: 'Architecture and Migration Quality',
    description: 'Score compatibility with the existing architecture, maintainability, data and configuration safety, migration sequencing, rollback awareness, and whether the solution addresses the root cause without damaging surrounding systems.',
    weight: 10,
  },
  {
    key: 'scope_code_quality',
    name: 'Scope and Code Quality',
    description: 'Score whether the changes are focused, clear, reviewable, and free from hard-coded shortcuts, dead code, unnecessary rewrites, formatting churn, and unrelated modifications.',
    weight: 5,
  },
]

const DEFAULT_CRITERIA_BY_KEY = new Map(DEFAULT_PROJECT_CRITERIA.map((criterion) => [criterion.key, criterion]))

export type TaskScore = {
  taskId: string
  difficulty: string
  difficultyWeight: number
  acceptanceFunctionalCorrectness: number
  verificationRegressionSafety: number
  technicalReasoningAiDirection: number
  independentEngineeringContribution: number
  architectureMigrationQuality: number
  scopeCodeQuality: number
  criteriaScores: Array<{
    key: string
    name: string
    evidenceLevel: number
    score: number
    weight: number
    weightedContribution: number
  }>
  rationale: string
  evidenceReferences: string[]
  missingRequirements: string[]
  baseScore: number
  appliedCaps: Array<{ reason: string; cap: number }>
  finalScore: number
  weightedTotal: number
}

export type ProjectScoreResult = {
  codeCorrectnessScore: number
  projectScores: {
    tasks: TaskScore[]
    evidence: ProjectEvidence
    aggregation: {
      totalDifficultyWeight: number
      weightedScoreSum: number
      finalProjectScore: number
    }
  }
}

export type ProjectInteractionLike = {
  turnNumber: number
  activeFile: string | null
  promptText: string
  responseText: string
  aiEdits: unknown
}

export type ProjectRunEventLike = {
  status: string
  passed: number
  failed: number
}

export type ProjectEvidence = {
  requiredSubmissionFiles: Array<{ name: string; description: string }>
  fileChanges: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged' }>
  aiInteractionCount: number
  aiEditedFiles: string[]
  filesChangedAfterAi: string[]
  verificationEvents: Array<{ status: string; passed: number; failed: number }>
  prechecks: {
    missingRequiredFiles: string[]
    hasMeaningfulChange: boolean
    changedFileCount: number
    acceptanceCriteriaCount: number
    hasVerificationEvidence: boolean
    candidateTestFiles: string[]
    exactReferenceMatches: string[]
    assistantUnavailableCount: number
    assistantEvidenceState: 'AVAILABLE' | 'PLATFORM_UNAVAILABLE' | 'NOT_USED'
  }
}

const MAX_FILE_CHARS = 4000

const CriterionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().min(0).max(100),
})

const JudgeTaskResultSchema = z.object({
  task_id: z.string(),
  evidence_levels: z.record(z.string(), z.number().int().min(0).max(4)),
  rationale: z.string().max(2000),
  evidence_references: z.array(z.string().min(1).max(500)).max(30),
  missing_requirements: z.array(z.string().min(1).max(500)).max(30),
  critical_failures: z.array(z.enum([
    'FUNCTIONAL_BROKEN',
    'SECURITY_OR_DESTRUCTIVE_REGRESSION',
    'HARD_CODED_SOLUTION',
  ])).max(3),
})

const JudgeResponseSchema = z.object({
  tasks: z.array(JudgeTaskResultSchema),
})

function truncate(text: string): string {
  return text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n... (truncated)` : text
}

function formatFiles(files: Record<string, string>): string {
  const entries = Object.entries(files)
  if (entries.length === 0) return '(no files)'
  return entries.map(([path, content]) => `--- ${path} ---\n${truncate(content)}`).join('\n\n')
}

function parseAiEditFiles(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const edits: Record<string, string> = {}
  for (const [path, edit] of Object.entries(value as Record<string, unknown>)) {
    if (typeof edit === 'string') edits[path] = edit
    else if (edit && typeof edit === 'object' && typeof (edit as { after?: unknown }).after === 'string') {
      edits[path] = (edit as { after: string }).after
    }
  }
  return edits
}

function parseSubmissionFiles(value: unknown): Array<{ name: string; description: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { name, description } = item as { name?: unknown; description?: unknown }
    return typeof name === 'string'
      ? [{ name, description: typeof description === 'string' ? description : '' }]
      : []
  })
}

export function buildProjectEvidence(params: {
  candidateFiles: Record<string, string>
  starterFiles: Record<string, string>
  solutionFiles?: Record<string, string>
  tasks?: ProjectTaskLike[]
  submissionFilesRaw?: unknown
  interactions?: ProjectInteractionLike[]
  runEvents?: ProjectRunEventLike[]
  assistantUnavailableCount?: number
}): ProjectEvidence {
  const paths = [...new Set([...Object.keys(params.starterFiles), ...Object.keys(params.candidateFiles)])].sort()
  const fileChanges = paths.map((path) => ({
    path,
    status: !(path in params.starterFiles)
      ? 'added' as const
      : !(path in params.candidateFiles)
        ? 'deleted' as const
        : params.starterFiles[path] === params.candidateFiles[path]
          ? 'unchanged' as const
          : 'modified' as const,
  }))

  const lastAiEditByFile = new Map<string, string>()
  for (const interaction of params.interactions ?? []) {
    for (const [path, content] of Object.entries(parseAiEditFiles(interaction.aiEdits))) {
      lastAiEditByFile.set(path, content)
    }
  }

  const requiredSubmissionFiles = parseSubmissionFiles(params.submissionFilesRaw)
  const changedFiles = fileChanges.filter((file) => file.status !== 'unchanged')
  const candidateTestFiles = Object.keys(params.candidateFiles)
    .filter((path) => /(^|\/)(__tests__\/|tests?\/)|(^|\/)[^/]+\.(test|spec)\.[^/]+$/i.test(path))
    .sort()
  const exactReferenceMatches = Object.entries(params.solutionFiles ?? {})
    .filter(([path, solution]) => solution.trim().length > 0 && params.candidateFiles[path]?.trim() === solution.trim())
    .map(([path]) => path)
    .sort()
  const verificationEvents = (params.runEvents ?? []).map((event) => ({
    status: event.status,
    passed: event.passed,
    failed: event.failed,
  }))

  return {
    requiredSubmissionFiles,
    fileChanges,
    aiInteractionCount: params.interactions?.length ?? 0,
    aiEditedFiles: [...lastAiEditByFile.keys()].sort(),
    filesChangedAfterAi: [...lastAiEditByFile.entries()]
      .filter(([path, aiContent]) => params.candidateFiles[path] !== undefined && params.candidateFiles[path] !== aiContent)
      .map(([path]) => path)
      .sort(),
    verificationEvents,
    prechecks: {
      missingRequiredFiles: requiredSubmissionFiles
        .filter((file) => !(file.name in params.candidateFiles))
        .map((file) => file.name)
        .sort(),
      hasMeaningfulChange: changedFiles.length > 0,
      changedFileCount: changedFiles.length,
      acceptanceCriteriaCount: (params.tasks ?? []).reduce((sum, task) => sum + doneWhenList(task.doneWhen).length, 0),
      hasVerificationEvidence: verificationEvents.length > 0 || candidateTestFiles.length > 0,
      candidateTestFiles,
      exactReferenceMatches,
      assistantUnavailableCount: params.assistantUnavailableCount ?? 0,
      assistantEvidenceState: (params.assistantUnavailableCount ?? 0) > 0
        ? 'PLATFORM_UNAVAILABLE'
        : (params.interactions?.length ?? 0) > 0
          ? 'AVAILABLE'
          : 'NOT_USED',
    },
  }
}

function formatInteractionEvidence(interactions: ProjectInteractionLike[]): string {
  if (interactions.length === 0) return '(no AI interactions recorded)'
  return interactions.map((interaction) => {
    const editedFiles = Object.keys(parseAiEditFiles(interaction.aiEdits))
    return [
      `Turn ${interaction.turnNumber}${interaction.activeFile ? ` (active file: ${interaction.activeFile})` : ''}`,
      `Candidate prompt: ${truncate(interaction.promptText)}`,
      `Assistant response: ${truncate(interaction.responseText)}`,
      `AI-edited files: ${editedFiles.join(', ') || '(none)'}`,
    ].join('\n')
  }).join('\n\n')
}

function doneWhenList(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : []
}

function strictnessInstruction(strictness: ScoringStrictness): string {
  if (strictness === 'LOW') return 'Strictness: LOW. Award generous partial credit for substantially correct behavior, minor omissions, or equivalent implementations.'
  if (strictness === 'HIGH') return 'Strictness: HIGH. Penalize incomplete edge cases, loose alignment, broad changes, and unclear evidence; high scores require strong task satisfaction.'
  if (strictness === 'EXTRA_HIGH') return 'Strictness: EXTRA_HIGH. Grade very strictly. Award 95-100 only when the final code is correct, complete, narrowly scoped, and closely aligned with the reference intent.'
  return 'Strictness: MEDIUM. Use balanced professional grading with fair partial credit and clear penalties for missing behavior.'
}

function buildSystemPrompt(criteria: ProjectScoringCriterion[], strictness: ScoringStrictness): string {
  const keys = criteria.map((c) => c.key)
  return [
    'You are a strict but fair code review grader for a project/migration assessment.',
    strictnessInstruction(strictness),
    'For each task you are given the original provided files, the "Done when" acceptance criteria,',
    'the candidate final files, and a reference solution written by the assessment author.',
    'The reference is a grading aid, not the only valid answer.',
    '',
    'Assign an evidence level from 0-4 for each configured criterion:',
    ...criteria.map((c) => `- ${c.key}: ${c.name}. ${c.description}`),
    'Evidence anchors: 0=no implementation evidence; 1=weak/superficial; 2=partial; 3=strong but incomplete; 4=complete, specific, verified evidence.',
    '',
    'For every score, the rationale must cite the specific file, function, line, or behavior',
    'that changed or failed to change. No vague or generic justifications.',
    'List the concrete file paths, functions, tests, commands, or interaction turns used as evidence',
    'in evidence_references. List every unsatisfied Done when item in missing_requirements.',
    'Use critical_failures only for demonstrated failures: FUNCTIONAL_BROKEN,',
    'SECURITY_OR_DESTRUCTIVE_REGRESSION, or HARD_CODED_SOLUTION. Otherwise return an empty array.',
    'Be deterministic: for the same task files, candidate files, reference files, and criteria,',
    'use the same scoring standard and keep score drift within 5 points unless the inputs changed.',
    'Do not reward intent, comments, or explanations unless the final code implements the behavior.',
    '',
    'Respond with ONLY a JSON object of this exact shape, no markdown code fences, no prose:',
    `{"tasks":[{"task_id":"...","evidence_levels":{${keys.map((key) => `"${key}":0`).join(',')}},"rationale":"...","evidence_references":["path or behavior"],"missing_requirements":["unmet requirement"],"critical_failures":[]}]}`,
  ].join('\n')
}

function buildUserPrompt(
  tasks: ProjectTaskLike[],
  candidateFiles: Record<string, string>,
  buggyFiles: Record<string, string>,
  solutionFiles: Record<string, string>,
  evidence: ProjectEvidence,
  interactions: ProjectInteractionLike[],
): string {
  const sharedEvidence = [
    '## Submission evidence',
    `Required submission files: ${evidence.requiredSubmissionFiles.map((file) => `${file.name}${file.description ? ` (${file.description})` : ''}`).join(', ') || '(none configured)'}`,
    `File changes from starter: ${evidence.fileChanges.map((file) => `${file.path}=${file.status}`).join(', ') || '(no files)'}`,
    `Files edited by AI: ${evidence.aiEditedFiles.join(', ') || '(none)'}`,
    `Files changed by the candidate after the last recorded AI edit: ${evidence.filesChangedAfterAi.join(', ') || '(none)'}`,
    `Verification events: ${evidence.verificationEvents.map((event) => `${event.status} (${event.passed} passed, ${event.failed} failed)`).join(', ') || '(none recorded)'}`,
    `Deterministic prechecks: ${JSON.stringify(evidence.prechecks)}`,
  ].join('\n')

  const taskEvidence = tasks
    .map((task, i) => {
      const scopedCandidate = filesForTask(candidateFiles, task.bugBankId)
      const scopedBuggy = filesForTask(buggyFiles, task.bugBankId)
      const scopedSolution = filesForTask(solutionFiles, task.bugBankId)
      const prefix = task.bugBankId ? `${task.bugBankId}/` : null
      const scopedInteractions = prefix
        ? interactions.filter((interaction) => {
            if (interaction.activeFile?.startsWith(prefix)) return true
            return Object.keys(parseAiEditFiles(interaction.aiEdits)).some((path) => path.startsWith(prefix))
          })
        : interactions
      return [
        `## Task ${i + 1} (task_id: ${task.id})`,
        `Title: ${task.title}`,
        `Description: ${task.description}`,
        `Done when:\n${doneWhenList(task.doneWhen).map((c) => `- ${c}`).join('\n')}`,
        '',
        '### Original provided files',
        formatFiles(scopedBuggy),
        '',
        "### Candidate's final files",
        formatFiles(scopedCandidate),
        '',
        '### Reference solution (grading aid, not the only valid answer)',
        formatFiles(scopedSolution),
        '',
        '### AI interactions relevant to this task',
        formatInteractionEvidence(scopedInteractions),
      ].join('\n')
    })
    .join('\n\n')
  return `${sharedEvidence}\n\n${taskEvidence}`
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  return JSON.parse(candidate.trim())
}

const EVIDENCE_SCORE: Record<ScoringStrictness, readonly number[]> = {
  LOW: [0, 30, 60, 85, 100],
  MEDIUM: [0, 20, 50, 75, 100],
  HIGH: [0, 10, 40, 65, 95],
  EXTRA_HIGH: [0, 5, 30, 55, 90],
}

export function mapEvidenceLevel(level: number, strictness: ScoringStrictness): number {
  return EVIDENCE_SCORE[strictness][level] ?? 0
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}

export function calculateCriterionScore(
  evidenceLevels: Record<string, number>,
  criteria: ProjectScoringCriterion[],
  strictness: ScoringStrictness,
): { baseScore: number; criteriaScores: TaskScore['criteriaScores'] } {
  const criteriaScores = criteria.map((criterion) => {
    const evidenceLevel = evidenceLevels[criterion.key] ?? 0
    const score = mapEvidenceLevel(evidenceLevel, strictness)
    return {
      key: criterion.key,
      name: criterion.name,
      evidenceLevel,
      score,
      weight: criterion.weight,
      weightedContribution: roundToTwo(score * (criterion.weight / 100)),
    }
  })
  return {
    baseScore: roundToTwo(criteriaScores.reduce((sum, criterion) => sum + criterion.weightedContribution, 0)),
    criteriaScores,
  }
}

export function applyProjectScoreGates(params: {
  calculation: ReturnType<typeof calculateCriterionScore>
  evidence: ProjectEvidence
  missingRequirements: string[]
  criticalFailures: Array<'FUNCTIONAL_BROKEN' | 'SECURITY_OR_DESTRUCTIVE_REGRESSION' | 'HARD_CODED_SOLUTION'>
}): {
  criteriaScores: TaskScore['criteriaScores']
  baseScore: number
  appliedCaps: TaskScore['appliedCaps']
  finalScore: number
} {
  const noVerification = !params.evidence.prechecks.hasVerificationEvidence
  const assistantUnavailable = params.evidence.prechecks.assistantEvidenceState === 'PLATFORM_UNAVAILABLE'
  const blindAiAcceptance = !assistantUnavailable && params.evidence.aiEditedFiles.length > 0 && params.evidence.filesChangedAfterAi.length === 0
  let criteriaScores = params.calculation.criteriaScores.map((criterion) => {
    let score = criterion.score
    if (criterion.key === 'verification_regression_safety' && noVerification) score = 0
    if (criterion.key === 'independent_engineering_contribution' && blindAiAcceptance) score = Math.min(score, 20)
    return {
      ...criterion,
      score,
      weightedContribution: roundToTwo(score * (criterion.weight / 100)),
    }
  })
  if (assistantUnavailable) {
    const excludedKeys = new Set(['technical_reasoning_ai_direction', 'independent_engineering_contribution'])
    const observableWeight = criteriaScores.reduce(
      (sum, criterion) => sum + (excludedKeys.has(criterion.key) ? 0 : criterion.weight),
      0,
    )
    criteriaScores = criteriaScores.map((criterion) => ({
      ...criterion,
      weightedContribution: excludedKeys.has(criterion.key) || observableWeight <= 0
        ? 0
        : roundToTwo(criterion.score * (criterion.weight / observableWeight)),
    }))
  }
  const baseScore = roundToTwo(criteriaScores.reduce((sum, criterion) => sum + criterion.weightedContribution, 0))
  const caps: TaskScore['appliedCaps'] = []
  const addCap = (reason: string, cap: number) => caps.push({ reason, cap })

  if (params.evidence.prechecks.missingRequiredFiles.length > 0) addCap('Missing required submission file', 0)
  if (!params.evidence.prechecks.hasMeaningfulChange) addCap('No meaningful implementation change', 0)
  if (params.criticalFailures.includes('FUNCTIONAL_BROKEN')) addCap('Required functionality is broken', 45)
  if (params.missingRequirements.length > 0) addCap('One or more Done when requirements are unmet', 60)
  if (noVerification) addCap('No verification evidence', 70)
  if (blindAiAcceptance) addCap('AI changes accepted without meaningful candidate revision', 75)
  if (params.evidence.prechecks.exactReferenceMatches.length > 0 || params.criticalFailures.includes('HARD_CODED_SOLUTION')) {
    addCap('Exact reference match or hard-coded solution detected', 40)
  }
  if (params.criticalFailures.includes('SECURITY_OR_DESTRUCTIVE_REGRESSION')) {
    addCap('Security issue or destructive regression detected', 30)
  }

  const appliedCaps = caps.sort((a, b) => a.cap - b.cap)
  const finalScore = roundToTwo(Math.min(baseScore, ...appliedCaps.map((cap) => cap.cap), 100))
  return { criteriaScores, baseScore, appliedCaps, finalScore }
}

export function projectDifficultyWeight(difficulty: string | null): number {
  if (difficulty?.toUpperCase() === 'HARD') return 2
  if (difficulty?.toUpperCase() === 'MEDIUM') return 1.5
  return 1
}

export function aggregateProjectTaskScores(tasks: TaskScore[]): {
  totalDifficultyWeight: number
  weightedScoreSum: number
  finalProjectScore: number
} {
  const totalDifficultyWeight = tasks.reduce((sum, task) => sum + task.difficultyWeight, 0)
  const weightedScoreSum = roundToTwo(tasks.reduce(
    (sum, task) => sum + task.finalScore * task.difficultyWeight,
    0,
  ))
  return {
    totalDifficultyWeight,
    weightedScoreSum,
    finalProjectScore: totalDifficultyWeight > 0 ? roundToTwo(weightedScoreSum / totalDifficultyWeight) : 0,
  }
}

async function requestJudgeScores(
  gatewayUrl: string,
  jwtSecret: string,
  model: string,
  criteria: ProjectScoringCriterion[],
  strictness: ScoringStrictness,
  userPrompt: string,
  retryHint = '',
): Promise<z.infer<typeof JudgeResponseSchema> | null> {
  const raw = await callJudge(gatewayUrl, jwtSecret, {
    model,
    systemPrompt: buildSystemPrompt(criteria, strictness),
    userPrompt: retryHint ? `${userPrompt}\n\n${retryHint}` : userPrompt,
  })
  try {
    const parsed = JudgeResponseSchema.safeParse(extractJson(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function parseCriteria(raw: unknown): ProjectScoringCriterion[] {
  const parsed = z.array(CriterionSchema).safeParse(raw)
  if (
    !parsed.success ||
    parsed.data.length === 0 ||
    parsed.data.reduce((sum, criterion) => sum + criterion.weight, 0) !== 100
  ) return DEFAULT_PROJECT_CRITERIA
  return parsed.data.map((criterion) => {
    const canonical = DEFAULT_CRITERIA_BY_KEY.get(criterion.key)
    return canonical ? { ...criterion, name: canonical.name, description: canonical.description } : criterion
  })
}

export async function scoreProject(params: {
  gatewayUrl: string
  jwtSecret: string
  model: string
  tasks: ProjectTaskLike[]
  currentCode: string
  referenceFilesRaw: unknown
  solutionFilesRaw: unknown
  projectScoringCriteriaRaw?: unknown
  scoringStrictness?: string
  submissionFilesRaw?: unknown
  interactions?: ProjectInteractionLike[]
  runEvents?: ProjectRunEventLike[]
  assistantUnavailableCount?: number
}): Promise<ProjectScoreResult> {
  const { gatewayUrl, jwtSecret, model, tasks } = params

  if (tasks.length === 0) {
    return {
      codeCorrectnessScore: 0,
      projectScores: {
        tasks: [],
        evidence: buildProjectEvidence({ candidateFiles: {}, starterFiles: {} }),
        aggregation: { totalDifficultyWeight: 0, weightedScoreSum: 0, finalProjectScore: 0 },
      },
    }
  }

  const criteria = parseCriteria(params.projectScoringCriteriaRaw)
  const scoringStrictness = ['LOW', 'MEDIUM', 'HIGH', 'EXTRA_HIGH'].includes(params.scoringStrictness ?? '')
    ? params.scoringStrictness as ScoringStrictness
    : 'MEDIUM'
  const buggyFiles = decodeReferenceFiles(params.referenceFilesRaw)
  let candidateFiles = parseWorkspaceFiles(params.currentCode)
  // Browser-based PROJECT sessions may persist a single file as plain text.
  // When the assessment has exactly one starter file, that text belongs to the
  // starter path; keeping the parser's anonymous "" key would falsely report
  // the real file as deleted and corrupt file-change/AI-edit evidence.
  if (Object.keys(candidateFiles).length === 1 && '' in candidateFiles && Object.keys(buggyFiles).length === 1) {
    candidateFiles = { [Object.keys(buggyFiles)[0]!]: candidateFiles[''] ?? '' }
  }
  const solutionFiles = decodeReferenceFiles(params.solutionFilesRaw)
  const evidence = buildProjectEvidence({
    candidateFiles,
    starterFiles: buggyFiles,
    solutionFiles,
    tasks,
    submissionFilesRaw: params.submissionFilesRaw,
    interactions: params.interactions,
    runEvents: params.runEvents,
    assistantUnavailableCount: params.assistantUnavailableCount,
  })
  const userPrompt = buildUserPrompt(tasks, candidateFiles, buggyFiles, solutionFiles, evidence, params.interactions ?? [])

  let response = await requestJudgeScores(gatewayUrl, jwtSecret, model, criteria, scoringStrictness, userPrompt)
  if (!response) {
    response = await requestJudgeScores(
      gatewayUrl,
      jwtSecret,
      model,
      criteria,
      scoringStrictness,
      userPrompt,
      'Your previous response was not valid JSON matching the required schema. Respond with ONLY the JSON object - no code fences, no prose.',
    )
  }
  if (!response) throw new Error('SCORING_FAILED: project judge returned invalid evidence after retry')

  const byTaskId = new Map((response?.tasks ?? []).map((t) => [t.task_id, t]))

  const taskScores: TaskScore[] = tasks.map((task) => {
    const result = byTaskId.get(task.id)
    if (!result) throw new Error(`SCORING_FAILED: project judge omitted task ${task.id}`)
    if (criteria.some((criterion) => result.evidence_levels[criterion.key] === undefined)) {
      throw new Error(`SCORING_FAILED: project judge omitted criterion evidence for task ${task.id}`)
    }
    const evidenceFiles = new Set([
      ...Object.keys(filesForTask(candidateFiles, task.bugBankId)),
      ...Object.keys(filesForTask(buggyFiles, task.bugBankId)),
      ...Object.keys(filesForTask(solutionFiles, task.bugBankId)),
    ])
    if (evidenceFiles.size > 0 && ![...evidenceFiles].some((path) => result.rationale.includes(path))) {
      throw new Error(`SCORING_FAILED: project judge rationale has no file evidence for task ${task.id}`)
    }
    const evidenceFileList = [...evidenceFiles]
    const hasFileEvidenceReference = evidenceFiles.size === 0 || result.evidence_references.some((reference) =>
      evidenceFileList.some((path) => reference.includes(path)),
    )
    if (!hasFileEvidenceReference) {
      result.evidence_references = [evidenceFileList[0]!, ...result.evidence_references]
    }
    const percentageScores = Object.fromEntries(criteria.map((criterion) => [
      criterion.key,
      mapEvidenceLevel(result.evidence_levels[criterion.key] ?? 0, scoringStrictness),
    ]))
    const calculation = calculateCriterionScore(result.evidence_levels, criteria, scoringStrictness)
    const gated = applyProjectScoreGates({
      calculation,
      evidence,
      missingRequirements: result.missing_requirements,
      criticalFailures: result.critical_failures,
    })
    return {
      taskId: task.id,
      difficulty: task.difficulty ?? 'EASY',
      difficultyWeight: projectDifficultyWeight(task.difficulty),
      acceptanceFunctionalCorrectness: percentageScores.acceptance_functional_correctness ?? 0,
      verificationRegressionSafety: percentageScores.verification_regression_safety ?? 0,
      technicalReasoningAiDirection: percentageScores.technical_reasoning_ai_direction ?? 0,
      independentEngineeringContribution: percentageScores.independent_engineering_contribution ?? 0,
      architectureMigrationQuality: percentageScores.architecture_migration_quality ?? 0,
      scopeCodeQuality: percentageScores.scope_code_quality ?? 0,
      criteriaScores: gated.criteriaScores,
      rationale: result.rationale,
      evidenceReferences: result.evidence_references,
      missingRequirements: result.missing_requirements,
      baseScore: gated.baseScore,
      appliedCaps: gated.appliedCaps,
      finalScore: gated.finalScore,
      weightedTotal: gated.finalScore,
    }
  })

  const aggregation = aggregateProjectTaskScores(taskScores)
  const codeCorrectnessScore = aggregation.finalProjectScore

  return { codeCorrectnessScore, projectScores: { tasks: taskScores, evidence, aggregation } }
}
