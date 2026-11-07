import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiCoreTarget = 'http://127.0.0.1:3101'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: true,
    server: {
      deps: {
        inline: ['react-markdown', 'remark-parse', 'remark-rehype', 'rehype-stringify'],
      },
    },
  },
  server: {
    port: 3001,
    proxy: {
      // Route each API namespace to its owning service in dev.
      // Ordering matters: more specific paths must come first.
      '/api/v1/auth': { target: apiCoreTarget, changeOrigin: true },
      '/api/v1/reports': { target: apiCoreTarget, changeOrigin: true },
      '/api/v1/proctoring': { target: apiCoreTarget, changeOrigin: true },
      '/api/v1/problem-bank': { target: apiCoreTarget, changeOrigin: true },
      '/api/v1/library': { target: apiCoreTarget, changeOrigin: true },
      '/api/v1/admin': { target: apiCoreTarget, changeOrigin: true },
      '/api/v1/assessments': { target: apiCoreTarget, changeOrigin: true },
      '/api/v1/sessions': { target: apiCoreTarget, changeOrigin: true },
    },
  },
})
