import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

// Editor tracks the app theme (design.md §6): light mode → light editor.
const readEditorTheme = () =>
  document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark'

interface Props {
  language: string
  value: string
  readOnly?: boolean
  onChange?: (value: string) => void
  onLargePaste?: () => void
  allowCopyPaste?: boolean
  onClipboardBlocked?: (action: 'copy' | 'cut' | 'paste') => void
  wordWrap?: 'on' | 'off'
}

// All 7 autocomplete settings from CLAUDE.md applied exactly.
// `suggest.enabled` was removed in Monaco 0.34+, kept as unknown cast per spec.
const BASE_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  acceptSuggestionOnEnter: 'off',
  tabCompletion: 'off',
  wordBasedSuggestions: 'off',
  parameterHints: { enabled: false },
  suggest: { enabled: false } as unknown as editor.ISuggestOptions,
  fontSize: 14,
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'on',
}

export function MonacoEditor({
  language,
  value,
  readOnly = false,
  onChange,
  onLargePaste,
  allowCopyPaste = false,
  onClipboardBlocked,
  wordWrap = 'on',
}: Props) {
  const [editorTheme, setEditorTheme] = useState(readEditorTheme)
  useEffect(() => {
    const obs = new MutationObserver(() => setEditorTheme(readEditorTheme()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const allowCopyPasteRef = useRef(allowCopyPaste)
  const onLargePasteRef = useRef(onLargePaste)
  const onClipboardBlockedRef = useRef(onClipboardBlocked)

  allowCopyPasteRef.current = allowCopyPaste
  onLargePasteRef.current = onLargePaste
  onClipboardBlockedRef.current = onClipboardBlocked

  const handleMount: OnMount = (editorInstance, monaco) => {
    const domNode = editorInstance.getDomNode()
    if (!domNode) return

    const blockClipboardEvent = (action: 'copy' | 'cut' | 'paste', event: Event) => {
      if (allowCopyPasteRef.current) return
      event.preventDefault()
      event.stopPropagation()
      onClipboardBlockedRef.current?.(action)
    }

    const isClipboardShortcut = (event: KeyboardEvent, key: string) => {
      const normalized = event.key.toLowerCase()
      return (event.ctrlKey || event.metaKey) && normalized === key
    }

    domNode.addEventListener(
      'keydown',
      (event) => {
        if (allowCopyPasteRef.current) return
        if (isClipboardShortcut(event, 'c')) blockClipboardEvent('copy', event)
        if (isClipboardShortcut(event, 'x')) blockClipboardEvent('cut', event)
        if (isClipboardShortcut(event, 'v')) blockClipboardEvent('paste', event)
      },
      true,
    )
    domNode.addEventListener('copy', (event) => blockClipboardEvent('copy', event), true)
    domNode.addEventListener('cut', (event) => blockClipboardEvent('cut', event), true)
    domNode.addEventListener(
      'paste',
      (event) => {
        if (!allowCopyPasteRef.current) {
          blockClipboardEvent('paste', event)
          return
        }

        if (!onLargePasteRef.current) return
        const text = (event as ClipboardEvent).clipboardData?.getData('text') ?? ''
        if (text.length > 500) {
          event.preventDefault()
          event.stopPropagation()
          onLargePasteRef.current()
        }
      },
      true,
    )
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
      if (!allowCopyPasteRef.current) onClipboardBlockedRef.current?.('copy')
    })
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
      if (!allowCopyPasteRef.current) onClipboardBlockedRef.current?.('cut')
    })
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
      if (!allowCopyPasteRef.current) onClipboardBlockedRef.current?.('paste')
    })
  }

  return (
    <Editor
      height="100%"
      language={language}
      theme={editorTheme}
      value={value}
      onChange={(val) => onChange?.(val ?? '')}
      onMount={handleMount}
      options={{ ...BASE_OPTIONS, readOnly, wordWrap }}
    />
  )
}
