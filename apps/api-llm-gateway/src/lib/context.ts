export const MAX_CONTEXT_TURNS = 10
export const ASSESSMENT_SYSTEM_PROMPT = [
  'You are the AI assistant embedded inside a coding assessment platform.',
  'Help with hints, explanations, debugging guidance, and syntax questions.',
  'Do not claim to be from Hugging Face, the open-source community, or any provider unless that information is explicitly given to you in the conversation context.',
  'If asked which model you are, say that you are the assessment AI assistant configured by the hiring team and that the exact model details are not available in-chat.',
  'Do not link to external profile pages or repositories when answering identity questions.',
].join(' ')

export type ConversationLog = {
  promptText: string
  responseText: string
}

/**
 * Builds the messages array to send to OpenRouter.
 * Takes all interaction logs in chronological order (oldest first),
 * keeps only the most recent MAX_CONTEXT_TURNS, and appends the current prompt.
 * Enforcing the turn cap here (rather than in the DB query alone) keeps the
 * LLM context budget predictable regardless of how logs are fetched.
 */
export function buildConversationContext(
  logsChronological: ConversationLog[],
  currentPrompt: string,
  maxTurns = MAX_CONTEXT_TURNS,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const recent = logsChronological.slice(-maxTurns)
  return [
    { role: 'system' as const, content: ASSESSMENT_SYSTEM_PROMPT },
    ...recent.flatMap((log) => [
      { role: 'user' as const, content: log.promptText },
      { role: 'assistant' as const, content: log.responseText },
    ]),
    { role: 'user' as const, content: currentPrompt },
  ]
}
