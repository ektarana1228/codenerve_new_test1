// Import directly from source so tsx watch picks up changes immediately.
// Using the package name (@aisd/sandbox-runner) would require a rebuild of
// that package's dist/ before changes take effect.
import { executeCode } from '../../../../sandbox/runner/src/index'
import type { ExecutionRequest, ExecutionResult } from '@platform/types'

// The _sandboxUrl param is kept for signature compatibility but unused -
// the runner is an in-process module, not an HTTP service.
export async function runCode(_sandboxUrl: string, req: ExecutionRequest): Promise<ExecutionResult> {
  return executeCode(req)
}
