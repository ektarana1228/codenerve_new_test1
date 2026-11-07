/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Run serially — integration tests share a real DB and Redis
  runInBand: true,
  // Forcefully exit after all tests — open BullMQ / ioredis connections would
  // otherwise hang the process.
  forceExit: true,
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts'],
  // Generous timeout: DB queries + async log writes can be slow under load
  testTimeout: 30000,
  // Set environment variables BEFORE any module is imported so the Prisma
  // singleton and ioredis singletons pick up the test DB / Redis URLs.
  setupFiles: ['<rootDir>/tests/integration/env.ts'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tests/integration/tsconfig.json',
      diagnostics: false,
    },
  },
}
