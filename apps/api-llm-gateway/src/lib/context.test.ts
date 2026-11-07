import {
  ASSESSMENT_SYSTEM_PROMPT,
  MAX_CONTEXT_TURNS,
  buildConversationContext,
} from './context'

function makeLogs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    promptText: `prompt-${i}`,
    responseText: `response-${i}`,
  }))
}

describe('buildConversationContext', () => {
  test('includes the system prompt and at most 10 turns when given 15 logs', () => {
    const logs = makeLogs(15)
    const messages = buildConversationContext(logs, 'new question')

    expect(messages).toHaveLength(MAX_CONTEXT_TURNS * 2 + 2)
    expect(messages[0]).toEqual({ role: 'system', content: ASSESSMENT_SYSTEM_PROMPT })
  })

  test('uses the most recent turns, not the oldest, when truncating', () => {
    const logs = makeLogs(15)
    const messages = buildConversationContext(logs, 'x')

    expect(messages[1]).toEqual({ role: 'user', content: 'prompt-5' })
    expect(messages[2]).toEqual({ role: 'assistant', content: 'response-5' })
  })

  test('appends the current user prompt as the final message', () => {
    const logs = makeLogs(3)
    const messages = buildConversationContext(logs, 'my current question')

    expect(messages[messages.length - 1]).toEqual({
      role: 'user',
      content: 'my current question',
    })
  })

  test('produces alternating user/assistant roles for history turns after the system prompt', () => {
    const logs = makeLogs(4)
    const messages = buildConversationContext(logs, 'q')

    for (let i = 1; i <= logs.length * 2; i++) {
      expect(messages[i]!.role).toBe(i % 2 === 1 ? 'user' : 'assistant')
    }
  })

  test('handles empty log gracefully with system prompt plus current prompt', () => {
    const messages = buildConversationContext([], 'hello')

    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ role: 'system', content: ASSESSMENT_SYSTEM_PROMPT })
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' })
  })

  test('handles exactly 10 logs without truncation', () => {
    const logs = makeLogs(10)
    const messages = buildConversationContext(logs, 'q')

    expect(messages).toHaveLength(22)
    expect(messages[1]).toEqual({ role: 'user', content: 'prompt-0' })
  })
})
