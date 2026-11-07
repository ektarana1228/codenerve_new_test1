import type { AuthHooks } from './plugins/authenticate'
import type { ApiLlmGatewayEnv } from '@platform/config'

export interface RouteOptions {
  env: ApiLlmGatewayEnv
  authHooks: AuthHooks
}
