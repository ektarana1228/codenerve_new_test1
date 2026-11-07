import puppeteer from 'puppeteer'

// ─── Puppeteer launcher ───────────────────────────────────────────────────────

export async function generatePdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.emulateMediaType('print')
    await page.evaluate(() => document.fonts.ready)
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' },
      scale: 1,
      preferCSSPageSize: false,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #172033; font-size: 14px; line-height: 1.55; background:#ffffff; font-weight:400; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  h1 { font-size: 30px; font-weight: 700; color: #101828; margin-bottom: 6px; letter-spacing: 0; }
  h2 { font-size: 20px; font-weight: 700; color: #101828; margin: 22px 0 12px; padding-bottom: 7px; border-bottom: 2px solid #e94560; }
  h3 { font-size: 15px; font-weight: 700; color: #102a56; margin: 15px 0 7px; }
  p { margin-bottom: 6px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 18px; }
  .candidate-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .candidate-row strong { font-size:15px; }
  .meta { display:flex; align-items:center; flex-wrap:wrap; column-gap:8px; }
  .score-hero { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 18px 0 20px; }
  .score-card { background: #f8fbff; border: 1px solid #d8e2f5; border-top: 4px solid #0f3460; padding: 16px 18px; border-radius: 6px; break-inside: avoid; }
  .score-card .label { font-size: 11px; color: #52617a; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; }
  .score-card .value { font-size: 34px; font-weight: 700; color: #0f3460; line-height: 1.05; margin-top: 8px; }
  .score-card .value .score-denominator { font-size: 28px; color:#0f3460; }
  .score-card .unit { font-size: 12px; color: #667085; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12.5px; }
  th { background: #102a56; color: #fff; padding: 9px 11px; text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  td { padding: 9px 11px; border-bottom: 1px solid #e5eaf3; vertical-align: top; font-weight:400; }
  tr:nth-child(even) td { background: #f8fafd; }
  .page-break { page-break-after: always; }
  .header { background: linear-gradient(135deg, #111827 0%, #172554 52%, #0f3460 100%);
    color: white; padding: 22px 26px; margin: 0 0 20px; border-radius: 6px; break-inside: avoid; box-shadow: 0 6px 18px rgba(15,52,96,0.16); }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:14px; font-size:18px; font-weight:700; }
  .brand svg { width:30px; height:30px; flex:none; }
  .header h1 { color: white; }
  .header .subtitle { color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 4px; }
  .cover { min-height: 265mm; display: flex; flex-direction: column; justify-content:center; page-break-after: always; }
  .cover-panel { background: linear-gradient(135deg, #111827 0%, #172554 56%, #0f3460 100%); color: white; border-radius: 8px; padding: 46px 50px; min-height: 252mm; display:flex; flex-direction:column; justify-content:space-between; box-shadow: 0 14px 32px rgba(15, 52, 96, 0.22); }
  .cover .brand { margin-bottom: 34px; font-size: 23px; }
  .cover .brand svg { width: 36px; height: 36px; }
  .cover-kicker { color: rgba(255,255,255,0.72); font-size: 13px; text-transform: uppercase; letter-spacing: 2.2px; font-weight: 700; margin-bottom: 16px; }
  .cover-title { color: white; font-size: 48px; line-height: 1.05; margin-bottom: 16px; }
  .cover-subtitle { color: rgba(255,255,255,0.78); font-size: 17px; max-width: 470px; }
  .cover-score { display:flex; flex-direction:column; align-items:flex-start; gap:8px; margin-top: 56px; }
  .cover-score-line { display:flex; align-items:baseline; gap:12px; }
  .cover-score .number { font-size: 86px; line-height: 0.9; font-weight: 700; color: white; }
  .cover-score .denominator { color: white; font-size: 34px; font-weight:700; }
  .cover-score .unit { color: rgba(255,255,255,0.74); font-size: 18px; padding-bottom: 0; text-transform:uppercase; letter-spacing:1px; }
  .cover-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 18px 22px; margin-top: 42px; }
  .cover-field { border-top: 1px solid rgba(255,255,255,0.22); padding-top: 10px; }
  .cover-field .field-label { color: rgba(255,255,255,0.58); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .cover-field .field-value { color: white; font-size: 15px; font-weight: 700; margin-top: 4px; }
  .split-date { display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
  .split-date span { display:inline-block; }
  .report-page { page-break-after: always; }
  .section-label { color:#e94560; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.8px; margin-bottom: 6px; }
  .page-title { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:18px; }
  .page-title p { color:#667085; font-size:13px; max-width:520px; margin:0; }
  .info-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; margin: 12px 0 18px; }
  .info-item { border-bottom: 1px solid #e5eaf3; padding: 9px 0; }
  .info-label { color:#667085; font-size:10px; text-transform:uppercase; letter-spacing:0.8px; font-weight:700; }
  .info-value { color:#101828; font-size:14px; font-weight:700; margin-top:2px; }
  .summary-panel { border:1px solid #d8e2f5; border-radius:8px; padding:16px; background:#fbfdff; margin-top:10px; }
  .summary-panel.technical { border-left:5px solid #0f3460; }
  .progress-track { background:#e8edf5; border-radius:999px; height:8px; width:100%; margin-top:5px; overflow:hidden; }
  .progress-fill { background:#0f3460; border-radius:999px; height:8px; }
  .score-progress-cell { min-width:160px; }
  .score-progress-value { font-weight:700; color:#102a56; margin-bottom:4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-lang { background: #e94560; color: white; }
  .method-page { page-break-after: always; }
  .project-method .criteria-description { font-size:12px; color:#4b5563; line-height:1.45; margin-top:4px; }
  .calc-card { border:1px solid #d8e2f5; border-left:5px solid #0f3460; border-radius:8px; padding:14px 16px; margin-top:14px; break-inside:avoid; background:#ffffff; }
  .calc-card h3 { margin:0 0 6px; font-size:16px; }
  .calc-card .card-note { color:#4b5563; font-size:12px; line-height:1.5; margin:0 0 8px; }
  .calc-card.caps { border-left-color:#e94560; }
  .method-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:12px; }
  .project-method .method-grid { display:none; }
  .project-method .method-grid.professional { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:12px; }
  .method-card { border:1px solid #dfe5f2; border-top:4px solid #0f3460; border-radius:8px; padding:14px 16px; break-inside:avoid; background:#fbfdff; }
  .method-card h3 { margin:0 0 6px; font-size:15px; color:#102a56; }
  .method-card p { color:#4b5563; font-size:12px; line-height:1.5; margin:0; }
  .formula { background:#eef5ff; border:1px solid #cfe0f7; border-radius:6px; padding:12px 14px; margin:14px 0; color:#0f3460; font-size:12.5px; font-weight:700; }
  .warning { background:#fff7ed; border:1px solid #f59e0b; border-radius:6px; color:#92400e; padding:11px 13px; margin:12px 0; font-size:12.5px; font-weight:700; }
  .insight-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-top:14px; }
  .insight-card { border:1px solid #dfe5f2; border-radius:8px; padding:12px 14px; background:#ffffff; break-inside:avoid; }
  .insight-card h3 { margin:0 0 5px; font-size:13px; }
  .insight-card p { color:#4b5563; font-size:12px; line-height:1.45; margin:0; }
  .project-card-stack { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:16px; }
  .project-card-stack .wide { grid-column:1 / -1; }
  .project-score-card { border:1px solid #dfe5f2; border-top:4px solid #0f3460; border-radius:8px; padding:16px 18px; background:#fbfdff; break-inside:avoid; min-height:88px; }
  .project-score-card h3 { margin:0 0 7px; font-size:15px; color:#102a56; }
  .project-score-card p { color:#4b5563; font-size:12.5px; line-height:1.5; margin:0; }
  .project-score-card .mini { color:#0f3460; font-weight:700; margin-top:8px; }
  .score-controls-list { margin:8px 0 0 16px; color:#4b5563; font-size:12.5px; line-height:1.5; font-weight:400; }
  .score-controls-list ul { margin:4px 0 0 14px; padding:0; }
  .compact { margin-top:8px; font-size:12px; }
  .compact th, .compact td { padding:8px 9px; }
  .technical-score-table { table-layout: fixed; width:100%; }
  .technical-score-table th, .technical-score-table td { font-weight:400; line-height:1.45; overflow-wrap:break-word; word-break:normal; }
  .technical-score-table th { font-weight:700; }
  .technical-score-table .criterion-cell { width:62%; }
  .technical-score-table .score-col { width:13%; text-align:right; white-space:nowrap; }
  .technical-score-table .weight-col { width:10%; text-align:right; white-space:nowrap; }
  .technical-score-table .contribution-col { width:15%; text-align:right; white-space:nowrap; }
  .criterion-title { display:block; color:#172033; font-weight:400; margin-bottom:2px; }
  .criterion-description { display:block; color:#6b7280; font-weight:400; line-height:1.5; }
  .verified { color:#166534; font-weight:700; }
  .muted { color:#6b7280; font-weight:400; }
`

const BRAND = `<div class="brand"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 41 14.5 24 24 7 14.5 24 5Z" fill="#3B82F6"/><path d="M7 14.5 24 24v18.5L7 33V14.5Z" fill="#A855F7"/><path d="M41 14.5 24 24v18.5L41 33V14.5Z" fill="#6366F1"/></svg><span>ApexCoder</span></div>`

// ─── Individual candidate report ──────────────────────────────────────────────

export interface CandidateReportData {
  candidateName: string
  assessmentTitle: string
  language: string
  totalScore: number
  codeCorrectnessScore: number
  aiuScores: Record<string, number>
  aiuTotalScore: number
  timeTakenSeconds: number | null
  turnCount: number
  submittedAt: string | null
  generatedAt: string
  // Assistant capability level this attempt actually ran under, snapshotted on
  // the session. Stated on the report so scores stay comparable and defensible
  // when candidates were evaluated under different assistant conditions.
  aiAssistantMode: string
  kind?: 'CODING' | 'PROJECT'
  codeWeight?: number
  aiuWeight?: number
  aiuMetricWeights?: Record<string, number>
  scoreEvidence?: unknown
  projectScores?: unknown
  feedback?: {
    average_rating: number
    comments: string | null
    technical_issue_type: string | null
    task_where_issue_occurred: string | null
    may_contact: boolean
    submitted_at: string
    [key: string]: unknown
  } | null
}

const AI_ASSISTANT_MODE_LABELS: Record<string, string> = {
  AGENTIC: 'Agentic',
  NON_AGENTIC: 'Non-Agentic',
  DISABLED: 'Disabled',
}

const AIU_METRIC_LABELS: Record<string, string> = {
  correctness: 'Correctness',
  efficiency: 'Efficiency',
  robustness: 'Robustness',
  code_quality: 'Code Quality',
  prompt_quality: 'Prompt Quality',
  iteration_efficiency: 'Iteration Efficiency',
  independent_editing: 'Independent Editing',
  contextual_relevance: 'Contextual Relevance',
}

function formatSeconds(s: number | null): string {
  if (s == null) return '-'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function aiuMetricRows(aiuScores: Record<string, number>): string {
  return ['correctness', 'efficiency', 'robustness', 'code_quality']
    .map((key) => {
      const score = num(aiuScores[key])
      const label = AIU_METRIC_LABELS[key] ?? key
      const safeScore = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0))
      const bar = `<div class="progress-track"><div class="progress-fill" style="width:${safeScore}%;"></div></div>`
      return `<tr><td>${label}</td><td class="score-progress-cell"><div class="score-progress-value">${compactScoreOutOf100(safeScore)}</div>${bar}</td></tr>`
    })
    .join('')
}

function projectCriteria(projectScores: unknown): Array<{ name: string; score: number; weight: number }> {
  const tasks = Array.isArray(record(projectScores).tasks) ? (record(projectScores).tasks as unknown[]).map(record) : []
  const totals = new Map<string, { name: string; score: number; difficulty: number; weight: number }>()
  for (const task of tasks) {
    const difficulty = Math.max(0, num(task.difficultyWeight, 1)) || 1
    const criteria = Array.isArray(task.criteriaScores) ? task.criteriaScores.map(record) : []
    for (const criterion of criteria) {
      const key = String(criterion.key ?? criterion.name ?? '')
      if (!key) continue
      const current = totals.get(key) ?? { name: String(criterion.name ?? key), score: 0, difficulty: 0, weight: num(criterion.weight) }
      current.score += num(criterion.score) * difficulty
      current.difficulty += difficulty
      current.weight = num(criterion.weight, current.weight)
      totals.set(key, current)
    }
  }
  return [...totals.values()].map((criterion) => ({
    name: criterion.name,
    score: criterion.difficulty > 0 ? criterion.score / criterion.difficulty : 0,
    weight: criterion.weight,
  }))
}

function projectCriterionRows(projectScores: unknown): string {
  return projectCriteria(projectScores).map((criterion) => {
    const safeScore = Math.max(0, Math.min(100, criterion.score))
    const bar = `<div class="progress-track"><div class="progress-fill" style="width:${safeScore}%;"></div></div>`
    return `<tr><td>${escapeHtml(criterion.name)} <span class="muted">(${criterion.weight.toFixed(1)}%)</span></td><td class="score-progress-cell"><div class="score-progress-value">${compactScoreOutOf100(safeScore)}</div>${bar}</td></tr>`
  }).join('')
}

const CODING_PROFILES: Record<string, { executable: number; basic: number; edge: number; performance: number; criticalCap: number }> = {
  LOW: { executable: 10, basic: 55, edge: 30, performance: 5, criticalCap: 85 },
  MEDIUM: { executable: 5, basic: 50, edge: 35, performance: 10, criticalCap: 75 },
  HIGH: { executable: 5, basic: 40, edge: 40, performance: 15, criticalCap: 65 },
  EXTRA_HIGH: { executable: 0, basic: 35, edge: 40, performance: 25, criticalCap: 50 },
}

const AIU_METHODS: Record<string, string> = {
  correctness: 'Measures whether the solution compiles successfully and produces the expected output across visible tests, hidden tests, and output validation checks. It reflects the overall functional accuracy of the submitted solution. A high score indicates that the solution works correctly across both common and unseen scenarios.',
  efficiency: 'Measures how effectively the solution uses computational resources. It considers algorithmic time complexity, space complexity, execution time, and memory usage in relation to the problem requirements. A high score indicates that the solution performs efficiently and scales well for larger inputs.',
  robustness: 'Measures how reliably the solution handles edge cases, boundary values, unusual inputs, and execution failures. It also considers whether the code avoids crashes and manages exceptional situations safely. A high score indicates that the solution remains stable under difficult or unexpected conditions.',
  code_quality: 'Measures the overall structural quality and maintainability of the code. It considers readability, naming, modularity, nesting, duplication, dead code, complexity, and incomplete or placeholder implementations. A high score indicates that the code is clear, organized, reusable, and easy to maintain.',
  prompt_quality: 'Average prompt evidence for intent, relevant context, requirements, constraints, reasoning and verifiable outcomes; copied, delegated, duplicated or context-free prompts are capped.',
  iteration_efficiency: 'Measures verified progress across run results and AI turns, rewarding improvement and validation while penalising regressions or repeated prompts without a run.',
  independent_editing: 'Compares recorded AI edits with the final files and credits meaningful candidate changes beyond directly accepting generated code.',
  contextual_relevance: 'Checks whether prompts and AI use stay aligned with the active problem, file context, observed failures and subsequent run evidence.',
}

const PROJECT_CRITERION_DESCRIPTIONS: Record<string, string> = {
  acceptance_and_functional_correctness: 'Considers whether the final submission implements the requested behavior, satisfies the task acceptance criteria and Done when requirements, handles relevant edge cases, and does not receive full credit merely because code exists or was produced by AI.',
  verification_and_regression_safety: 'Considers evidence that the candidate tested or otherwise verified the change, investigated failures, preserved existing behavior, and avoided regressions, ignored contracts, or unsafe migration behavior.',
  technical_reasoning_and_ai_direction: 'Considers how clearly the candidate decomposed the task, gave the AI relevant constraints and context, reviewed output, corrected mistakes, and used purposeful iterations instead of blindly accepting generated code.',
  independent_engineering_contribution: 'Considers the candidate own review, edits, decisions, debugging, and meaningful improvements beyond directly accepting AI-generated work. Full credit requires clear independent engineering judgment.',
  architecture_and_migration_quality: 'Considers compatibility with the existing architecture, maintainability, data and configuration safety, migration sequencing, rollback awareness, and whether the solution fixes root cause without damaging surrounding systems.',
  scope_and_code_quality: 'Considers whether the changes are focused, clear, reviewable, and free from hard-coded shortcuts, dead code, unnecessary rewrites, formatting churn, and unrelated modifications.',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function scoreOutOf100(value: number): string {
  return `${value.toFixed(1)} /100`
}

function projectRecommendationLine(baseScore: number, finalScore: number): string {
  if (baseScore < 50) {
    return `Recommendation: Not recommended for company fit because the Base score is low at ${scoreOutOf100(baseScore)}, showing weak project readiness.`
  }
  if (finalScore < 60) {
    return `Recommendation: Manual review recommended because Base score is ${scoreOutOf100(baseScore)}, but the capped Total Score is ${scoreOutOf100(finalScore)} after scoring safeguards.`
  }
  if (finalScore >= 75) {
    return `Recommendation: Recommended because Base score is ${scoreOutOf100(baseScore)} and the capped Total Score remains strong at ${scoreOutOf100(finalScore)}.`
  }
  return `Recommendation: Borderline; review the evidence because Base score is ${scoreOutOf100(baseScore)} and the capped Total Score is ${scoreOutOf100(finalScore)}.`
}

function compactScoreOutOf100(value: number): string {
  const rounded = value.toFixed(1)
  return `${rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded}/100`
}

function dateTimeParts(value: string | null): { date: string; time: string } {
  if (!value) return { date: '-', time: '-' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: value, time: '-' }
  return {
    date: date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }),
  }
}

function dateTimeHtml(value: string | null): string {
  const parts = dateTimeParts(value)
  return `<span class="split-date"><span>${escapeHtml(parts.date)}</span><span>${escapeHtml(parts.time)}</span></span>`
}

function criterionDescription(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return PROJECT_CRITERION_DESCRIPTIONS[key] ?? 'Considers the persisted evaluator evidence for this configured project criterion.'
}

function codingTestEvidenceHtml(scoreEvidence: unknown): string {
  const evidence = record(scoreEvidence)
  const coding = record(evidence.coding_test_evidence)
  const problems = Array.isArray(coding.problems) ? coding.problems.map(record) : []
  if (problems.length === 0) {
    return ''
  }
  const rows = problems.map((problem) => {
    const criticalFailed = num(problem.critical_failed)
    return `<tr><td><strong>Problem ${num(problem.problem_index, 1)}</strong><div class="criteria-description">${escapeHtml(String(problem.problem_title ?? 'Coding problem'))}</div></td><td>${escapeHtml(String(problem.execution_status ?? '-'))}</td><td style="text-align:right;">${num(problem.visible_passed)}/${num(problem.visible_total)}</td><td style="text-align:right;">${num(problem.hidden_passed)}/${num(problem.hidden_total)}</td><td style="text-align:right;">${num(problem.total_passed)}/${num(problem.total_tests)}</td><td style="text-align:right;">${criticalFailed === 0 ? '0' : `<strong>${criticalFailed}</strong>`}</td><td style="text-align:right;"><strong>${scoreOutOf100(num(problem.problem_score))}</strong></td></tr>`
  }).join('')
  return `<table class="compact"><thead><tr><th>Problem</th><th>Status</th><th style="text-align:right;">Visible</th><th style="text-align:right;">Hidden</th><th style="text-align:right;">Total tests</th><th style="text-align:right;">Critical failed</th><th style="text-align:right;">Score</th></tr></thead><tbody>${rows}</tbody></table>`
}

function reportKindLabel(d: CandidateReportData): string {
  return d.kind === 'PROJECT' ? 'Project / Migration' : 'Coding'
}

function coverPage(d: CandidateReportData): string {
  const generated = dateTimeHtml(d.generatedAt)
  return `<section class="cover">
    <div class="cover-panel">
      <div>
        ${BRAND}
        <div class="cover-kicker">Candidate Assessment Report</div>
        <h1 class="cover-title">${escapeHtml(d.candidateName)}</h1>
        <p class="cover-subtitle">Scoring summary and calculation evidence for ${escapeHtml(d.assessmentTitle)}.</p>
        <div class="cover-score">
          <div class="cover-score-line"><span class="number">${d.totalScore.toFixed(1)}</span><span class="denominator">/100</span></div>
          <div class="unit">Total Score</div>
        </div>
      </div>
      <div class="cover-grid">
        <div class="cover-field"><div class="field-label">Role</div><div class="field-value">AI Engineering</div></div>
        <div class="cover-field"><div class="field-label">Assessment Type</div><div class="field-value">${escapeHtml(reportKindLabel(d))}</div></div>
        <div class="cover-field"><div class="field-label">Language</div><div class="field-value">${escapeHtml(d.language)}</div></div>
        <div class="cover-field"><div class="field-label">Generated</div><div class="field-value">${generated}</div></div>
      </div>
    </div>
  </section>`
}

function scoreOverviewPage(d: CandidateReportData): string {
  const isProject = d.kind === 'PROJECT'
  const projectTasks = Array.isArray(record(d.projectScores).tasks) ? (record(d.projectScores).tasks as unknown[]).length : 0
  const submitted = dateTimeHtml(d.submittedAt)
  const taskValue = isProject ? `${projectTasks}/${Math.max(1, projectTasks)}` : d.aiuTotalScore.toFixed(1)
  const scoreCards = isProject
    ? `<div class="score-card"><div class="label">Total Score</div><div class="value">${d.totalScore.toFixed(1)}<span class="score-denominator">/100</span></div></div>
    <div class="score-card"><div class="label">Base score</div><div class="value">${d.codeCorrectnessScore.toFixed(1)}<span class="score-denominator">/100</span></div></div>
      <div class="score-card"><div class="label">Tasks Evaluated</div><div class="value">${taskValue}</div></div>`
    : `<div class="score-card"><div class="label">Total Score</div><div class="value">${d.totalScore.toFixed(1)}<span class="score-denominator">/100</span></div></div>`
  return `<section class="report-page">
    <div class="page-title">
      <div>
        <h1>Candidate Score Summary</h1>
      </div>
      ${BRAND}
    </div>

    <div class="info-grid">
      <div class="info-item"><div class="info-label">Candidate</div><div class="info-value">${escapeHtml(d.candidateName)}</div></div>
      <div class="info-item"><div class="info-label">Language</div><div class="info-value">${escapeHtml(d.language)}</div></div>
      <div class="info-item"><div class="info-label">Submitted</div><div class="info-value">${submitted}</div></div>
      <div class="info-item"><div class="info-label">Duration</div><div class="info-value">${d.timeTakenSeconds !== null ? formatSeconds(d.timeTakenSeconds) : '-'}</div></div>
    </div>

    <div class="score-hero" ${isProject ? '' : 'style="grid-template-columns:repeat(2,1fr);"'}>${scoreCards}</div>

    <div class="summary-panel${isProject ? '' : ' technical'}">
      <h2>${isProject ? 'Project Criteria Breakdown' : 'Technical Evaluation'}</h2>
      <table>
        <thead><tr><th>Metric</th><th>Score</th></tr></thead>
        <tbody>${isProject ? projectCriterionRows(d.projectScores) : aiuMetricRows(d.aiuScores)}</tbody>
      </table>
      ${isProject ? '<p class="criteria-description" style="margin-top:12px;">AI usage is evaluated within the project criteria (Technical Reasoning and AI Direction, Independent Engineering Contribution — 35% combined), not as a separate AIU score.</p>' : ''}
    </div>
  </section>`
}

function codingMethodology(d: CandidateReportData): string {
  const metricRows = ['correctness', 'efficiency', 'robustness', 'code_quality'].map((key) => {
    const score = num(d.aiuScores[key])
    return `<tr><td class="criterion-cell"><span class="criterion-title">${escapeHtml(AIU_METRIC_LABELS[key] ?? key)}</span><span class="criterion-description">${escapeHtml(AIU_METHODS[key] ?? 'Calculated from recorded assessment evidence.')}</span></td><td class="score-col">${scoreOutOf100(score)}</td><td class="weight-col">25.0%</td><td class="contribution-col">${(score * 0.25).toFixed(2)}</td></tr>`
  }).join('')
  return `
    <div class="page-title">
      <div>
        <h1>How the score was calculated</h1>
      </div>
      ${BRAND}
    </div>
    <div class="project-card-stack">
      <div class="project-score-card wide"><h3>Total Score - ${scoreOutOf100(d.totalScore)}</h3><p>The total score is the average of all criteria scores: Correctness, Efficiency, Robustness, and Code Quality.</p></div>
    </div>
    <div class="calc-card">
      <h3>Total score calculation</h3>
      <p class="card-note">Each criterion contributes 25%. The total score equals the average of all criteria scores.</p>
      <table class="compact technical-score-table"><thead><tr><th class="criterion-cell">Criterion</th><th class="score-col">Score (/100)</th><th class="weight-col">Weight</th><th class="contribution-col">Contribution</th></tr></thead><tbody>${metricRows}</tbody></table>
    </div>`
}
function projectMethodology(d: CandidateReportData): string {
  const raw = record(d.projectScores)
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(record) : []
  const aggregation = record(raw.aggregation)
  const baseWeightedSum = num(aggregation.baseWeightedScoreSum, tasks.reduce((sum, task) => sum + num(task.baseScore) * num(task.difficultyWeight, 1), 0))
  const weightedSum = num(aggregation.weightedScoreSum, tasks.reduce((sum, task) => sum + num(task.finalScore ?? task.weightedTotal) * num(task.difficultyWeight, 1), 0))
  const totalWeight = num(aggregation.totalDifficultyWeight, tasks.reduce((sum, task) => sum + num(task.difficultyWeight, 1), 0))
  const baseCalculated = totalWeight > 0 ? baseWeightedSum / totalWeight : 0
  const calculated = totalWeight > 0 ? weightedSum / totalWeight : 0
  const difficultySummary = tasks.length
    ? tasks.map((task, index) => `Task ${index + 1}: ${escapeHtml(String(task.difficulty ?? 'EASY'))} x ${num(task.difficultyWeight, 1).toFixed(1)}`).join('; ')
    : 'No project task difficulty data was stored.'
  const scoreControlItems = tasks.flatMap((task, index) => {
    const caps = Array.isArray(task.appliedCaps) ? task.appliedCaps.map(record) : []
    return caps.map((cap) => `<li>Task ${index + 1}: ${escapeHtml(String(cap.reason ?? 'Score cap'))} cap ${scoreOutOf100(num(cap.cap))}</li>`)
  }).join('') || '<li>No caps applied</li>'
  const criteriaRows = projectCriteria(d.projectScores).map((criterion) => {
    const contribution = criterion.score * criterion.weight / 100
    return `<tr><td><strong>${escapeHtml(criterion.name)}</strong><div class="criteria-description">${escapeHtml(criterionDescription(criterion.name))}</div></td><td style="text-align:right;">${scoreOutOf100(criterion.score)}</td><td style="text-align:right;">${criterion.weight.toFixed(1)}%</td><td style="text-align:right;">${criterion.score.toFixed(1)} x ${criterion.weight.toFixed(1)}%</td><td style="text-align:right;"><strong>${contribution.toFixed(2)}</strong></td></tr>`
  }).join('')
  const capRows = tasks.flatMap((task, taskIndex) => {
    const caps = Array.isArray(task.appliedCaps) ? task.appliedCaps.map(record) : []
    const base = num(task.baseScore)
    return caps.map((cap) => `<tr><td>Task ${taskIndex + 1}</td><td>${escapeHtml(String(cap.reason ?? 'Score cap'))}</td><td style="text-align:right;">${scoreOutOf100(num(cap.cap))}</td><td style="text-align:right;">min(${base.toFixed(1)}, ${num(cap.cap).toFixed(1)})</td><td style="text-align:right;"><strong>${scoreOutOf100(Math.min(base, num(cap.cap)))}</strong></td></tr>`)
  }).join('')
  const taskFinalChecks = tasks.map((task, index) => {
    const caps = Array.isArray(task.appliedCaps) ? task.appliedCaps.map(record) : []
    const values = [num(task.baseScore), ...caps.map((cap) => num(cap.cap))]
    return `Task ${index + 1}: min(${values.map((value) => value.toFixed(1)).join(', ')}) = ${num(task.finalScore ?? task.weightedTotal).toFixed(1)}`
  }).join(' · ')
  return `
    <div class="page-title">
      <div>
        <h1>How the score was calculated</h1>
      </div>
      ${BRAND}
    </div>
    <div class="method-grid">
      <div class="method-card"><h3>Base score · ${scoreOutOf100(d.codeCorrectnessScore)}</h3><p>Criteria scores are read from saved project evidence and multiplied by their configured weights. This creates the base score after task controls, difficulty and caps are reconciled.</p></div>
      <div class="method-card"><h3>Task Score · ${scoreOutOf100(d.totalScore)}</h3><p>Every task keeps its weighted base score unless a deterministic cap applies. The final score is the difficulty-weighted average across all evaluated project tasks.</p></div>
    </div>
    <div class="project-card-stack">
      <div class="project-score-card"><h3>Base score - ${scoreOutOf100(d.codeCorrectnessScore)}</h3><p>Criteria scores are read from saved project evidence and multiplied by their configured weights. This creates the base score before difficulty and caps are reconciled.</p><ul class="score-controls-list"><li>Weighted criteria total: ${baseWeightedSum.toFixed(2)} /100</li><li>Controls considered:<ul>${scoreControlItems}</ul></li></ul></div>
      <div class="project-score-card"><h3>Task Score - ${scoreOutOf100(d.totalScore)}</h3><p>Every task keeps its weighted base score unless a deterministic cap applies. The final score is the difficulty-weighted average across all evaluated project tasks.</p><ul class="score-controls-list"><li>Task weighting: ${difficultySummary}</li><li>Weighted task sum: ${weightedSum.toFixed(2)}</li></ul></div>
      <div class="project-score-card wide"><h3>Difficulty Weighting</h3><p>Easy tasks count as 1.0, Medium as 1.5, and Hard as 2.0. This project uses total difficulty weight ${totalWeight.toFixed(1)}, which controls each task contribution to the final average.</p><ul class="score-controls-list"><li>Base formula: ${baseWeightedSum.toFixed(2)} / ${totalWeight.toFixed(2)} = ${scoreOutOf100(baseCalculated)}</li><li>Capped formula: ${weightedSum.toFixed(2)} / ${totalWeight.toFixed(2)} = ${scoreOutOf100(calculated)}</li></ul></div>
      <div class="project-score-card wide"><h3>Reviewer interpretation</h3><p>The submitted solution is scored from the saved project evidence, then checked against deterministic safeguards. A strong functional result can still be reduced when verification is missing or when AI-generated changes are accepted without enough meaningful candidate revision.</p><ul class="score-controls-list"><li>Strongest signal: the implementation evidence and criterion scores decide the weighted base score.</li><li>Risk signal: applicable caps limit the final score before it is reported as ${scoreOutOf100(d.totalScore)}.</li></ul></div>
    </div>
    <div class="calc-card criteria">
      <h3>Weighted criteria calculation</h3>
      <p class="card-note">Each contribution equals the persisted criterion score multiplied by the effective weight configured for this Project assessment. The base score is the sum of all contributions.</p>
      <table class="compact"><thead><tr><th>Criterion and what is considered</th><th style="text-align:right;">Score (/100)</th><th style="text-align:right;">Weight</th><th style="text-align:right;">Formula</th><th style="text-align:right;">Contribution</th></tr></thead><tbody>${criteriaRows || '<tr><td colspan="5">No criterion breakdown was stored.</td></tr>'}</tbody></table>
    </div>
    <div class="calc-card caps">
      <h3>Applied score caps</h3>
      <p class="card-note">Caps are deterministic safeguards. The final task score is the minimum of its weighted base score and every applicable cap.</p>
      <table class="compact"><thead><tr><th>Task</th><th>Reason</th><th style="text-align:right;">Cap</th><th style="text-align:right;">Formula</th><th style="text-align:right;">Score under cap</th></tr></thead><tbody>${capRows || '<tr><td colspan="5">No caps were applied; the weighted base score is retained.</td></tr>'}</tbody></table>
      <p class="compact"><strong>Final task check:</strong> ${escapeHtml(taskFinalChecks || 'No task score stored.')}</p>
    </div>
    <div class="formula">Project check: weighted task sum ${weightedSum.toFixed(2)} / total difficulty weight ${totalWeight.toFixed(2)} = <span class="verified">${scoreOutOf100(calculated)} ~= reported Base score ${scoreOutOf100(d.codeCorrectnessScore)} and Total ${scoreOutOf100(d.totalScore)}</span></div>`
}

function methodologyPage(d: CandidateReportData): string {
  return `<section class="method-page${d.kind === 'PROJECT' ? ' project-method' : ''}">
    ${d.kind === 'PROJECT' ? projectMethodology(d) : codingMethodology(d)}
    ${d.kind === 'PROJECT' ? '' : '<p class="muted compact">Our unique AI-powered proctoring system ensures assessment integrity, while AI Coding Assistant is disabled for DSA-based questions to accurately evaluate Correctness, Efficiency, Robustness, and Code Quality.</p>'}
  </section>`
}

function feedbackPage(d: CandidateReportData): string {
  if (!d.feedback) return ''
  const ratingRows = [
    ['Overall experience', d.feedback.overall_experience],
    ['Instructions and clarity', d.feedback.instructions_clarity],
    ['Difficulty and relevance', d.feedback.difficulty_relevance],
    ['Platform usability', d.feedback.platform_usability],
    ['Technical performance', d.feedback.technical_performance],
    ['Coding environment', d.feedback.coding_environment],
    ['AI coding assistant', d.feedback.ai_assistant_usefulness],
    ['Proctoring experience', d.feedback.proctoring_experience],
    ['Fairness', d.feedback.fairness],
  ].map(([label, value]) => `<tr><td>${escapeHtml(String(label))}</td><td style="text-align:right;font-weight:700;">${escapeHtml(String(value))} /5</td></tr>`).join('')
  const comments = typeof d.feedback.comments === 'string' && d.feedback.comments.trim()
    ? `<h3>Open feedback</h3><p>${escapeHtml(d.feedback.comments)}</p>`
    : ''
  const issue = [d.feedback.technical_issue_type, d.feedback.task_where_issue_occurred].filter(Boolean).map(String).join(' - ')
  return `<section class="report-page">
    <div class="page-title"><div><h1>Candidate Feedback</h1></div>${BRAND}</div>
    <div class="score-hero" style="grid-template-columns:repeat(3,1fr);">
      <div class="score-card"><div class="label">Average rating</div><div class="value">${Number(d.feedback.average_rating).toFixed(1)}<span class="score-denominator"> /5</span></div></div>
      <div class="score-card"><div class="label">Contact permission</div><div class="value" style="font-size:28px;">${d.feedback.may_contact ? 'Yes' : 'No'}</div></div>
    </div>
    <div class="summary-panel">
      <h3>Rating breakdown</h3>
      <table><tbody>${ratingRows}</tbody></table>
      ${issue ? `<h3>Reported issue context</h3><p>${escapeHtml(issue)}</p>` : ''}
      ${comments}
    </div>
  </section>`
}

export function buildCandidateReportHtml(d: CandidateReportData): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${CSS}</style></head>
<body>
  ${coverPage(d)}
  ${scoreOverviewPage(d)}
  ${methodologyPage(d)}
</body>
</html>`

}

// ─── Batch assessment report ──────────────────────────────────────────────────

export interface BatchReportData {
  assessmentTitle: string
  language: string
  timeLimitMinutes: number
  codeWeight: number
  aiuWeight: number
  llmModel: string
  generatedAt: string
  kind?: 'CODING' | 'PROJECT'
  rubricVersions?: string[]
  candidates: Array<{
    rank: number
    candidateName: string
    totalScore: number
    codeCorrectnessScore: number
    aiuTotalScore: number
    aiuScores: Record<string, number>
    rubricVersion?: string
    language: string
    timeTakenSeconds: number | null
    turnCount: number
    submittedAt: string | null
    // Per-attempt, from the session snapshot. Candidates in one batch can differ
    // if the assessment's mode was changed between their sessions, which is why
    // this lives here and not in the batch-level Assessment Configuration table.
    aiAssistantMode: string
  }>
}

function candidateSummaryRow(c: BatchReportData['candidates'][number], isProject: boolean): string {
  return `<tr>
    <td style="text-align:center;font-weight:700;">${c.rank}</td>
    <td>${escapeHtml(c.candidateName)}</td>
    <td style="text-align:right;">${scoreOutOf100(c.totalScore)}</td>
    ${isProject ? `<td style="text-align:right;">${scoreOutOf100(c.codeCorrectnessScore)}</td>` : ''}
    <td style="text-align:right;">${scoreOutOf100(c.aiuTotalScore)}</td>
    <td style="text-align:right;">${c.timeTakenSeconds !== null ? formatSeconds(c.timeTakenSeconds) : '-'}</td>
    <td style="text-align:right;">${c.turnCount}</td>
    <td>${escapeHtml(AI_ASSISTANT_MODE_LABELS[c.aiAssistantMode] ?? c.aiAssistantMode)}</td>
    <td>${escapeHtml(c.rubricVersion ?? 'LEGACY')}</td>
  </tr>`
}

function candidateDetailPage(c: BatchReportData['candidates'][number], assessmentTitle: string, isProject: boolean): string {
  return `<div class="page-break"></div>
  <div class="header">
    ${BRAND}
    <h1>${escapeHtml(assessmentTitle)}</h1>
    <div class="subtitle">Candidate Report - Rank #${c.rank}</div>
  </div>

  <h2>Candidate</h2>
  <div class="candidate-row"><strong>${escapeHtml(c.candidateName)}</strong><span class="badge badge-lang">${escapeHtml(c.language)}</span></div>
  <p class="meta">
    Submitted: ${c.submittedAt ?? '-'}
    &nbsp;·&nbsp; Duration: ${c.timeTakenSeconds !== null ? formatSeconds(c.timeTakenSeconds) : '-'}
    &nbsp;·&nbsp; AI turns: ${c.turnCount}
    &nbsp;·&nbsp; AI assistant: ${escapeHtml(AI_ASSISTANT_MODE_LABELS[c.aiAssistantMode] ?? c.aiAssistantMode)}
    &nbsp;·&nbsp; Rubric: ${escapeHtml(c.rubricVersion ?? 'LEGACY')}
  </p>

  <h2>Score Summary</h2>
  <div class="score-hero">
    <div class="score-card"><div class="label">Total Score</div><div class="value">${c.totalScore.toFixed(1)}</div><div class="unit">/100</div></div>
    ${isProject ? `<div class="score-card"><div class="label">Project Score</div><div class="value">${c.codeCorrectnessScore.toFixed(1)}</div><div class="unit">/100</div></div>` : ''}
    <div class="score-card"><div class="label">Technical Evaluation</div><div class="value">${c.aiuTotalScore.toFixed(1)}</div><div class="unit">/100</div></div>
  </div>

  <h2>Technical Evaluation</h2>
  <table>
    <thead><tr><th>Metric</th><th>Score (/100)</th><th>Progress</th></tr></thead>
    <tbody>${aiuMetricRows(c.aiuScores)}</tbody>
  </table>`
}

export function buildBatchReportHtml(d: BatchReportData): string {
  const isProject = d.kind === 'PROJECT'
  const summaryRows = d.candidates.map((c) => candidateSummaryRow(c, isProject)).join('')
  const detailPages = d.candidates.map((c) => candidateDetailPage(c, d.assessmentTitle, isProject)).join('')
  const rubricVersions = d.rubricVersions ?? [...new Set(d.candidates.map((c) => c.rubricVersion ?? 'LEGACY'))]
  const mixedRubricWarning = rubricVersions.length > 1
    ? `<div class="warning">This batch report includes multiple scoring rubrics: ${escapeHtml(rubricVersions.join(', '))}. Leaderboard comparisons may mix unlike technical evaluation methods.</div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${CSS}</style></head>
<body>
  <div class="header">
    ${BRAND}
    <h1>${escapeHtml(d.assessmentTitle)}</h1>
    <div class="subtitle">Batch Assessment Report &nbsp;·&nbsp; Generated ${d.generatedAt}</div>
  </div>

  <h2>Assessment Configuration</h2>
  <table>
    <tbody>
      <tr><td><strong>Language</strong></td><td>${escapeHtml(d.language)}</td></tr>
      <tr><td><strong>Time Limit</strong></td><td>${d.timeLimitMinutes} minutes</td></tr>
      <tr><td><strong>LLM Model</strong></td><td>${escapeHtml(d.llmModel)}</td></tr>
      ${isProject ? `<tr><td><strong>Code Weight</strong></td><td>${d.codeWeight}%</td></tr>
      <tr><td><strong>AIU Weight</strong></td><td>${d.aiuWeight}%</td></tr>` : '<tr><td><strong>Scoring</strong></td><td>Technical Evaluation only</td></tr>'}
      <tr><td><strong>Candidates Scored</strong></td><td>${d.candidates.length}</td></tr>
      <tr><td><strong>Rubric Versions</strong></td><td>${escapeHtml(rubricVersions.join(', ') || 'LEGACY')}</td></tr>
    </tbody>
  </table>
  ${mixedRubricWarning}

  <h2>Leaderboard</h2>
  <table>
    <thead>
      <tr>
        <th style="width:50px;">Rank</th>
        <th>Candidate</th>
        <th style="width:90px;text-align:right;">Total (/100)</th>
        ${isProject ? '<th style="width:90px;text-align:right;">Project (/100)</th>' : ''}
        <th style="width:90px;text-align:right;">Technical Evaluation (/100)</th>
        <th style="width:80px;text-align:right;">Time</th>
        <th style="width:60px;text-align:right;">Turns</th>
        <th style="width:90px;">AI Assistant</th>
        <th style="width:120px;">Rubric</th>
      </tr>
    </thead>
    <tbody>${summaryRows}</tbody>
  </table>

  ${detailPages}
</body>
</html>`
}

// ─── HTML escape ──────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
