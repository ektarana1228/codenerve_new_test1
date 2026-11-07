import { z } from 'zod'

/**
 * Validates process.env against the provided Zod schema.
 * On failure: prints a human-readable list of every missing/invalid variable
 * and calls process.exit(1) so the service never starts in a broken state.
 */
export function createEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env)

  if (!result.success) {
    const issues = result.error.errors

    const lines = issues.map((issue) => {
      const key = issue.path.join('.') || '(root)'
      return `  ${key.padEnd(36)}${issue.message}`
    })

    process.stderr.write(
      [
        '',
        '[config] Environment validation failed.',
        'Missing or invalid variables:',
        '',
        ...lines,
        '',
        'Fix your .env file and restart.',
        '',
      ].join('\n'),
    )

    process.exit(1)
  }

  return result.data
}
