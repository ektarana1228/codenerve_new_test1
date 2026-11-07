import * as fs from 'fs'
import * as path from 'path'

export type SeedData = {
  admin: { email: string; password: string; id: string }
  standardAssessment: { id: string }
  timerAssessment: { id: string }
  scoredAssessment: { id: string; scoredSessionId: string }
  tokens: {
    suite1: string
    suite3: string
    suite4: string
    suite5: string
  }
  /** Sentinel strings seeded into hidden test cases - used by suite 5 security checks. */
  hiddenSentinels: { input: string; output: string }
}

export function loadSeedData(): SeedData {
  const filePath = path.join(__dirname, '..', '.test-data.json')
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as SeedData
}
