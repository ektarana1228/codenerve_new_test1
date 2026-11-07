import { beforeEach, describe, expect, test } from 'vitest'
import { serializeAllFiles, useSessionStore } from './session'
import { resolveActiveFileContext } from '../components/ChatPanel'

beforeEach(() => useSessionStore.getState().reset())

describe('PROJECT workspace file context', () => {
  test('uses the visibly selected workspace file as AI context', () => {
    const store = useSessionStore.getState()
    store.setLanguage('python')
    store.addFile('inference.py')
    store.setCode('def process_batch(requests): pass')

    const state = useSessionStore.getState()
    expect(state.activeFile).toBe('inference.py')
    expect(resolveActiveFileContext(state.files, state.activeFile)).toBe('inference.py')
  })

  test('falls back to an existing file instead of sending a stale filename', () => {
    expect(resolveActiveFileContext({ 'inference.py': 'code' }, 'solution.py')).toBe('inference.py')
    expect(resolveActiveFileContext({}, 'solution.py')).toBe('')
  })

  test('serializes the selected file as the durable workspace main file', () => {
    const serialized = serializeAllFiles({ 'solution.py': '# placeholder', 'inference.py': 'fixed' }, 'inference.py')
    expect(JSON.parse(serialized)).toEqual({
      __multifile__: true,
      main: 'inference.py',
      files: { 'solution.py': '# placeholder', 'inference.py': 'fixed' },
    })
  })

  test('keeps editor content synchronized when AI edits the active file', () => {
    const store = useSessionStore.getState()
    store.setLanguage('python')
    store.addFile('inference.py')
    store.applyEdits({ 'inference.py': 'fixed implementation' })
    const state = useSessionStore.getState()
    expect(state.files['inference.py']).toBe('fixed implementation')
    expect(state.code).toBe('fixed implementation')
  })
})
