// Cross-app origins. In dev the two SPAs run on different ports; in prod a reverse
// proxy can override via VITE_ADMIN_URL / VITE_CANDIDATE_URL.
const env = (import.meta as ImportMeta & {
  env?: {
    VITE_ADMIN_URL?: string
    VITE_CANDIDATE_URL?: string
  }
}).env

export const ADMIN_URL = env?.VITE_ADMIN_URL ?? 'http://localhost:3001'
export const CANDIDATE_URL = env?.VITE_CANDIDATE_URL ?? 'http://localhost:3000'
