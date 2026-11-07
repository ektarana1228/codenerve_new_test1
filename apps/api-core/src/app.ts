import Fastify, { type FastifyServerOptions } from 'fastify'
import type { ApiCoreEnv } from '@platform/config'
import { makeAuthHooks } from './plugins/authenticate'
import { loginRoutes } from './routes/login'
import { inviteTokenRoutes } from './routes/inviteTokens'
import { verifyRoutes } from './routes/verify'
import { assessmentRoutes } from './routes/assessments'
import { problemRoutes } from './routes/problems'
import { projectBugBankRoutes } from './routes/projectBugBank'
import { libraryRoutes } from './routes/library'
import { taskRoutes } from './routes/tasks'
import { sessionRoutes } from './routes/sessions'
import { sessionReportRoutes } from './routes/reportSessions'
import { assessmentReportRoutes } from './routes/reportAssessments'
import { eventRoutes } from './routes/proctorEvents'
import { mediaRoutes } from './routes/proctorMedia'
import { pairingRoutes } from './routes/proctorPairing'
import { adminConfigRoutes } from './routes/adminConfig'
import { startRetentionCleanup } from './lib/retention'

export function buildApp(env: ApiCoreEnv, options: FastifyServerOptions = {}) {
  const app = Fastify({ bodyLimit: 12_000_000, ...options })

  // Action endpoints (approve/reject, activate, submit, heartbeat...) POST with
  // `Content-Type: application/json` but no body. Fastify's default parser throws
  // FST_ERR_CTP_EMPTY_JSON_BODY, which our handler surfaces as a 500. Treat an
  // empty body as "no body" so bodyless POSTs work regardless of the client.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined)
    try {
      done(null, JSON.parse(body as string))
    } catch (err) {
      ;(err as Error & { statusCode?: number }).statusCode = 400
      done(err as Error, undefined)
    }
  })

  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ err: error, path: request.url, method: request.method }, 'Unhandled server error')
    if (!reply.sent) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        return reply.status(statusCode).send({
          error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
        })
      }
      reply.status(500).send({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
      })
    }
  })

  const authHooks = makeAuthHooks(env.JWT_SECRET)
  const routeOpts = { env, authHooks }

  app.register(loginRoutes, routeOpts)
  app.register(inviteTokenRoutes, routeOpts)
  app.register(verifyRoutes, routeOpts)
  app.register(assessmentRoutes, routeOpts)
  app.register(problemRoutes, routeOpts)
  app.register(projectBugBankRoutes, routeOpts)
  app.register(libraryRoutes, routeOpts)
  app.register(taskRoutes, routeOpts)
  app.register(sessionRoutes, routeOpts)
  app.register(sessionReportRoutes, routeOpts)
  app.register(assessmentReportRoutes, routeOpts)
  app.register(eventRoutes, routeOpts)
  app.register(mediaRoutes, routeOpts)
  app.register(pairingRoutes, routeOpts)
  app.register(adminConfigRoutes, routeOpts)

  startRetentionCleanup(app, env)

  app.get('/health', async () => ({ status: 'ok', service: 'api-core' }))

  return app
}
