export type InteractionLogLike = {
  promptText: string
  responseText: string
  activeFile?: string | null
  contextSnapshot?: string | null
  aiEdits?: unknown
  timestamp?: Date | string
}

type ScoredAssistantMode = 'AGENTIC' | 'NON_AGENTIC' | 'DISABLED'
type ScoringStrictness = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTRA_HIGH'

export type RunEventLike = {
  problemId: string
  status: string
  passed: number
  failed: number
  codeSnapshot?: string
  createdAt: Date | string
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left))
  const rightTokens = new Set(tokenize(right))

  if (leftTokens.size === 0 && rightTokens.size === 0) return 1
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size

  return union === 0 ? 0 : intersection / union
}

function tokenCoverage(text: string, reference: string): number {
  const textTokens = new Set(tokenize(text))
  const referenceTokens = new Set(tokenize(reference))
  if (referenceTokens.size === 0) return 0
  return [...referenceTokens].filter((token) => textTokens.has(token)).length / referenceTokens.size
}

function extractCodeBlocks(text: string): string[] {
  return [...text.matchAll(/```(?:\w+)?\n?([\s\S]*?)```/g)].map((match) => match[1] ?? '')
}

function extractSuggestedCode(text: string): string[] {
  const fenced = extractCodeBlocks(text).filter((block) => semanticTokens(block).length >= 3)
  if (fenced.length > 0) return fenced
  const inline = text.split(/\r?\n/).filter((line) =>
    /(?:^\s*(?:def|class|function|const|let|var|if|for|while|return|import|from)\b)|[{};]|(?:=>)/.test(line),
  )
  return inline.length >= 2 && semanticTokens(inline.join('\n')).length >= 6 ? [inline.join('\n')] : []
}

const CODE_KEYWORDS = new Set([
  'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'def', 'default', 'del', 'do', 'else', 'elif', 'except', 'export', 'extends', 'false',
  'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'interface',
  'lambda', 'let', 'new', 'none', 'not', 'null', 'of', 'or', 'pass', 'raise', 'return',
  'static', 'switch', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'while', 'with',
  'yield',
])

