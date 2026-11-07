import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiCoreTarget = 'http://127.0.0.1:3101'
const llmGatewayTarget = 'http://127.0.0.1:3102'
const vscodeOrchestratorTarget = 'http://127.0.0.1:3104'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Dev proxy: more-specific rules must come first.
      // In production, a reverse proxy or API gateway handles routing between services.
      '/api/v1/llm': {
        target: llmGatewayTarget,
        changeOrigin: true,
      },
      // VS Code orchestrator - control endpoints (ensure/flush).
      '/api/v1/vscode': {
        target: vscodeOrchestratorTarget,
        changeOrigin: true,
      },
      '/api': {
        target: apiCoreTarget,
        changeOrigin: true,
      },
      // VS Code orchestrator - the embedded editor iframe + its WebSocket.
      '/vscode': {
        target: vscodeOrchestratorTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
