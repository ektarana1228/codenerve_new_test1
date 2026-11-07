import { createEnv, apiCoreEnvSchema } from '@platform/config'
import { createLogger } from '@platform/logger'
import { buildApp } from './app'

const env = createEnv(apiCoreEnvSchema)
const log = createLogger('api-core')
const app = buildApp(env, { loggerInstance: log })

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  log.error({ err }, 'Failed to start api-core')
  process.exit(1)
})
