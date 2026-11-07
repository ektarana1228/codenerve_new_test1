import { rankCandidates, type RankableRow } from './ranking'

function row(
  sessionId: string,
  totalScore: number,
  codeCorrectnessScore: number,
  submittedAt: Date | null = new Date('2026-01-01T12:00:00Z'),
): RankableRow {
  return { sessionId, totalScore, codeCorrectnessScore, submittedAt }
}

describe('rankCandidates', () => {
  // ─── Primary sort: totalScore DESC ─────────────────────────────────────────

  test('sorts candidates by totalScore descending', () => {
    const rows = [
      row('s3', 60, 50),
      row('s1', 95, 80),
      row('s2', 80, 70),
    ]
    const ranked = rankCandidates(rows)

    expect(ranked[0]!.sessionId).toBe('s1')
    expect(ranked[1]!.sessionId).toBe('s2')
    expect(ranked[2]!.sessionId).toBe('s3')
  })

  test('assigns rank 1, 2, 3 in order', () => {
    const rows = [row('a', 70, 60), row('b', 90, 80), row('c', 50, 40)]
    const ranked = rankCandidates(rows)

    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3])
    expect(ranked[0]!.totalScore).toBe(90)
  })

  // ─── Tie-break 1: codeCorrectnessScore DESC ─────────────────────────────────

  test('tie-breaks equal totalScore by higher codeCorrectnessScore first', () => {
    const rows = [
      row('s-low-code', 80, 60),
      row('s-high-code', 80, 90), // same total, higher code score
    ]
    const ranked = rankCandidates(rows)

    expect(ranked[0]!.sessionId).toBe('s-high-code')
    expect(ranked[1]!.sessionId).toBe('s-low-code')
  })

  // ─── Tie-break 2: submittedAt ASC ────────────────────────────────────────────

  test('tie-breaks equal totalScore + equal codeScore by earlier submittedAt first', () => {
    const earlier = new Date('2026-01-01T10:00:00Z')
    const later = new Date('2026-01-01T14:00:00Z')

    const rows = [
      row('s-late', 75, 70, later),
      row('s-early', 75, 70, earlier),
    ]
    const ranked = rankCandidates(rows)

    expect(ranked[0]!.sessionId).toBe('s-early')
    expect(ranked[1]!.sessionId).toBe('s-late')
  })

  test('tie-breaking: higher codeScore beats earlier submittedAt', () => {
    const earlier = new Date('2026-01-01T08:00:00Z')
    const later = new Date('2026-01-01T20:00:00Z')

    const rows = [
      row('s-low-code-early', 80, 60, earlier),
      row('s-high-code-late', 80, 90, later),
    ]
    const ranked = rankCandidates(rows)

    expect(ranked[0]!.sessionId).toBe('s-high-code-late')
  })

  // ─── Edge cases ───────────────────────────────────────────────────────────────

  test('handles empty input without crashing', () => {
    expect(rankCandidates([])).toEqual([])
  })

  test('single candidate gets rank 1', () => {
    const ranked = rankCandidates([row('only', 77, 55)])
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.rank).toBe(1)
  })

  test('does not mutate the original array', () => {
    const original = [row('a', 50, 50), row('b', 90, 90)]
    const copy = [...original]
    rankCandidates(original)
    expect(original[0]!.sessionId).toBe(copy[0]!.sessionId)
    expect(original[1]!.sessionId).toBe(copy[1]!.sessionId)
  })

  // ─── topX: slice to exactly X rows ───────────────────────────────────────────
  // The leaderboard route passes top_x items via the Prisma query limit; here we
  // test the ranking logic itself with a larger set and verify slice behaviour.

  test('returns exactly top_x results when more candidates exist (simulated by slicing)', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row(`s-${i}`, 100 - i, 100 - i),
    )
    const allRanked = rankCandidates(rows)
    const top5 = allRanked.slice(0, 5)

    expect(top5).toHaveLength(5)
    expect(top5[0]!.totalScore).toBe(100)
    expect(top5[4]!.totalScore).toBe(96)
  })
})
