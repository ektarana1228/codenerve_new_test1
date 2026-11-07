import { Navigate } from 'react-router-dom'
import { useAuthStore, isTokenExpired } from '../store/auth'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { admin_token, logout } = useAuthStore((s) => ({ admin_token: s.admin_token, logout: s.logout }))
  if (!admin_token || isTokenExpired(admin_token)) {
    if (admin_token) logout()
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
