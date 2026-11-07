// Workspace <-> DB serialization.
//
// The canonical durable copy of a candidate's code lives in Session.currentCode
// as either a plain string (single file) or a JSON envelope:
//   { __multifile__: true, main: "solution.py", files: { "solution.py": "...", ... } }
//
// This is the SAME format the candidate store and api-core already speak
// (see apps/web-candidate/src/store/session.ts and
//  apps/api-core/src/routes/sessions.ts parseCodePayload), so run/submit
// keep working unchanged - the orchestrator just keeps currentCode in sync with
// the VS Code container's /workspace directory.

import { getCommentPrefix, getFileExtension, type SandboxLanguage } from '@platform/types'

export type { SandboxLanguage }

export function mainFilename(language: SandboxLanguage): string {
  return `solution.${getFileExtension(language)}`
}

// Starter content so a freshly-seeded workspace is never an empty file.
export function starterContent(language: SandboxLanguage): string {
  return `${getCommentPrefix(language)} Write your solution here\n`
}

export interface Workspace {
  main: string
  files: Record<string, string>
}

// Turn the stored currentCode into a concrete file map for the workspace.
export function deserialize(raw: string, language: SandboxLanguage): Workspace {
  const main = mainFilename(language)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (
        parsed.__multifile__ === true &&
        typeof parsed.files === 'object' &&
        parsed.files !== null
      ) {
        const files = parsed.files as Record<string, string>
        const mainName = typeof parsed.main === 'string' ? parsed.main : main
        if (!files[mainName]) files[mainName] = ''
        return { main: mainName, files }
      }
    } catch {
      // Not an envelope - a plain single-file code string.
    }
    return { main, files: { [main]: raw } }
  }
  return { main, files: { [main]: starterContent(language) } }
}

// Turn a workspace file map back into the durable currentCode format.
// Single-file workspaces collapse to a plain string so nothing downstream has
// to know the envelope exists.
export function serialize(ws: Workspace): string {
  const names = Object.keys(ws.files)
  if (names.length <= 1) return ws.files[ws.main] ?? ''
  return JSON.stringify({ __multifile__: true, main: ws.main, files: ws.files })
}

// Files we never sync back to the DB even if they appear in /workspace:
// editor metadata and anything outside the candidate's own source.
const IGNORED = new Set(['.vscode', '.theia', '.git', 'node_modules'])

// Binary/asset extensions we never read back into currentCode - the durable copy
// is UTF-8 text, so binary reference material (zips, images, notebooks, fonts)
// would corrupt on round-trip. These live only in the container.
const BINARY_EXT = new Set([
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svgz',
  'pdf', 'ipynb', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'wav', 'ogg', 'webm',
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class', 'jar',
  'db', 'sqlite', 'sqlite3',
])

export function isSyncableFile(relativePath: string): boolean {
  const top = relativePath.split(/[\\/]/)[0]
  if (IGNORED.has(top) || relativePath.startsWith('.')) return false
  const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
  return !BINARY_EXT.has(ext)
}
