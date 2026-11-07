import {
  scoreContextualRelevance,
  scoreIndependentEditing,
  scoreIterationEfficiency,
  scorePromptQuality,
  scorePromptQualityByProblem,
  type InteractionLogLike,
} from './scorers'

function log(promptText: string, responseText = ''): InteractionLogLike {
  return { promptText, responseText }
}

describe('scorePromptQuality', () => {
  test('returns 0 for an empty log', () => {
    expect(scorePromptQuality([])).toBe(0)
  })

  test('returns below 30 for a vague prompt', () => {
    expect(scorePromptQuality([log('solve this')])).toBeLessThan(30)
  })

  test('gives strong credit to a concise prompt with checkable context', () => {
    expect(scorePromptQuality([log('Fix crash when input is null; test should pass.')])).toBeGreaterThanOrEqual(80)
  })

  test('does not require polished native-English grammar', () => {
    expect(scorePromptQuality([log('Please fix function, null input crash, should return empty array')])).toBeGreaterThanOrEqual(80)
  })

  test('does not reward rubric keyword stuffing without an actionable intent', () => {
    expect(scorePromptQuality([log('clear intent relevant context specific requirements useful constraints verifiable expected output')])).toBeLessThan(30)
  })

  test('does not reward pasting the problem statement as a prompt', () => {
    const statement = 'Given an array of integers, implement a function that returns the two values whose sum equals the target input.'
    expect(scorePromptQuality([log(statement)], [statement])).toBeLessThan(30)
  })

  test('keeps a copied problem followed by a raw error in the weak range', () => {
    const statement = 'Given an array of integers, implement a function that returns the two values whose sum equals the target input.'
    expect(scorePromptQuality([log(statement), log('TypeError: cannot read property length of undefined')], [statement])).toBeLessThanOrEqual(20)
  })

  test('applies stronger percentage caps as problem copying becomes frequent', () => {
    const statement = 'Given an array of integers, implement a function that returns the two values whose sum equals the target input.'
    expect(scorePromptQuality([log(statement)], [statement])).toBeLessThanOrEqual(15)
    expect(scorePromptQuality([log(statement), log(`${statement} please`)], [statement])).toBeLessThanOrEqual(8)
    expect(scorePromptQuality([log(statement), log(`${statement} please`), log(`${statement} now`)], [statement])).toBeLessThanOrEqual(3)
  })

  test('keeps repeated raw code dumps in the lowest range', () => {
    const code = '```python\ndef solve(values):\n    return values[0]\n```'
    expect(scorePromptQuality([log(code), log(`${code}\n `), log(`${code}\n  `)])).toBeLessThanOrEqual(3)
  })

  test('distinguishes a focused diagnosis from a raw error dump', () => {
    const prompt = 'Empty input crashes at line 8. I think the loop reads index 0 before checking length. Show the smallest fix; expected result is `[]`.'
    expect(scorePromptQuality([log(prompt)])).toBeGreaterThanOrEqual(80)
  })

  test('does not reward repeating the same strong prompt', () => {
    const prompt = 'Fix crash when input is null; test should pass.'
    expect(scorePromptQuality([log(prompt), log(prompt), log(prompt)])).toBeLessThan(40)
  })

  test('rewards a concrete expected result without requiring a long prompt', () => {
    expect(scorePromptQuality([log('Change parse: input `"2"` should return 2.')])).toBeGreaterThanOrEqual(80)
  })
})

