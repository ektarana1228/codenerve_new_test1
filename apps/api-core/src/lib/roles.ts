import type { JwtPayload } from '@platform/types'

export function isAdminRole(role: JwtPayload['role'] | undefined): boolean {
  return role === 'ADMIN' || role === 'MASTER'
}

export function isMaster(payload: JwtPayload | undefined): boolean {
  return payload?.role === 'MASTER'
}
