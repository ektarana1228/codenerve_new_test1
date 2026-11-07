import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')

const CANDIDATE_URL = process.env.CANDIDATE_BASE_URL ?? 'http://localhost:3000'
const ADMIN_URL = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: './tests',

  // Run suites sequentially - they share DB state and invite tokens are single-use.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  timeout: 30_000,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'candidate',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CANDIDATE_URL,
      },
      testMatch: [
        '**/01-candidate-happy-path.spec.ts',
        '**/03-timer-expiry.spec.ts',
        '**/04-reconnection.spec.ts',
        '**/05-security.spec.ts',
      ],
    },
    {
      name: 'admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN_URL,
      },
      testMatch: ['**/02-admin-happy-path.spec.ts'],
    },
  ],

  webServer: [
    {
      command: 'npm run dev --workspace=apps/web-candidate',
      url: CANDIDATE_URL,
      // Reuse any running dev server in local development; always start fresh in CI.
      reuseExistingServer: !process.env.CI,
      cwd: ROOT,
      timeout: 60_000,
    },
    {
      command: 'npm run dev --workspace=apps/web-admin',
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      cwd: ROOT,
      timeout: 60_000,
    },
  ],
})

// NOTE - VS Code orchestrator (apps/vscode-orchestrator, :3104):
// These suites drive the editor through the STUB frame (helpers/editor.ts targets
// `#editor`). Bring the backend up for e2e with the orchestrator in stub mode so no
// Docker image / per-session containers are required and the DOM is deterministic:
//   VSCODE_MODE=stub  (e.g. `docker compose up` with that env, or run
//   `npm run dev:ci --workspace=apps/vscode-orchestrator` with VSCODE_MODE=stub).
// The candidate app's Vite proxy already forwards /vscode and /api/v1/vscode to 3104.
