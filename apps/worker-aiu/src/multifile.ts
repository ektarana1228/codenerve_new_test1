// Parses the same durable code envelope api-core and vscode-orchestrator
// speak: a plain string for single-file sessions, or
//   { __multifile__: true, main: "solution.py", files: { "solution.py": "...", ... } }
// for multi-file / PROJECT sessions. Small per-app copy, same as the existing
// parseCodePayload (api-core) / deserialize (vscode-orchestrator).
export function parseWorkspaceFiles(raw: string): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.__multifile__ === true && typeof parsed.files === 'object' && parsed.files !== null) {
      return parsed.files as Record<string, string>
    }
  } catch {
    // not JSON - a plain single-file code string
  }
  return { '': raw }
}

export type BugBankFile = { path: string; contentBase64: string }

// referenceFiles/solutionFiles are stored as base64-encoded { path, contentBase64 }
// pairs (see packages/types ReferenceFileSchema). Decodes to path -> text.
export function decodeReferenceFiles(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const entry of value as BugBankFile[]) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.contentBase64 !== 'string') continue
    try {
      out[entry.path] = Buffer.from(entry.contentBase64, 'base64').toString('utf8')
    } catch {
      // skip undecodable entries rather than failing the whole job
    }
  }
  return out
}

// Bug-bank-sourced tasks scope their files by a `${bugBankId}/` path prefix
// (see apps/api-core/src/projectBugBank.ts) so multiple bank selections
// in one assessment don't collide. Manually-authored tasks have no bugBankId
// and see the assessment's whole file set.
export function filesForTask(files: Record<string, string>, bugBankId: string | null): Record<string, string> {
  if (!bugBankId) return files
  const prefix = `${bugBankId}/`
  const scoped = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(prefix)))
  return Object.keys(scoped).length > 0 ? scoped : files
}
