import type { ApiCoreEnv } from '@platform/config'

// Shared fixture for route-plugin unit tests - the merged env schema now has
// ~15 required fields, so every *.test.ts spreads this instead of repeating
// them all. Override individual fields (e.g. JWT_SECRET) per test file.
export const TEST_ENV: ApiCoreEnv = {
  DATABASE_URL: 'postgres://test',
  REDIS_URL: 'redis://test',
  JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
  NODE_ENV: 'test',
  PORT: 3101,
  APP_BASE_URL: 'https://app.platform.com',
  ADMIN_BASE_URL: 'https://admin.platform.com',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: 'assessments@apexcoder.io',
  TEAM_EMAIL_FROM: 'team@apexcoder.io',
  TEAM_SMTP_USER: '',
  TEAM_SMTP_PASS: '',
  SANDBOX_URL: 'http://localhost:3200',
  PROCTOR_RETENTION_HOURS: 72,
  GCS_BUCKET_NAME: '',
  GOOGLE_APPLICATION_CREDENTIALS: '',
  CANDIDATE_BASE_URL: 'http://localhost:3000',
  OPENROUTER_ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
}
