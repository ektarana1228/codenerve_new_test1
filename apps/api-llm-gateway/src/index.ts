import Fastify from 'fastify'
import { createEnv, apiLlmGatewayEnvSchema } from '@platform/config'
import { createLogger } from '@platform/logger'
import { makeAuthHooks } from './plugins/authenticate'
import { llmRoutes } from './routes/llm'
import { adminRoutes } from './routes/admin'
import { judgeRoutes } from './routes/judge'

// ─── Environment ──────────────────────────────────────────────────────────────

const env = createEnv(apiLlmGatewayEnvSchema)

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = createLogger('api-llm-gateway')

// ─── Server ───────────────────────────────────────────────────────────────────

const server = Fastify({ loggerInstance: log })

// ─── Global error handler ─────────────────────────────────────────────────────

server.setErrorHandler(async (error, request, reply) => {
  log.error({ err: error, path: request.url, method: request.method }, 'Unhandled server error')
  if (!reply.sent) {
    reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    })
  }
})

// ─── Routes ───────────────────────────────────────────────────────────────────

const authHooks = makeAuthHooks(env.JWT_SECRET)
const routeOpts = { env, authHooks }

server.register(llmRoutes, routeOpts)
server.register(adminRoutes, routeOpts)
server.register(judgeRoutes, routeOpts)

server.get('/health', async () => ({ status: 'ok', service: 'api-llm-gateway' }))

// ─── Start ────────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    await server.listen({ port: env.PORT, host: '0.0.0.0' })
    log.info({ port: env.PORT }, 'api-llm-gateway listening')
  } catch (err) {
    log.error({ err }, 'Failed to start api-llm-gateway')
    process.exit(1)
  }
}

start()
