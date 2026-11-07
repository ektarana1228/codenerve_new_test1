import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminUser = {
  id: string
  role: 'ADMIN' | 'MASTER'
}

type AuthState = {
  admin_token: string | null
  admin_user: AdminUser | null
}

type AuthActions = {
  login: (token: string) => void
  logout: () => void
}

// ─── JWT decode (client-side, no verification) ────────────────────────────────

function decodeJwtPayload(token: string): { sub?: string; role?: 'ADMIN' | 'MASTER'; exp?: number } | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function decodeJwtSub(token: string): string | null {
  const p = decodeJwtPayload(token)
  return typeof p?.sub === 'string' ? p.sub : null
}

export function isTokenExpired(token: string): boolean {
  const p = decodeJwtPayload(token)
  if (!p?.exp) return true
  return Date.now() / 1000 >= p.exp
}

// ─── Store - persisted to localStorage ───────────────────────────────────────

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      admin_token: null,
      admin_user: null,

      login: (token) => {
        const payload = decodeJwtPayload(token)
        set({ admin_token: token, admin_user: { id: payload?.sub ?? 'unknown', role: payload?.role ?? 'ADMIN' } })
      },

      logout: () => set({ admin_token: null, admin_user: null }),
    }),
    { name: 'admin-auth' },
  ),
)
