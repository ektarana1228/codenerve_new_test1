import type { ApiCoreEnv } from '@platform/config'
import type { AuthHooks } from './plugins/authenticate'

/**
 * Options passed to every route plugin. Assembled once in index.ts and
 * forwarded via fastify.register(plugin, opts).
 */
export interface RouteOptions {
  env: ApiCoreEnv
  authHooks: AuthHooks
}
