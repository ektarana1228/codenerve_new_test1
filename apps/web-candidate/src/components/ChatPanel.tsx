import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSessionStore, serializeAllFiles } from '../store/session'
import { sendAgentMessage, saveCode, logProctoringEvent, ApiException } from '../api/client'

interface Props {
  className?: string
}

type AgentResult = { data: { response: string; edits: Record<string, string>; turn_number: number } }

export function resolveActiveFileContext(files: Record<string, string>, selectedFile: string): string {
  return selectedFile in files ? selectedFile : (Object.keys(files)[0] ?? '')
}

async function sendWithRetry(prompt: string, files: Record<string, string>, activeFile: string): Promise<AgentResult> {
  try {
    return await sendAgentMessage(prompt, files, activeFile)
  } catch (err) {
    if (err instanceof ApiException && err.code === 'LLM_TIMEOUT') {
      return await sendAgentMessage(prompt, files, activeFile)
    }
    throw err
  }
}

export function ChatPanel({ className = '' }: Props) {
  const chatHistory = useSessionStore((s) => s.chatHistory)
  const addChatMessage = useSessionStore((s) => s.addChatMessage)
  const applyEdits = useSessionStore((s) => s.applyEdits)
  const activeFile = useSessionStore((s) => s.activeFile)
  const setActiveFile = useSessionStore((s) => s.setActiveFile)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [llmUnavailable, setLlmUnavailable] = useState(false)
  const [unavailableMessage, setUnavailableMessage] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, loading])

  const handleSend = async () => {
    const prompt = input.trim()
    if (!prompt || loading || llmUnavailable) return

    setInput('')
    setError(null)
    setLoading(true)
    addChatMessage({ role: 'user', content: prompt })

    try {
      const { files, activeFile: selectedFile } = useSessionStore.getState()
      const contextFile = resolveActiveFileContext(files, selectedFile)
      const res = await sendWithRetry(prompt, { ...files }, contextFile)
      const edits = res.data.edits ?? {}
      const changed = Object.keys(edits)
      if (changed.length) {
        applyEdits(edits)
        if (changed.length === 1) setActiveFile(changed[0]!)
        // Persist immediately so Run/Submit see the AI's edits without waiting for autosave.
        const next = useSessionStore.getState()
        if (next.session_id && next.status === 'active') {
          void saveCode(next.session_id, serializeAllFiles(next.files, next.activeFile)).catch(() => {})
        }
      }
      addChatMessage({
        role: 'assistant',
        content: changed.length ? `${res.data.response}\n\n_Edited: ${changed.join(', ')}_` : res.data.response,
        turnNumber: res.data.turn_number,
      })
    } catch (err) {
      const sessionId = useSessionStore.getState().session_id
      if (err instanceof ApiException) {
        if (err.code === 'LLM_TIMEOUT') {
          if (sessionId) void logProctoringEvent(sessionId, 'SYSTEM', 'AI_ASSISTANT_UNAVAILABLE', { reason: 'TIMEOUT' }).catch(() => {})
          setError('AI assistant is taking longer than usual. Please try again.')
        } else if (err.code === 'RATE_LIMITED') {
          setUnavailableMessage("You've reached the AI request limit for this session.")
          setLlmUnavailable(true)
        } else if (err.code === 'AI_ASSISTANT_ERROR') {
          setError('AI assistant had trouble with that response. Please try again.')
        } else {
          if (sessionId) void logProctoringEvent(sessionId, 'SYSTEM', 'AI_ASSISTANT_UNAVAILABLE', { reason: 'SERVICE_ERROR' }).catch(() => {})
          setError('AI assistant is temporarily unavailable. Please try again.')
        }
      } else {
        if (sessionId) void logProctoringEvent(sessionId, 'SYSTEM', 'AI_ASSISTANT_UNAVAILABLE', { reason: 'NETWORK_ERROR' }).catch(() => {})
        setError('AI assistant is temporarily unavailable. Please try again.')
      }
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <aside className={`flex h-full min-h-0 flex-col bg-[color:var(--bg-raised)] ${className}`}>
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-[color:var(--signal-violet)]" />
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
            AI Assistant
          </h2>
        </div>
        <p className="mt-1 truncate text-xs text-[color:var(--text-muted)]" title={activeFile || 'No file selected'}>Context: {activeFile || 'No file selected'}</p>
      </div>

      {llmUnavailable && (
        <div
          role="alert"
          className="mx-5 mt-4 rounded-2xl border border-[color:var(--status-warn)] bg-[color:var(--bg-overlay)] px-4 py-3 text-sm text-[color:var(--status-warn)]"
        >
          {unavailableMessage}
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {chatHistory.length === 0 && !loading && !llmUnavailable && (
          <div className="rounded-[10px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] px-4 py-4 text-[15px] leading-7 text-[color:var(--text-secondary)]">
            Hello! I'm your AI coding assistant. Ask me to explain, debug, or
            change your code — I can edit the files directly, like Claude Code.
          </div>
        )}

        {chatHistory.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={[
                'max-w-[92%] px-4 py-3 text-[15px] leading-7',
                msg.role === 'user'
                  ? 'rounded-[10px] bg-[color:var(--signal-violet)] text-white'
                  // Assistant messages carry the violet left-rail - the AI surface signature (design.md §6)
                  : 'rounded-r-[10px] rounded-l-sm border-l-2 border-l-[color:var(--signal-violet)] bg-[color:var(--bg-overlay)] text-[color:var(--text-primary)]',
              ].join(' ')}
            >
              {msg.role === 'assistant' ? (
                <div className="[&_code]:rounded-md [&_code]:bg-[color:var(--bg-inset)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-[color:var(--bg-inset)] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-[10px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] px-4 py-3">
              <span className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="ax-thinking-dot inline-block h-2 w-2 rounded-full bg-[color:var(--signal-violet)]"
                  />
                ))}
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-center text-xs text-[color:var(--status-fail)]">{error}</p>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-[color:var(--border-subtle)] px-5 py-4">
        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || llmUnavailable}
            placeholder={
              llmUnavailable
                ? 'AI assistant unavailable'
                : 'Ask the AI for hints, explanations, or syntax help...'
            }
            rows={2}
            className="max-h-36 flex-1 resize-none rounded-[8px] border border-[color:var(--border-strong)] bg-[color:var(--bg-inset)] px-4 py-3 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--signal-violet)] focus:shadow-[0_0_0_3px_rgba(139,123,255,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim() || llmUnavailable}
            data-cursor="violet"
            className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[color:var(--signal-violet)] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send message"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3 3l18 9-18 9 3-9Zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
