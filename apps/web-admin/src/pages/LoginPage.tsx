import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ApiException, loginAdmin, requestAdminAccount } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Logo, ThemeToggle } from '@platform/web-shared'

const PASSWORD_REGEX = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/;
function isValidPassword(password: string) {
  return password.length >= 8 && password.length <= 20 && PASSWORD_REGEX.test(password)
}

const inputCls =
  'w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:border-[color:var(--signal-violet)] focus:outline-none focus:ring-1 focus:ring-[color:var(--signal-violet)]'

export function LoginPage() {
  const token = useAuthStore((s) => s.admin_token)
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [requestName, setRequestName] = useState('')
  const [requestCompany, setRequestCompany] = useState('')
  const [requestEmail, setRequestEmail] = useState('')
  const [requestPassword, setRequestPassword] = useState('')
  const [requestSuccess, setRequestSuccess] = useState(false)
  const [requestLoading, setRequestLoading] = useState(false)

  // Already authenticated - go straight to dashboard
  if (token) return <Navigate to="/dashboard" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await loginAdmin(email, password)
      login(res.data.access_token)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof ApiException && err.code === 'UNDER_REVIEW') {
        setError('Under Review')
      } else if (err instanceof ApiException && err.code === 'UNAUTHORIZED') {
        setError('Invalid email or password.')
      } else if (err instanceof ApiException) {
        setError(err.message)
      } else {
        setError('Network error. Check your connection.')
      }
      setLoading(false)
    }
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setRequestSuccess(false)
    if (!isValidPassword(requestPassword)) {
      setError('Password must be 8-20 characters long and include lowercase, uppercase, a number, and a special character.')
      return
    }
    setRequestLoading(true)
    try {
      await requestAdminAccount({
        email: requestEmail,
        password: requestPassword,
        fullName: requestName,
        companyName: requestCompany,
      })
      setRequestSuccess(true)
      setRequestName('')
      setRequestCompany('')
      setRequestEmail('')
      setRequestPassword('')
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Network error. Check your connection.')
    } finally {
      setRequestLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-[color:var(--bg-canvas)] px-4 font-sans">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, var(--signal-violet), transparent)', opacity: 0.14, filter: 'blur(40px)' }}
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <motion.div
        className="relative w-full max-w-sm"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="mb-8 flex justify-center">
          <Logo size={40} />
        </div>

        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-8 shadow-sm">
          <h1 className="mb-1 text-xl font-semibold text-[color:var(--text-primary)]">Company sign in</h1>
          <p className="mb-6 text-sm text-[color:var(--text-muted)]">Manage assessments and review candidates.</p>

          {error && (
            <div className="mb-4 rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]" role="alert">
              {error}
            </div>
          )}

          {!showRequest ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="admin@company.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[color:var(--text-primary)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          ) : (
          <form onSubmit={handleRequest} className="space-y-4">
            {requestSuccess && (
              <div className="rounded-lg border border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] px-4 py-3 text-sm text-[color:var(--signal-green)]">
                Account request sent. A master admin must approve it before login works.
              </div>
            )}
            <div>
              <label htmlFor="request-name" className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Full name</label>
              <input id="request-name" value={requestName} onChange={(e) => setRequestName(e.target.value)} className={inputCls} placeholder="Your name" />
            </div>
            <div>
              <label htmlFor="request-company" className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Company</label>
              <input id="request-company" value={requestCompany} onChange={(e) => setRequestCompany(e.target.value)} className={inputCls} placeholder="Company name" />
            </div>
            <div>
              <label htmlFor="request-email" className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Email address</label>
              <input id="request-email" type="email" required autoComplete="email" value={requestEmail} onChange={(e) => setRequestEmail(e.target.value)} className={inputCls} placeholder="admin@company.com" />
            </div>
            <div>
              <label htmlFor="request-password" className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Password</label>
              <input id="request-password" type="password" required minLength={8} maxLength={20} autoComplete="new-password" value={requestPassword} onChange={(e) => setRequestPassword(e.target.value)} className={inputCls} placeholder="Password" />
              {requestPassword && !isValidPassword(requestPassword) && (
                <ul className="mt-2 space-y-1 text-xs text-[color:var(--status-fail)]">
                  {requestPassword.length < 8 || requestPassword.length > 20 ? <li>8-20 characters</li> : null}
                  {!/[a-z]/.test(requestPassword) ? <li>Lowercase letter</li> : null}
                  {!/[A-Z]/.test(requestPassword) ? <li>Uppercase letter</li> : null}
                  {!/\d/.test(requestPassword) ? <li>Number</li> : null}
                  {!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(requestPassword) ? <li>Special character</li> : null}
                </ul>
              )}
            </div>
            <button
              type="submit"
              disabled={requestLoading || !isValidPassword(requestPassword)}
              className="w-full rounded-lg bg-[color:var(--text-primary)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {requestLoading ? 'Submitting...' : 'Request account'}
            </button>
          </form>
          )}
          <p className="mt-5 text-center text-sm text-[color:var(--text-muted)]">
            {showRequest ? 'Already approved?' : 'Need an account?'}{' '}
            <button type="button" className="font-medium text-[color:var(--text-primary)] hover:underline" onClick={() => {
              setShowRequest((value) => !value)
              setError(null)
            }}>
              {showRequest ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