describe('scorePromptQualityByProblem', () => {
  test('equally averages only problems where AI was used', () => {
    const statements = [
      'Given an array of integers, implement a function that returns the two values whose sum equals the target input.',
      'Implement a parser that converts a numeric string to an integer and handles invalid values without throwing errors.',
      'Return the longest word from the supplied sentence while ignoring punctuation and preserving the original casing.',
    ]
    const logs: InteractionLogLike[] = [
      { ...log(statements[0]), activeFile: 'problem-01.py' },
      { ...log('Fix parser when input is null; expected result should be 0.'), activeFile: 'problem-02.py' },
    ]
    const first = scorePromptQuality([logs[0]!], [statements[0]!])
    const second = scorePromptQuality([logs[1]!], [statements[1]!])
    expect(scorePromptQualityByProblem(logs, statements)).toBe(Math.round((first + second) / 2))
  })

  test('does not count a problem with no AI interaction as zero', () => {
    const statements = ['First problem statement with enough distinct words to qualify for overlap detection here.', 'Second problem statement with enough distinct words to qualify here too.']
    const logs: InteractionLogLike[] = [{ ...log('Fix crash when input is null; test should pass.'), activeFile: 'problem-02.py' }]
    expect(scorePromptQualityByProblem(logs, statements)).toBe(scorePromptQuality(logs, [statements[1]!]))
  })
})

describe('scorePromptQuality assistant-mode evidence adapters', () => {
  test('gives Agentic and Non-Agentic the same score for the same visible context', () => {
    const logs: InteractionLogLike[] = [{
      ...log('Fix `parse_input` when input is null; expected result is 0.'),
      activeFile: 'solution.py',
      contextSnapshot: 'def parse_input(value):\n    return int(value)',
    }]
    expect(scorePromptQuality(logs, [], 'AGENTIC')).toBe(scorePromptQuality(logs, [], 'NON_AGENTIC'))
  })

  test('both modes ignore AI edits and use only the saved assistant-visible buffer', () => {
    const logs: InteractionLogLike[] = [{
      ...log('Fix `parse_input` when input is null; expected result is 0.'),
      activeFile: 'solution.py',
      contextSnapshot: 'def unrelated(value):\n    return value',
      aiEdits: { 'solution.py': { before: '', after: 'def parse_input(value):\n    return int(value)' } },
    }]
    expect(scorePromptQuality(logs, [], 'NON_AGENTIC')).toBeLessThanOrEqual(10)
    expect(scorePromptQuality(logs, [], 'AGENTIC')).toBe(scorePromptQuality(logs, [], 'NON_AGENTIC'))
  })

  test('keeps the observed vague and unrelated non-agentic session in the low range', () => {
    const statement = 'The first input line contains a fixed threshold and the number of readings. The second line contains the readings. Print how many readings are strictly greater than the threshold.'
    const contextSnapshot = 'telemetry:Count values above limit'
    const logs: InteractionLogLike[] = [
      { ...log('help me to solve this problems'), activeFile: 'solution.py', contextSnapshot: '' },
      { ...log('now i have written can you see it...help me to solve that problem'), activeFile: 'solution.py', contextSnapshot },
      { ...log('i have written problem name'), activeFile: 'solution.py', contextSnapshot },
      { ...log('what is binary search'), activeFile: 'solution.py', contextSnapshot },
    ]
    expect(scorePromptQuality(logs, [statement], 'NON_AGENTIC')).toBeLessThanOrEqual(10)
    expect(scorePromptQuality(logs, [statement], 'AGENTIC')).toBe(scorePromptQuality(logs, [statement], 'NON_AGENTIC'))
  })

  test('disabled mode does not produce a prompt-quality score', () => {
    expect(scorePromptQuality([log('Fix the parser')], [], 'DISABLED')).toBe(0)
  })
})

describe('Prompt Quality strictness evidence thresholds', () => {
  const interaction: InteractionLogLike = {
    ...log('Fix `count_values` threshold comparison because equal values are currently included; only change this function and tests should pass.'),
    activeFile: 'solution.py',
    contextSnapshot: 'def count_values(values, threshold):\n return sum(v >= threshold for v in values)',
  }

  test.each(['AGENTIC', 'NON_AGENTIC'] as const)('keeps anti-language-neutral evidence rules in %s mode', (mode) => {
    const low = scorePromptQuality([interaction], ['Count values strictly greater than a threshold.'], mode, 'LOW')
    const extraHigh = scorePromptQuality([interaction], ['Count values strictly greater than a threshold.'], mode, 'EXTRA_HIGH')
    expect(low).toBeGreaterThan(80)
    expect(extraHigh).toBeLessThanOrEqual(80)
  })
})

