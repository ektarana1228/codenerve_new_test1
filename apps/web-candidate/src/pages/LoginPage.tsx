import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { parseInviteToken, Logo, ADMIN_URL, ThemeToggle } from '@platform/web-shared'
import { ApiException, requestAdminAccount } from '../api/client'

type Tab = 'candidate' | 'company'

const PASSWORD_REGEX = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/;
function isValidPassword(password: string) {
  return password.length >= 8 && password.length <= 20 && PASSWORD_REGEX.test(password)
}

const inputCls =
  'w-full rounded-[8px] border border-[color:var(--border-strong)] bg-[color:var(--bg-inset)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--signal-violet)] focus:shadow-[0_0_0_3px_rgba(139,123,255,0.22)]'

// Neutral primary (design.md §6): inverted fill, no accent - accents are reserved for correctness/AI.
const primaryCls =
  'w-full rounded-[8px] bg-[color:var(--text-primary)] px-4 py-2.5 text-center text-sm font-semibold text-[color:var(--bg-canvas)] transition-opacity hover:opacity-90'

export function LoginPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('candidate')
  const [invite, setInvite] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [requestName, setRequestName] = useState('')
  const [requestCompany, setRequestCompany] = useState('')
  const [requestEmail, setRequestEmail] = useState('')
  const [requestPassword, setRequestPassword] = useState('')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [requestSuccess, setRequestSuccess] = useState(false)
  const [requestLoading, setRequestLoading] = useState(false)

  function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseInviteToken(invite)
    if (!parsed) {
      setInviteError('Enter your invite code or paste your full invite link.')
      return
    }
    navigate(`/start?token=${encodeURIComponent(parsed)}`)
  }

  async function handleAdminRequest(e: React.FormEvent) {
    e.preventDefault()
    setRequestError(null)
    setRequestSuccess(false)
    if (!isValidPassword(requestPassword)) {
      setRequestError('Password must be 8-20 characters long and include lowercase, uppercase, a digit, and a special character.')
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
      setRequestError(err instanceof ApiException ? err.message : 'Could not submit account request.')
    } finally {
      setRequestLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-[color:var(--bg-canvas)] px-4 font-sans">
      {/* Single soft violet glow behind the card - the one place atmosphere is allowed (§9) */}
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

        <div
          className="rounded-[10px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-8"
          style={{ boxShadow: 'var(--shadow-float)' }}
        >
          {/* Tabs */}
          <div className="mb-6 grid grid-cols-2 rounded-[8px] bg-[color:var(--bg-inset)] p-1 text-sm font-medium">
            {(['candidate', 'company'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-[6px] px-3 py-2 transition-colors ${
                  tab === t
                    ? 'bg-[color:var(--bg-overlay)] text-[color:var(--text-primary)] shadow-sm'
                    : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                }`}
              >
                {t === 'candidate' ? 'Candidate' : 'Company'}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {tab === 'candidate' ? (
              <motion.div
                key="candidate"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <h1 className="mb-1 text-xl font-semibold text-[color:var(--text-primary)]">Have an invite?</h1>
                <p className="mb-6 text-sm text-[color:var(--text-muted)]">
                  Enter the invite link or code sent by the hiring team.
                </p>

                {inviteError && (
                  <div
                    className="mb-4 rounded-[8px] border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]"
                    role="alert"
                  >
                    {inviteError}
                  </div>
                )}

                <form onSubmit={handleInvite} className="space-y-4">
                  <div>
                    <label htmlFor="invite" className="mb-1.5 block text-xs font-medium text-[color:var(--text-muted)]">
                      Invite code or link
                    </label>
                    <input
                      id="invite"
                      type="text"
                      value={invite}
                      onChange={(e) => {
                        setInvite(e.target.value)
                        setInviteError(null)
                      }}
                      className={`${inputCls} font-mono`}
                      placeholder="Paste your invite link or code"
                    />
                  </div>
                  <button type="submit" className={primaryCls}>
                    Start assessment
                  </button>
                </form>
                <p className="mt-5 text-center text-sm text-[color:var(--text-muted)]">
                  Need an account? Ask the hiring team for an invite link.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="company"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <h1 className="mb-1 text-xl font-semibold text-[color:var(--text-primary)]">Company sign in</h1>
                <p className="mb-6 text-sm text-[color:var(--text-muted)]">
                  Manage assessments and review candidates in the admin console.
                </p>
                <a href={`${ADMIN_URL}/login`} className={`block ${primaryCls}`}>
                  Sign in to admin console
                </a>
                <div className="my-6 border-t border-[color:var(--border-subtle)]" />
                <h2 className="mb-1 text-sm font-semibold text-[color:var(--text-primary)]">Create an account</h2>
                <p className="mb-4 text-sm text-[color:var(--text-muted)]">A master admin must approve the account before it can sign in.</p>

                {requestSuccess && (
                  <div className="mb-4 rounded-[8px] border border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] px-4 py-3 text-sm text-[color:var(--signal-green)]">
                    Account request sent.
                  </div>
                )}
                {requestError && (
                  <div className="mb-4 rounded-[8px] border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
                    {requestError}
                  </div>
                )}

                <form onSubmit={handleAdminRequest} className="space-y-3">
                  <input value={requestName} onChange={(e) => setRequestName(e.target.value)} className={inputCls} placeholder="Full name" />
                  <input value={requestCompany} onChange={(e) => setRequestCompany(e.target.value)} className={inputCls} placeholder="Company" />
                  <input type="email" required value={requestEmail} onChange={(e) => setRequestEmail(e.target.value)} className={inputCls} placeholder="Email address" />
                  <input type="password" required minLength={8} maxLength={20} value={requestPassword} onChange={(e) => setRequestPassword(e.target.value)} className={inputCls} placeholder="Password" />
                  {requestPassword && !isValidPassword(requestPassword) && (
                    <ul className="mt-2 space-y-1 text-xs text-[color:var(--status-fail)]">
                      {requestPassword.length < 8 || requestPassword.length > 20 ? <li>8-20 characters</li> : null}
                      {!/[a-z]/.test(requestPassword) ? <li>Lowercase letter</li> : null}
                      {!/[A-Z]/.test(requestPassword) ? <li>Uppercase letter</li> : null}
                      {!/\d/.test(requestPassword) ? <li>Number</li> : null}
                      {!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(requestPassword) ? <li>Special character</li> : null}
                    </ul>
                  )}
                  <button type="submit" disabled={requestLoading || !isValidPassword(requestPassword)} className={`${primaryCls} disabled:opacity-50`}>
                    {requestLoading ? 'Submitting...' : 'Request account'}
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
