import Fastify from 'fastify'
import { createEnv, vscodeOrchestratorEnvSchema } from '@platform/config'
import { createLogger } from '@platform/logger'
import { Manager } from './lib/manager'
import { attachProxy } from './lib/proxy'
import { runMaintenance } from './lib/maintenance'
import { vscodeRoutes } from './routes/vscode'

// ─── Environment ──────────────────────────────────────────────────────────────

const env = createEnv(vscodeOrchestratorEnvSchema)

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = createLogger('vscode-orchestrator')

// ─── Server ───────────────────────────────────────────────────────────────────

const server = Fastify({ loggerInstance: log })
const manager = new Manager(env, log)

server.setErrorHandler(async (error, request, reply) => {
  log.error({ err: error, path: request.url, method: request.method }, 'Unhandled server error')
  if (!reply.sent) {
    reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } })
  }
})

server.register(vscodeRoutes, { env, manager, log })
server.get('/health', async () => ({ status: 'ok', service: 'vscode-orchestrator', mode: env.VSCODE_MODE }))

// ─── Maintenance loop (sync + reap) ────────────────────────────────────────────

let maintenanceTimer: ReturnType<typeof setInterval> | undefined

// ─── Start ────────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    await server.ready()
    // WebSocket upgrades are handled on the raw server, outside Fastify routing.
    attachProxy(server.server, manager, env.JWT_SECRET, log)

    await server.listen({ port: env.PORT, host: '0.0.0.0' })
    log.info({ port: env.PORT, mode: env.VSCODE_MODE }, 'vscode-orchestrator listening')

    maintenanceTimer = setInterval(() => {
      runMaintenance(manager, log).catch((err) => log.warn({ err: err.message }, 'maintenance tick failed'))
    }, env.VSCODE_REAP_INTERVAL_MS)
  } catch (err) {
    log.error({ err }, 'Failed to start vscode-orchestrator')
    process.exit(1)
  }
}

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down - reaping session containers')
  if (maintenanceTimer) clearInterval(maintenanceTimer)
  await manager.shutdown().catch(() => {})
  await server.close().catch(() => {})
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start()
