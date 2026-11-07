// Runs via Jest setupFiles — before any module is imported in test files.
// Sets environment variables so every Prisma singleton and ioredis client
// created during the test run connects to the isolated test infrastructure.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/platform_test'

// Use Redis DB 1 so test runs never touch development data in DB 0.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1'

process.env.JWT_SECRET = 'integration-test-secret-min-32-chars!!!!'
process.env.OPENROUTER_ENCRYPTION_KEY = '00'.repeat(32) // 64 hex chars = 32 bytes
process.env.NODE_ENV = 'test'
process.env.SANDBOX_URL = 'http://localhost:3200' // not actually called; sandbox is mocked
process.env.APP_BASE_URL = 'http://localhost:3100'