function semanticTokens(code: string): string[] {
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/^\s*#.*$/gm, ' ')
  const lexemes = withoutComments.match(
    /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(?:\d+(?:\.\d+)?)|(?:[A-Za-z_$][\w$]*)|(?:===|!==|==|!=|<=|>=|=>|\+\+|--|&&|\|\||\*\*|\/\/|<<|>>|[-+*/%<>=!&|^~?:])/g,
  ) ?? []
  return lexemes.map((token) => {
    if (/^[A-Za-z_$]/.test(token)) {
      const lower = token.toLowerCase()
      return CODE_KEYWORDS.has(lower) ? lower : 'IDENTIFIER'
    }
    if (/^\d/.test(token)) return `NUMBER:${token}`
    if (/^["'`]/.test(token)) return `STRING:${token}`
    return token
  })
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

function tokenFingerprints(code: string): string[] {
  const tokens = semanticTokens(code)
  if (tokens.length < 3) return tokens
  return tokens.slice(0, -2).map((_, index) => tokens.slice(index, index + 3).join('\u0000'))
}

function addedTokenCounts(before: string, after: string): Map<string, number> {
  const beforeCounts = tokenCounts(semanticTokens(before))
  const afterCounts = tokenCounts(semanticTokens(after))
  for (const [token, count] of beforeCounts) {
    const remaining = (afterCounts.get(token) ?? 0) - count
    if (remaining > 0) afterCounts.set(token, remaining)
    else afterCounts.delete(token)
  }
  return afterCounts
}

function parseFinalFiles(finalCode: string): Record<string, string> {
  try {
    const parsed = JSON.parse(finalCode) as { __multifile__?: boolean; main?: string; files?: unknown }
    if (parsed.__multifile__ && parsed.files && typeof parsed.files === 'object') {
      return Object.fromEntries(
        Object.entries(parsed.files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    }
  } catch { /* legacy single-file code */ }
  return { __single__: finalCode }
}

function parseAiEdits(value: unknown): Record<string, { before: string; after: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(
    (entry): entry is [string, { before: string; after: string }] => {
      const edit = entry[1]
      return !!edit && typeof edit === 'object'
        && typeof (edit as { before?: unknown }).before === 'string'
        && typeof (edit as { after?: unknown }).after === 'string'
    },
  ))
}

function codeForProblemSnapshot(snapshot: string | undefined, problemIndex: number): string {
  if (!snapshot) return ''
  const files = parseFinalFiles(snapshot)
  const numbered = Object.entries(files).find(([file]) =>
    new RegExp(`(?:^|/)problem-${String(problemIndex + 1).padStart(2, '0')}\\.(?:py|js|ts)$`, 'i').test(file),
  )
  if (numbered) return numbered[1]
  return Object.keys(files).length === 1 ? Object.values(files)[0] ?? '' : ''
}

export function scorePromptQuality(
  logs: InteractionLogLike[],
  problemStatements: string[] = [],
  mode: ScoredAssistantMode = 'NON_AGENTIC',
  strictness: ScoringStrictness = 'MEDIUM',
): number {
  if (logs.length === 0) return 0
  if (mode === 'DISABLED') return 0

  let copiedProblemCount = 0
  let delegatedSolutionCount = 0
  let rawCodeCount = 0
  let rawErrorCount = 0
  let duplicateCount = 0

  const scores = logs.map((log, index) => {
    const prompt = log.promptText.trim()
    if (!prompt) return 0
    const matchedStatement = problemStatements.find(
      (statement) => tokenize(statement).length >= 12 && tokenCoverage(prompt, statement) >= 0.5,
    )
    const copiedProblemStatement = matchedStatement !== undefined
      && tokenCoverage(prompt, matchedStatement) >= 0.8
    if (copiedProblemStatement) copiedProblemCount += 1

    const repeatedPrompt = logs.slice(0, index).some(
      (prior) => jaccardSimilarity(prior.promptText, prompt) >= 0.9,
    )
    if (repeatedPrompt) duplicateCount = Math.max(duplicateCount, 2)
    if (repeatedPrompt) duplicateCount += index > 1 ? 1 : 0

    const delegatesSolution = /\b(solve|complete|implement|write|give|provide|generate)\b[\s\S]{0,30}\b(entire|full|whole|solution|code|function|program|problem)\b|\bhelp me (?:to )?solve\b|\bdo (?:it|this) for me\b/i.test(prompt)
    if (delegatesSolution) delegatedSolutionCount += 1

    const codeBlocks = extractCodeBlocks(prompt)
    const codeLikeLines = prompt.split(/\r?\n/).filter((line) => /[{}();]|\b(def|class|function|const|let|var|return|import|from)\b/.test(line)).length
    let authoredText = prompt.replace(/```(?:\w+)?\n?[\s\S]*?```/g, ' ')
    if (matchedStatement) {
      const copiedTokens = new Set(tokenize(matchedStatement))
      authoredText = tokenize(authoredText).filter((token) => !copiedTokens.has(token)).join(' ')
    }
    const actionIntent = /\b(fix|debug|change|add|remove|explain|check|review|compare|find|show|help|why|how|what|identify|diagnose|investigate|verify)\b/i.test(authoredText)
    const focusedTarget = /\b(error|exception|fail(?:s|ed|ing)?|crash(?:es|ed|ing)?|function|method|class|loop|input|output|null|undefined|timeout|condition|comparison|operator|case|line|return|parser|threshold)\b|`[^`]+`|(?:===|!==|==|!=|<=|>=|>|<)/i.test(authoredText)
    const rawCode = (codeBlocks.length > 0 || codeLikeLines >= 3) && (!actionIntent || !focusedTarget) && tokenize(authoredText).length < 8
    if (rawCode) rawCodeCount += 1

    const containsErrorEvidence = /\b(error|exception|traceback|stack trace|failed|failure|segmentation fault|timeout)\b/i.test(prompt)
    const rawError = containsErrorEvidence && (!actionIntent || !focusedTarget)
    if (rawError) rawErrorCount += 1

    // Prompt quality uses the same rubric in both modes. The exact buffer that
    // the assistant saw may validate candidate claims, but its mere presence
    // never earns context points and AI-generated edits never count as input.
    const availableContext = log.contextSnapshot ?? ''
    const availableIdentifiers = new Set((availableContext.match(/[A-Za-z_$][\w$]*/g) ?? [])
      .filter((identifier) => !CODE_KEYWORDS.has(identifier.toLowerCase()) && identifier.length > 1))
    const claimedIdentifiers = [...authoredText.matchAll(/`([A-Za-z_$][\w$]*)`|\b([A-Za-z_$][\w$]*_[A-Za-z_$][\w$]*)\b/g)]
      .map((match) => match[1] ?? match[2] ?? '')
      .filter(Boolean)
    const realIdentifier = claimedIdentifiers.some((identifier) => availableIdentifiers.has(identifier))
    const fabricatedIdentifier = availableContext.length > 0 && claimedIdentifiers.length > 0 && !realIdentifier

    const descriptionTokens = new Set(problemStatements.flatMap((statement) => tokenize(statement).filter((token) => token.length > 3)))
    const taskMatches = tokenize(authoredText).filter((token) => descriptionTokens.has(token)).length
    const observedBehavior = /\b(error|exception|fail(?:s|ed|ing)?|crash(?:es|ed|ing)?|wrong|actual|currently|instead|includes?|excludes?|returns?)\b/i.test(authoredText)
    const reasoning = /\b(because|maybe|likely|seems?|suspect|think|caused?|due to|instead of|trade.?off|should use|rather than)\b|(?:===|!==|==|!=|<=|>=|>|<)[\s\S]{0,20}(?:instead|should|rather)/i.test(authoredText)
    const constraint = /\b(without|only|must|at most|at least|edge case|complexity|performance|memory|smallest|minimal|do not|don'?t)\b|O\s*\([^)]+\)/i.test(authoredText)
    const concreteExpected = /\b(return|output|produce|result|expected)\b[\s\S]{0,35}(?:\b\d+\b|\btrue\b|\bfalse\b|\bnull\b|\bnone\b|\bempty\b|\[\]|["'`][^"'`]+["'`])|(?:=>|->)\s*\S+/i.test(authoredText)
    const generalExpected = /\b(pass(?:es|ed)?|test|should work|correct result|no error|resolve(?:s|d)? the error)\b/i.test(authoredText)
    const vagueOnly = !focusedTarget && !observedBehavior && !realIdentifier && taskMatches === 0

    const intentLevel = delegatesSolution ? 0 : actionIntent || /\?/.test(authoredText) ? (vagueOnly ? 1 : 2) : 0
    const contextLevel = fabricatedIdentifier ? 0
      : (realIdentifier || (observedBehavior && (taskMatches > 0 || focusedTarget))) ? 2
        : focusedTarget || taskMatches > 0 ? 1 : 0
    const requirementLevel = delegatesSolution ? 0 : realIdentifier || (focusedTarget && actionIntent) ? 2
      : actionIntent && !vagueOnly ? 1 : 0
    const constraintLevel = constraint ? (focusedTarget || realIdentifier ? 2 : 1) : null
    const reasoningLevel = reasoning ? (focusedTarget || realIdentifier ? 2 : 1)
      : observedBehavior ? 1 : null
    const verifiabilityLevel = concreteExpected ? 2 : generalExpected ? 1 : 0
    const levels = [intentLevel, contextLevel, requirementLevel, verifiabilityLevel, constraintLevel, reasoningLevel]
      .filter((value): value is number => value !== null)
    let componentScore = levels.length > 0
      ? clampScore((levels.reduce((sum, value) => sum + value, 0) / (levels.length * 2)) * 100)
      : 0

    const rubricTerms = authoredText.match(/\b(intent|context|requirements?|constraints?|verifiable|expected output|engineering reasoning)\b/gi)?.length ?? 0
    if (!actionIntent && rubricTerms >= 3) componentScore = Math.min(componentScore, 10)
    if (fabricatedIdentifier) componentScore = Math.min(componentScore, 10)
    if (problemStatements.length > 0 && taskMatches === 0 && !realIdentifier && !observedBehavior) componentScore = Math.min(componentScore, 5)
    // Strictness changes the evidence needed to enter the highest band; it
    // never changes anti-gaming caps, language expectations, or rubric weights.
    if (componentScore > 80 && strictness === 'MEDIUM' && !(contextLevel >= 1 && requirementLevel === 2)) {
      componentScore = 80
    }
    if (componentScore > 80 && strictness === 'HIGH' && !(contextLevel === 2 && requirementLevel === 2 && verifiabilityLevel >= 1)) {
      componentScore = 80
    }
    if (componentScore > 80 && strictness === 'EXTRA_HIGH'
      && !(contextLevel === 2 && requirementLevel === 2 && reasoningLevel !== null && reasoningLevel >= 1 && verifiabilityLevel === 2)) {
      componentScore = 80
    }
    return componentScore
  })

  let score = clampScore(scores.reduce((sum, value) => sum + value, 0) / scores.length)
  const applyFrequencyCap = (count: number, once: number, twice: number, frequent: number) => {
    if (count >= 3) score = Math.min(score, frequent)
    else if (count === 2) score = Math.min(score, twice)
    else if (count === 1) score = Math.min(score, once)
  }

  // Frequency bands keep the percentage contract while preventing one polished
  // follow-up from washing away copied/delegated prompts elsewhere in the session.
  applyFrequencyCap(copiedProblemCount, 15, 8, 3)
  applyFrequencyCap(delegatedSolutionCount, 10, 5, 2)
  applyFrequencyCap(rawCodeCount, 15, 8, 3)
  applyFrequencyCap(rawErrorCount, 20, 12, 5)
  applyFrequencyCap(duplicateCount, 15, 8, 3)
  return score
}

export function scorePromptQualityByProblem(
  logs: InteractionLogLike[],
  problemStatements: string[],
  mode: ScoredAssistantMode = 'NON_AGENTIC',
  strictness: ScoringStrictness = 'MEDIUM',
): number {
  if (logs.length === 0) return 0
  if (problemStatements.length <= 1) return scorePromptQuality(logs, problemStatements, mode, strictness)

  const groups = new Map<number, InteractionLogLike[]>()
  for (const log of logs) {
    const normalized = log.activeFile?.replace(/\\/g, '/') ?? ''
    const match = /(?:^|\/)problem-(\d+)\.(?:py|js|ts)$/i.exec(normalized)
    if (!match) continue
    const problemIndex = Number(match[1]) - 1
    if (problemIndex < 0 || problemIndex >= problemStatements.length) continue
    const group = groups.get(problemIndex) ?? []
    group.push(log)
    groups.set(problemIndex, group)
  }

  // Legacy logs predate active-file capture. Preserve their former session-level
  // evaluation rather than converting existing candidates to zero.
  if (groups.size === 0) return scorePromptQuality(logs, problemStatements, mode, strictness)

  const perProblemScores = [...groups.entries()].map(([index, problemLogs]) =>
    scorePromptQuality(problemLogs, [problemStatements[index] ?? ''], mode, strictness),
  )
  return clampScore(perProblemScores.reduce((sum, value) => sum + value, 0) / perProblemScores.length)
}

export function scoreIterationEfficiency(
  logs: InteractionLogLike[],
  runEvents: RunEventLike[],
  problems: Array<{ id: string }>,
  mode: ScoredAssistantMode = 'NON_AGENTIC',
  strictness: ScoringStrictness = 'MEDIUM',
): number {
  if (logs.length === 0) return 0
  if (mode === 'DISABLED') return 0

  const problemLogs = new Map<number, InteractionLogLike[]>()
  for (const log of logs) {
    let index = 0
    if (problems.length > 1) {
      const match = /(?:^|\/)problem-(\d+)\.(?:py|js|ts)$/i.exec(log.activeFile?.replace(/\\/g, '/') ?? '')
      if (!match) continue
      index = Number(match[1]) - 1
    }
    if (index < 0 || index >= problems.length) continue
    const grouped = problemLogs.get(index) ?? []
    grouped.push(log)
    problemLogs.set(index, grouped)
  }

  // Preserve legacy single-problem transcripts even when the problem metadata
  // is unavailable, but never infer efficiency from prompt count alone.
  if (problemLogs.size === 0 && problems.length <= 1) problemLogs.set(0, logs)

  const scores: number[] = []
  for (const [problemIndex, logsForProblem] of problemLogs) {
    const problemId = problems[problemIndex]?.id
    const runs = runEvents
      .filter((run) => run.problemId === problemId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const orderedLogs = [...logsForProblem].sort((a, b) =>
      new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime(),
    )

    const rates = runs.map((run) => {
      const total = run.passed + run.failed
      return run.status === 'completed' && total > 0 ? run.passed / total : 0
    })
    let previousRate = 0
    let positiveProgress = 0
    let regressions = 0
    for (const rate of rates) {
      if (rate > previousRate) positiveProgress += rate - previousRate
      else if (rate < previousRate) regressions += 1
      previousRate = rate
    }
    const progress = Math.max(0, 40 * Math.min(1, positiveProgress) - regressions * 5)

    let verifiedTurns = 0
    let promptsBeforeAnotherPromptWithoutRun = 0
    for (let index = 0; index < orderedLogs.length; index++) {
      const currentTime = new Date(orderedLogs[index]?.timestamp ?? 0).getTime()
      const nextTime = index + 1 < orderedLogs.length
        ? new Date(orderedLogs[index + 1]?.timestamp ?? 0).getTime()
        : Number.POSITIVE_INFINITY
      const followedByRun = runs.some((run) => {
        const runTime = new Date(run.createdAt).getTime()
        return runTime >= currentTime && runTime < nextTime
      })
      if (followedByRun) verifiedTurns += 1
      else if (index + 1 < orderedLogs.length) promptsBeforeAnotherPromptWithoutRun += 1
    }

    const verificationBase = 15 * (verifiedTurns / Math.max(1, orderedLogs.length))
    let genuineCorrection = false
    let ungroundedRecovery = false
    for (let index = 0; index < runs.length - 1; index++) {
      const failingRun = runs[index]!
      const improvedRun = runs.slice(index + 1).find((run) => {
        const total = run.passed + run.failed
        const rate = run.status === 'completed' && total > 0 ? run.passed / total : 0
        return rate > (rates[index] ?? 0)
      })
      if ((rates[index] ?? 0) >= 1 || !improvedRun) continue
      const from = new Date(failingRun.createdAt).getTime()
      const to = new Date(improvedRun.createdAt).getTime()
      const diagnostic = orderedLogs.some((log) => {
        const time = new Date(log.timestamp ?? 0).getTime()
        return time > from && time < to
          && /\b(fail(?:s|ed|ing)?|error|wrong|exception|crash|test|case|debug|why|fix|diagnos)\b/i.test(log.promptText)
      })
      const beforeCode = codeForProblemSnapshot(failingRun.codeSnapshot, problemIndex)
      const afterCode = codeForProblemSnapshot(improvedRun.codeSnapshot, problemIndex)
      const meaningfulFix = beforeCode.length > 0 && afterCode.length > 0
        && semanticTokens(beforeCode).join('\u0000') !== semanticTokens(afterCode).join('\u0000')
      if (diagnostic && meaningfulFix) genuineCorrection = true
      else ungroundedRecovery = true
    }
    const verification = verificationBase + (genuineCorrection ? 15 : 0)

    const finalRate = rates.at(-1) ?? 0
    const nonRegressiveTransitions = rates.length <= 1
      ? rates.length
      : rates.slice(1).filter((rate, index) => rate >= (rates[index] ?? 0)).length
    const transitionCount = Math.max(1, rates.length - 1)
    const convergence = finalRate * 15 + 5 * (nonRegressiveTransitions / transitionCount)

    let repeatedPrompts = 0
    for (let index = 1; index < orderedLogs.length; index++) {
      if (orderedLogs.slice(0, index).some((prior) =>
        jaccardSimilarity(prior.promptText, orderedLogs[index]?.promptText ?? '') >= 0.9,
      )) repeatedPrompts += 1
    }
    const economy = Math.max(0, 10 - repeatedPrompts * 3 - promptsBeforeAnotherPromptWithoutRun * 2)

    let meaningfulCorrectionBeforeFirstRun = false
    const firstRun = runs[0]
    if (firstRun && finalRate === 1) {
      const firstRunTime = new Date(firstRun.createdAt).getTime()
      const latestAiOutput = [...orderedLogs].reverse().find((log) => {
        if (new Date(log.timestamp ?? 0).getTime() > firstRunTime) return false
        return mode === 'AGENTIC'
          ? Object.keys(parseAiEdits(log.aiEdits)).length > 0
          : extractSuggestedCode(log.responseText).length > 0
      })
      if (latestAiOutput) {
        const edits = mode === 'AGENTIC' ? parseAiEdits(latestAiOutput.aiEdits) : {}
        const activeFile = latestAiOutput.activeFile ?? ''
        const aiCode = mode === 'AGENTIC'
          ? edits[activeFile]?.after ?? Object.values(edits)[0]?.after ?? ''
          : extractSuggestedCode(latestAiOutput.responseText)[0] ?? ''
        const runCode = codeForProblemSnapshot(firstRun.codeSnapshot, problemIndex)
        meaningfulCorrectionBeforeFirstRun = aiCode.length > 0 && runCode.length > 0
          && semanticTokens(aiCode).join('\u0000') !== semanticTokens(runCode).join('\u0000')
      }
    }

    let score = clampScore(progress + verification + convergence + economy)
    const manufacturedFailure = runs.length >= 3 && rates[0] === 1
      && rates.slice(1, -1).some((rate) => rate < 1) && rates.at(-1) === 1
      && semanticTokens(codeForProblemSnapshot(runs[0]!.codeSnapshot, problemIndex)).join('\u0000')
        === semanticTokens(codeForProblemSnapshot(runs.at(-1)!.codeSnapshot, problemIndex)).join('\u0000')
    if (manufacturedFailure) score = Math.min(score, 15)
    else if (ungroundedRecovery && !genuineCorrection) score = Math.min(score, 50)
    if (runs.length === 0) score = Math.min(score, 5)
    else if (runs.length === 1) score = Math.min(score, meaningfulCorrectionBeforeFirstRun ? 70 : 15)
    if (finalRate < 1) score = Math.min(score, 30)
    if (score > 80 && strictness === 'HIGH' && !genuineCorrection) score = 80
    if (score > 80 && strictness === 'EXTRA_HIGH' && !(genuineCorrection && finalRate === 1)) score = 80
    scores.push(score)
  }

  if (scores.length === 0) return 0
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length)
}

export function scoreIndependentEditing(
  logs: InteractionLogLike[],
  finalCode: string,
  mode: ScoredAssistantMode = 'NON_AGENTIC',
  strictness: ScoringStrictness = 'MEDIUM',
): number {
  if (mode === 'DISABLED' || logs.length === 0) return 0
  const finalFiles = parseFinalFiles(finalCode)
  const aiTokensByFile = new Map<string, Map<string, number>>()
  const legacyFingerprintsByFile = new Map<string, Map<string, number>>()
  const latestAiCodeByFile = new Map<string, string>()

  const addSource = (target: Map<string, Map<string, number>>, file: string, counts: Map<string, number>) => {
    const combined = target.get(file) ?? new Map<string, number>()
    for (const [token, count] of counts) combined.set(token, (combined.get(token) ?? 0) + count)
    target.set(file, combined)
  }

  for (const log of logs) {
    const edits = mode === 'AGENTIC' ? parseAiEdits(log.aiEdits) : {}
    for (const [file, edit] of Object.entries(edits)) {
      addSource(aiTokensByFile, file, addedTokenCounts(edit.before, edit.after))
      latestAiCodeByFile.set(file, edit.after)
    }

    // A Non-Agentic assistant cannot edit files. Infer only code that was newly
    // suggested relative to the exact buffer it saw; pre-existing candidate
    // code in a full-file response must not be attributed back to the AI.
    if (mode === 'NON_AGENTIC') {
      const file = log.activeFile && finalFiles[log.activeFile] !== undefined
        ? log.activeFile
        : Object.keys(finalFiles).length === 1 ? Object.keys(finalFiles)[0]! : ''
      if (file) {
        for (const block of extractSuggestedCode(log.responseText)) {
          addSource(aiTokensByFile, file, addedTokenCounts(log.contextSnapshot ?? '', block))
          addSource(legacyFingerprintsByFile, file, tokenCounts(tokenFingerprints(block)))
          latestAiCodeByFile.set(file, block)
        }
      }
    }
  }

  const perFileScores: number[] = []
  const attributedFiles = new Set([...aiTokensByFile.keys(), ...legacyFingerprintsByFile.keys()])
  for (const file of attributedFiles) {
    const code = finalFiles[file] ?? (Object.keys(finalFiles).length === 1 ? Object.values(finalFiles)[0] : undefined)
    if (code === undefined) continue
    const finalCounts = tokenCounts(semanticTokens(code))
    const total = [...finalCounts.values()].reduce((sum, count) => sum + count, 0)
    if (total === 0) continue
    let survivingAiTokens = 0
    const aiCounts = aiTokensByFile.get(file) ?? new Map<string, number>()
    for (const [token, count] of aiCounts) {
      survivingAiTokens += Math.min(count, finalCounts.get(token) ?? 0)
    }
    const aiTokenTotal = [...aiCounts.values()].reduce((sum, count) => sum + count, 0)
    const aiSurvival = aiTokenTotal > 0 ? survivingAiTokens / aiTokenTotal : 0
    let acceptanceRatio = aiTokenTotal > 0 && aiSurvival >= 0.7 ? survivingAiTokens / total : 0

    const legacyCounts = legacyFingerprintsByFile.get(file)
    if (legacyCounts) {
      const finalFingerprints = tokenCounts(tokenFingerprints(code))
      const fingerprintTotal = [...finalFingerprints.values()].reduce((sum, count) => sum + count, 0)
      let survivingFingerprints = 0
      for (const [fingerprint, count] of legacyCounts) {
        survivingFingerprints += Math.min(count, finalFingerprints.get(fingerprint) ?? 0)
      }
      const sourceFingerprintTotal = [...legacyCounts.values()].reduce((sum, count) => sum + count, 0)
      const sourceCoverage = sourceFingerprintTotal > 0 ? survivingFingerprints / sourceFingerprintTotal : 0
      if (fingerprintTotal > 0 && sourceCoverage >= 0.7) {
        acceptanceRatio = Math.max(acceptanceRatio, survivingFingerprints / fingerprintTotal)
      }
    }
    let fileScore = clampScore((1 - Math.min(1, acceptanceRatio)) * 100)
    // Extra wrappers, unused helpers, imports, or boilerplate must not turn an
    // otherwise preserved AI solution into apparently independent work.
    if (aiTokenTotal >= 6 && aiSurvival >= 0.9 && total > aiTokenTotal * 2) fileScore = Math.min(fileScore, 10)
    // A superficial edit remains almost entirely AI-authored, but 2% makes the
    // detected activity observable without allowing it to inflate independence.
    const latestAiCode = latestAiCodeByFile.get(file)
    if (fileScore === 0 && latestAiCode !== undefined && code.trim() !== latestAiCode.trim()) fileScore = 2
    // Trivial changes stay at 2% under every profile. Higher profiles require
    // stronger replacement evidence before entering the highest band.
    if (fileScore > 2 && fileScore <= 30 && strictness === 'HIGH') fileScore = Math.min(fileScore, 15)
    if (fileScore > 2 && fileScore <= 30 && strictness === 'EXTRA_HIGH') fileScore = Math.min(fileScore, 10)
    perFileScores.push(fileScore)
  }

  if (perFileScores.length === 0) return 0
  return clampScore(perFileScores.reduce((sum, score) => sum + score, 0) / perFileScores.length)
}

export function scoreContextualRelevance(
  logs: InteractionLogLike[],
  problems: Array<{ id: string; description: string }> = [],
  runEvents: RunEventLike[] = [],
  mode: ScoredAssistantMode = 'NON_AGENTIC',
  strictness: ScoringStrictness = 'MEDIUM',
): number {
  if (logs.length === 0) return 0
  if (mode === 'DISABLED') return 0
  const effectiveProblems = problems.length > 0 ? problems : [{ id: '__single__', description: '' }]
  const groups = new Map<number, InteractionLogLike[]>()
  for (const log of logs) {
    let index = 0
    if (effectiveProblems.length > 1) {
      const match = /(?:^|\/)problem-(\d+)\.(?:py|js|ts)$/i.exec(log.activeFile?.replace(/\\/g, '/') ?? '')
      if (!match) continue
      index = Number(match[1]) - 1
    }
    if (index < 0 || index >= effectiveProblems.length) continue
    const grouped = groups.get(index) ?? []
    grouped.push(log)
    groups.set(index, grouped)
  }
  if (groups.size === 0) return 0

  const perProblemScores: number[] = []
  for (const [problemIndex, problemLogs] of groups) {
    const problem = effectiveProblems[problemIndex]!
    const orderedLogs = [...problemLogs].sort((a, b) =>
      new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime(),
    )
    const problemRuns = runEvents
      .filter((run) => run.problemId === problem.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    let copiedCount = 0
    let genericCount = 0
    let fabricatedCount = 0
    let repeatedCount = 0

    const scores = orderedLogs.map((log, logIndex) => {
      const prompt = log.promptText.trim()
      if (!prompt) return 0
      const promptTokens = new Set(tokenize(prompt))
      const descriptionTokens = new Set(tokenize(problem.description).filter((token) => token.length > 2))
      const taskMatches = [...descriptionTokens].filter((token) => promptTokens.has(token)).length
      const copied = descriptionTokens.size >= 12 && tokenCoverage(prompt, problem.description) >= 0.8
      const generic = /^(please\s+)?(help|solve(?: this)?|fix(?: it| this)?|write (?:the )?(?:code|solution))[.!?]*$/i.test(prompt)

      let score = copied ? 35 : generic ? 20 : taskMatches >= 2 ? 40 : taskMatches === 1 ? 25 : 5
      if (copied) copiedCount += 1
      if (generic) genericCount += 1

      const logTime = new Date(log.timestamp ?? 0).getTime()
      const latestRun = [...problemRuns].reverse().find((run) => new Date(run.createdAt).getTime() <= logTime)
      // Both modes use the exact assistant-visible buffer. Agentic mode may
      // additionally use exact tool edits; Non-Agentic mode must instead judge
      // whether the textual response is grounded and actionable.
      const edits = mode === 'AGENTIC' ? parseAiEdits(log.aiEdits) : {}
      const contextCode = log.contextSnapshot
        ?? (latestRun ? codeForProblemSnapshot(latestRun.codeSnapshot, problemIndex) : '')
        ?? ''
      const identifiers = new Set((contextCode.match(/[A-Za-z_$][\w$]*/g) ?? [])
        .filter((identifier) => !CODE_KEYWORDS.has(identifier.toLowerCase()) && identifier.length > 1))
      const mentionsIdentifier = [...identifiers].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prompt),
      )
      const mentionsExistingOperator = /(?:===|!==|==|!=|<=|>=|>|<)/.test(prompt)
        && (prompt.match(/(?:===|!==|==|!=|<=|>=|>|<)/)?.some((operator) => contextCode.includes(operator)) ?? false)
      if (mentionsIdentifier) score += 25
      else if (mentionsExistingOperator) score += 15

      const claimsFailure = /\b(fail(?:s|ed|ing)?|error|exception|crash|timeout|wrong)\b/i.test(prompt)
      const mentionsTesting = claimsFailure || /\b(test|case|pass(?:es|ed|ing)?)\b/i.test(prompt)
      if (latestRun && mentionsTesting) {
        const actuallyFailed = latestRun.status !== 'completed' || latestRun.failed > 0
        if (claimsFailure && !actuallyFailed) {
          fabricatedCount += 1
          score = Math.min(score, 10)
        } else {
          score += 20
        }
      }

      const continuity = logIndex > 0 && /\b(after|still|previous|earlier|change|edit|suggestion|instead|now|that|this)\b/i.test(prompt)
      if (continuity) score += 15

      if (mode === 'AGENTIC') {
        const normalizedActiveFile = log.activeFile?.replace(/\\/g, '/')
        const relevantEdit = normalizedActiveFile ? edits[normalizedActiveFile] ?? edits[log.activeFile ?? ''] : undefined
        if (relevantEdit) {
          score += semanticTokens(relevantEdit.before).join(' ') === semanticTokens(relevantEdit.after).join(' ') ? 5 : 25
        }
        const exactGrounding = mentionsIdentifier || mentionsExistingOperator
        const verifiedGrounding = latestRun !== undefined && mentionsTesting
        if (score > 80 && strictness === 'HIGH' && !(exactGrounding && relevantEdit)) score = 80
        if (score > 80 && strictness === 'EXTRA_HIGH' && !(exactGrounding && relevantEdit && verifiedGrounding)) score = 80
      } else {
        const response = log.responseText.trim()
        const responseAlignment = response.length > 0
          && (jaccardSimilarity(prompt, response) >= 0.08
            || [...promptTokens].some((token) => token.length > 3 && tokenize(response).includes(token)))
        const actionableResponse = extractCodeBlocks(response).length > 0
          || /\b(change|replace|use|return|check|compare|because|instead|fix|test|run|should)\b/i.test(response)
        if (responseAlignment) score += 15
        if (actionableResponse) score += 10
        const exactGrounding = mentionsIdentifier || mentionsExistingOperator
        const verifiedGrounding = latestRun !== undefined && mentionsTesting
        if (score > 80 && strictness === 'HIGH' && !(exactGrounding && responseAlignment && actionableResponse)) score = 80
        if (score > 80 && strictness === 'EXTRA_HIGH'
          && !(exactGrounding && responseAlignment && actionableResponse && verifiedGrounding)) score = 80
      }

      const repeated = orderedLogs.slice(0, logIndex).some((prior) => jaccardSimilarity(prior.promptText, prompt) >= 0.9)
      if (repeated) {
        repeatedCount += 1
        score -= repeatedCount === 1 ? 5 : 10
      }
      return clampScore(score)
    })

    let problemScore = clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    if (copiedCount >= 3) problemScore = Math.min(problemScore, 3)
    else if (copiedCount === 2) problemScore = Math.min(problemScore, 8)
    else if (copiedCount === 1) problemScore = Math.min(problemScore, 15)
    if (genericCount >= 3) problemScore = Math.min(problemScore, 10)
    else if (genericCount === 2) problemScore = Math.min(problemScore, 15)
    if (fabricatedCount >= 3) problemScore = 0
    else if (fabricatedCount === 2) problemScore = Math.min(problemScore, 5)
    else if (fabricatedCount === 1) problemScore = Math.min(problemScore, 10)
    if (repeatedCount >= 3) problemScore = Math.min(problemScore, 25)
    perProblemScores.push(problemScore)
  }

  return clampScore(perProblemScores.reduce((sum, score) => sum + score, 0) / perProblemScores.length)
}