describe('scoreIterationEfficiency', () => {
  const problems = [{ id: 'problem-1' }]
  const timedLog = (promptText: string, minute: number): InteractionLogLike => ({
    ...log(promptText),
    activeFile: 'solution.py',
    timestamp: new Date(`2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`),
  })
  const run = (passed: number, failed: number, minute: number, codeSnapshot = '') => ({
    problemId: 'problem-1',
    status: 'completed',
    passed,
    failed,
    codeSnapshot,
    createdAt: new Date(`2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`),
  })

  test('does not reward two or three prompts without run evidence', () => {
    const logs = [timedLog('solve this', 1), timedLog('try again', 2), timedLog('fix it', 3)]
    expect(scoreIterationEfficiency(logs, [], problems)).toBeLessThanOrEqual(5)
  })

  test('caps an unchanged one-shot passing AI solution at 15', () => {
    const aiCode = 'def solve(values):\n    return sum(values)'
    const aiLog = {
      ...timedLog('write solution', 1),
      aiEdits: { 'solution.py': { before: '', after: aiCode } },
    }
    expect(scoreIterationEfficiency([aiLog], [run(2, 0, 2, aiCode)], problems, 'AGENTIC')).toBeLessThanOrEqual(15)
  })

  test('allows meaningful correction of AI code before a successful first run to earn up to 70', () => {
    const aiCode = 'def solve(value):\n    return value >= 10'
    const corrected = 'def solve(value):\n    return value > 10'
    const aiLog = {
      ...timedLog('write solution', 1),
      aiEdits: { 'solution.py': { before: '', after: aiCode } },
    }
    expect(scoreIterationEfficiency([aiLog], [run(2, 0, 2, corrected)], problems, 'AGENTIC')).toBe(70)
  })

  test('does not treat formatting, comments, or identifier renames as a meaningful correction', () => {
    const aiCode = '# note\ndef solve(values):\n    total = sum(values)\n    return total'
    const renamed = 'def solve(numbers):\n result=sum(numbers)\n return result'
    const aiLog = {
      ...timedLog('write solution', 1),
      aiEdits: { 'solution.py': { before: '', after: aiCode } },
    }
    expect(scoreIterationEfficiency([aiLog], [run(2, 0, 2, renamed)], problems, 'AGENTIC')).toBeLessThanOrEqual(15)
  })

  test('rewards a failed run followed by a focused correction and successful rerun', () => {
    const logs = [timedLog('implement parser', 1), timedLog('fix the failing empty-input case', 3)]
    expect(scoreIterationEfficiency(logs, [
      run(1, 1, 2, 'def solve(x):\n return x >= 10'),
      run(2, 0, 4, 'def solve(x):\n return x > 10'),
    ], problems)).toBeGreaterThanOrEqual(90)
  })

  test('requires a diagnosis-fix-rerun cycle above 80 at high strictness', () => {
    const oneShotLogs = [timedLog('implement and verify it', 1), timedLog('looks good', 3)]
    const oneShotRuns = [run(2, 0, 2, 'def solve(x):\n return x'), run(2, 0, 4, 'def solve(x):\n return x')]
    expect(scoreIterationEfficiency(oneShotLogs, oneShotRuns, problems, 'NON_AGENTIC', 'HIGH')).toBeLessThanOrEqual(80)

    const correctionLogs = [timedLog('implement parser', 1), timedLog('fix the failing boundary case', 3)]
    const correctionRuns = [run(1, 1, 2, 'def solve(x):\n return x >= 10'), run(2, 0, 4, 'def solve(x):\n return x > 10')]
    expect(scoreIterationEfficiency(correctionLogs, correctionRuns, problems, 'NON_AGENTIC', 'HIGH')).toBeGreaterThan(80)
  })

  test('penalizes repeated prompts that produce no new evidence', () => {
    const repeated = [timedLog('fix this error', 1), timedLog('fix this error', 2), timedLog('fix this error', 3)]
    expect(scoreIterationEfficiency(repeated, [], problems)).toBeLessThan(10)
  })

  test('caps incomplete visible tests at 30', () => {
    const logs = [timedLog('implement it', 1), timedLog('fix one case', 3)]
    expect(scoreIterationEfficiency(logs, [run(0, 2, 2), run(1, 1, 4)], problems)).toBeLessThanOrEqual(30)
  })

  test('equally averages only multi-problem files where AI was used', () => {
    const multiProblems = [{ id: 'problem-1' }, { id: 'problem-2' }, { id: 'problem-3' }]
    const logs = [
      { ...timedLog('write it', 1), activeFile: 'problem-01.py' },
      { ...timedLog('first attempt', 1), activeFile: 'problem-02.py' },
      { ...timedLog('fix failed case', 3), activeFile: 'problem-02.py' },
    ]
    const runs = [
      run(2, 0, 2),
      { ...run(1, 1, 2), problemId: 'problem-2' },
      { ...run(2, 0, 4), problemId: 'problem-2' },
    ]
    const first = scoreIterationEfficiency([logs[0]!], [runs[0]!], [multiProblems[0]!])
    const second = scoreIterationEfficiency(logs.slice(1).map((entry) => ({ ...entry, activeFile: 'solution.py' })), runs.slice(1), [multiProblems[1]!])
    expect(scoreIterationEfficiency(logs, runs, multiProblems)).toBe(Math.round((first + second) / 2))
  })

  test('returns 0 when no AI was used', () => {
    expect(scoreIterationEfficiency([], [run(2, 0, 2)], problems)).toBe(0)
  })

  test('recognizes meaningful correction of non-agentic response code before the first run', () => {
    const suggested = 'def solve(value):\n    return value >= 10'
    const interaction = {
      ...timedLog('suggest the function', 1),
      contextSnapshot: '',
      responseText: `\`\`\`python\n${suggested}\n\`\`\``,
    }
    const corrected = 'def solve(value):\n    return value > 10'
    expect(scoreIterationEfficiency([interaction], [run(2, 0, 2, corrected)], problems, 'NON_AGENTIC')).toBe(70)
  })

  test('does not reward a failure recovery without diagnostic evidence as a full cycle', () => {
    const logs = [timedLog('implement it', 1)]
    const score = scoreIterationEfficiency(logs, [
      run(1, 1, 2, 'def solve(x):\n return 0'),
      run(2, 0, 4, 'def solve(x):\n return x'),
    ], problems)
    expect(score).toBeLessThanOrEqual(50)
  })

  test('does not reward passing to manufactured failure to restored passing code', () => {
    const passing = 'def solve(x):\n return x'
    const logs = [timedLog('implement it', 1), timedLog('fix this error', 3)]
    const score = scoreIterationEfficiency(logs, [
      run(2, 0, 2, passing),
      run(0, 2, 3, 'def solve(x):\n return'),
      run(2, 0, 4, passing),
    ], problems)
    expect(score).toBeLessThanOrEqual(15)
  })

  test('returns 0 when the assistant is disabled', () => {
    expect(scoreIterationEfficiency([timedLog('help', 1)], [run(2, 0, 2)], problems, 'DISABLED')).toBe(0)
  })
})

