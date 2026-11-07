export type RankableRow = {
  sessionId: string
  totalScore: number
  codeCorrectnessScore: number
  submittedAt: Date | null
}

/**
 * Sorts candidates by the leaderboard ordering defined in CLAUDE.md §9.3:
 *   1. totalScore DESC
 *   2. codeCorrectnessScore DESC (tie-break 1)
 *   3. submittedAt ASC (tie-break 2 - earlier submission wins)
 *   4. sessionId ASC (stable final tie-break)
 * Returns a new array with a 1-based `rank` field prepended.
 */
export function rankCandidates<T extends RankableRow>(
  rows: T[],
): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore
    if (b.codeCorrectnessScore !== a.codeCorrectnessScore)
      return b.codeCorrectnessScore - a.codeCorrectnessScore
    const aTime = a.submittedAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bTime = b.submittedAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    if (aTime !== bTime) return aTime - bTime
    return a.sessionId.localeCompare(b.sessionId)
  })
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }))
}