describe('scoreIndependentEditing', () => {
  test('returns 100 when final code shares no lines with AI code blocks', () => {
    // AI block uses arrow-function style - no standalone '}' to accidentally overlap
    const logs = [
      log('help', '```ts\nconst aiVar = true\nconst aiHelper = () => aiVar\n```'),
    ]
    const finalCode = [
      'function solve(nums: number[]) {',
      '  let total = 0',
      '  for (const num of nums) total += num',
      '  return total',
      '}',
    ].join('\n')
    expect(scoreIndependentEditing(logs, finalCode)).toBe(100)
  })

  test('returns 0 when final code is 100% unmodified AI output', () => {
    const aiCode = ['function solve() {', '  return 42', '}'].join('\n')
    const logs = [log('help', `\`\`\`ts\n${aiCode}\n\`\`\``)]
    expect(scoreIndependentEditing(logs, aiCode)).toBe(0)
  })

  test('awards only 2 percent for comments, formatting, or identifier renames', () => {
    const logs: InteractionLogLike[] = [{
      ...log('write it'),
      activeFile: 'problem-01.py',
      aiEdits: {
        'problem-01.py': {
          before: '',
          after: '# explanation\ndef solve(values):\n    total = sum(values)\n    return total',
        },
      },
    }]
    const finalCode = 'def solve(numbers):\n result=sum(numbers)\n return result'
    expect(scoreIndependentEditing(logs, finalCode, 'AGENTIC')).toBe(2)
    expect(scoreIndependentEditing(logs, finalCode, 'AGENTIC', 'EXTRA_HIGH')).toBe(2)
  })

  test.each(['AGENTIC', 'NON_AGENTIC'] as const)('keeps independently replaced code high in %s mode', (mode) => {
    const aiCode = 'const aiFlag = true\nconst aiHelper = () => aiFlag'
    const finalCode = 'function solve(nums) {\n let total = 0\n for (const num of nums) total += num\n return total\n}'
    const interaction: InteractionLogLike = mode === 'AGENTIC'
      ? { ...log('write it'), activeFile: 'solution.py', aiEdits: { 'solution.py': { before: '', after: aiCode } } }
      : { ...log('write it', `\`\`\`python\n${aiCode}\n\`\`\``), activeFile: 'solution.py', contextSnapshot: '' }
    expect(scoreIndependentEditing([interaction], finalCode, mode, 'EXTRA_HIGH')).toBeGreaterThan(80)
  })

  test('a one-token change only earns local credit, not 100 percent', () => {
    const aiCode = 'def solve(values):\n    return sum(values) > 10'
    const logs: InteractionLogLike[] = [{
      ...log('write it'),
      activeFile: 'problem-01.py',
      aiEdits: { 'problem-01.py': { before: '', after: aiCode } },
    }]
    const score = scoreIndependentEditing(logs, aiCode.replace('> 10', '>= 10'), 'AGENTIC')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(20)
  })

  test('uses only the AI-added delta instead of attributing existing candidate code to AI', () => {
    const before = 'def solve(values):\n    total = sum(values)'
    const after = `${before}\n    return total`
    const logs: InteractionLogLike[] = [{
      ...log('add the return'),
      activeFile: 'problem-01.py',
      aiEdits: { 'problem-01.py': { before, after } },
    }]
    expect(scoreIndependentEditing(logs, after, 'AGENTIC')).toBeGreaterThan(50)
  })

  test('equally averages only multi-problem files where AI supplied code', () => {
    const files = {
      'problem-01.py': 'def solve():\n    return 1',
      'problem-02.py': 'def solve():\n    return 2',
      'problem-03.py': 'print("candidate only")',
    }
    const logs: InteractionLogLike[] = [
      { ...log('write it'), activeFile: 'problem-01.py', aiEdits: { 'problem-01.py': { before: '', after: files['problem-01.py'] } } },
      { ...log('help'), activeFile: 'problem-02.py', aiEdits: { 'problem-02.py': { before: 'def solve():\n    pass', after: files['problem-02.py'] } } },
    ]
    const serialized = JSON.stringify({ __multifile__: true, main: 'problem-01.py', files })
    const first = scoreIndependentEditing([logs[0]!], JSON.stringify({ __multifile__: true, main: 'problem-01.py', files: { 'problem-01.py': files['problem-01.py'] } }), 'AGENTIC')
    const second = scoreIndependentEditing([logs[1]!], JSON.stringify({ __multifile__: true, main: 'problem-02.py', files: { 'problem-02.py': files['problem-02.py'] } }), 'AGENTIC')
    expect(scoreIndependentEditing(logs, serialized, 'AGENTIC')).toBe(Math.round((first + second) / 2))
  })

  test('returns approximately 50 when half the final code lines come from AI', () => {
    // 2 of 4 final lines match AI code blocks → acceptance_ratio = 0.5 → score = 50
    const aiLines = ['const x = 1', 'const y = 2']
    const candidateLines = ['const z = 3', 'return z']
    const finalCode = [...aiLines, ...candidateLines].join('\n')
    const logs = [log('help', `\`\`\`ts\n${aiLines.join('\n')}\n\`\`\``)]
    const score = scoreIndependentEditing(logs, finalCode)
    expect(score).toBeGreaterThanOrEqual(40)
    expect(score).toBeLessThanOrEqual(60)
  })

  test('returns 0 for empty final code without crashing', () => {
    expect(scoreIndependentEditing([], '')).toBe(0)
    expect(scoreIndependentEditing([log('help', '```ts\nreturn 42\n```')], '')).toBe(0)
  })
})

describe('scoreContextualRelevance without evidence', () => {

  test('does not reward old keyword patterns without real context', () => {
    // 2 high-value, 2 low-value → score = Math.round(2/4 * 100) = 50
    const logs = [
      log('explain how this algorithm works'),
      log('solve this for me'),
      log('what is the syntax for map in Python?'),
      log('write the entire function'),
    ]
    const score = scoreContextualRelevance(logs)
    expect(score).toBeLessThanOrEqual(10)
  })

  test('returns 0 for an empty log without crashing', () => {
    expect(scoreContextualRelevance([])).toBe(0)
  })
})

describe('scoreContextualRelevance evidence scoring', () => {
  const problems = [{ id: 'problem-1', description: 'Count how many input values are strictly greater than the supplied threshold.' }]
  const contextualLog = (promptText: string): InteractionLogLike => ({
    ...log(promptText), activeFile: 'solution.py', timestamp: new Date('2026-01-01T00:02:00Z'),
  })
  const runEvent = (passed: number, failed: number, codeSnapshot: string) => ({
    problemId: 'problem-1', status: 'completed', passed, failed, codeSnapshot,
    createdAt: new Date('2026-01-01T00:01:00Z'),
  })

  test('gives fair credit to a concise task-relevant prompt', () => {
    const score = scoreContextualRelevance([contextualLog('Why values equal threshold counted?')], problems)
    expect(score).toBeGreaterThanOrEqual(40)
    expect(score).toBeLessThanOrEqual(65)
  })

  test('scores real code and failing-run evidence strongly', () => {
    const code = 'def count_values(values, threshold):\n return sum(v >= threshold for v in values)'
    const score = scoreContextualRelevance(
      [contextualLog('One test still fails; should count_values use > instead of >= for the threshold?')],
      problems, [runEvent(1, 1, code)],
    )
    expect(score).toBeGreaterThanOrEqual(80)
  })

  test('caps fabricated failure context at 10', () => {
    const code = 'def count_values(values, threshold):\n return 0'
    expect(scoreContextualRelevance(
      [contextualLog('count_values is failing every test')], problems, [runEvent(2, 0, code)],
    )).toBeLessThanOrEqual(10)
  })

  test('recognizes copied statements as limited relevance', () => {
    const description = 'Given a list of payment readings and a fixed threshold, count how many readings are strictly greater than that threshold and print the resulting count.'
    expect(scoreContextualRelevance([contextualLog(description)], [{ id: 'problem-1', description }])).toBe(15)
  })

  test('keeps an unrelated prompt in the lowest range', () => {
    expect(scoreContextualRelevance([contextualLog('Explain binary tree rotations')], problems)).toBeLessThanOrEqual(5)
  })

  test('returns 0 for no AI usage', () => {
    expect(scoreContextualRelevance([], problems)).toBe(0)
  })

  test('uses response evidence only for non-agentic contextual relevance', () => {
    const interaction = {
      ...contextualLog('Why does count_values include equal values?'),
      contextSnapshot: 'def count_values(values, threshold):\n return sum(v >= threshold for v in values)',
      responseText: 'Replace >= with > because equal values must not be counted, then run the threshold boundary test.',
    }
    expect(scoreContextualRelevance([interaction], problems, [], 'NON_AGENTIC'))
      .toBeGreaterThan(scoreContextualRelevance([interaction], problems, [], 'AGENTIC'))
  })

  test('uses exact relevant edit evidence only for agentic contextual relevance', () => {
    const interaction = {
      ...contextualLog('Fix the threshold comparison in count_values'),
      contextSnapshot: 'def count_values(values, threshold):\n return sum(v >= threshold for v in values)',
      responseText: 'Updated the file.',
      aiEdits: { 'solution.py': { before: 'return sum(v >= threshold for v in values)', after: 'return sum(v > threshold for v in values)' } },
    }
    expect(scoreContextualRelevance([interaction], problems, [], 'AGENTIC'))
      .toBeGreaterThan(scoreContextualRelevance([interaction], problems, [], 'NON_AGENTIC'))
  })

  test.each(['AGENTIC', 'NON_AGENTIC'] as const)('requires Run grounding at extra-high contextual relevance in %s mode', (mode) => {
    const interaction = {
      ...contextualLog('Fix the threshold comparison in count_values'),
      contextSnapshot: 'def count_values(values, threshold):\n return sum(v >= threshold for v in values)',
      responseText: 'Replace >= with > in count_values and run the boundary test.',
      aiEdits: { 'solution.py': { before: 'return sum(v >= threshold for v in values)', after: 'return sum(v > threshold for v in values)' } },
    }
    const high = scoreContextualRelevance([interaction], problems, [], mode, 'HIGH')
    const extraHigh = scoreContextualRelevance([interaction], problems, [], mode, 'EXTRA_HIGH')
    expect(high).toBeGreaterThanOrEqual(extraHigh)
    expect(extraHigh).toBeLessThanOrEqual(80)
  })

  test('attributes copied response code in non-agentic mode', () => {
    const code = 'def solve(values):\n    return sum(values)'
    const logs: InteractionLogLike[] = [{
      ...log('provide the function', `\`\`\`python\n${code}\n\`\`\``),
      activeFile: 'solution.py', contextSnapshot: '',
    }]
    expect(scoreIndependentEditing(logs, code, 'NON_AGENTIC')).toBe(0)
  })

  test('keeps renamed AI code with dead-code padding below 10 percent', () => {
    const aiCode = 'def solve(values):\n    return sum(values)'
    const padded = 'def solve(numbers):\n    return sum(numbers)\n\ndef unused_one(x):\n    return x * 2\n\ndef unused_two(x):\n    return x + 3\n\ndef unused_three(x):\n    return x - 4'
    const logs: InteractionLogLike[] = [{
      ...log('write it'), activeFile: 'solution.py',
      aiEdits: { 'solution.py': { before: '', after: aiCode } },
    }]
    expect(scoreIndependentEditing(logs, padded, 'AGENTIC')).toBeLessThanOrEqual(10)
  })

  test('does not silently award 100 when mode-specific provenance is absent', () => {
    expect(scoreIndependentEditing([log('explain the approach', 'Use a loop.')], 'print(42)', 'AGENTIC')).toBe(0)
  })
})
