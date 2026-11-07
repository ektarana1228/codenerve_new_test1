import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import {
  getSystemConfig,
  saveOpenRouterKey,
  createAdminAccount,
  listAdminAccounts,
  revokeAdminAccount,
  listAdminSignupRequests,
  approveAdminSignupRequest,
  rejectAdminSignupRequest,
  ApiException,
} from '../api/client'
import { useAuthStore } from '../store/auth'

const PASSWORD_REGEX = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/;
function isValidPassword(password: string) {
  return password.length >= 8 && password.length <= 20 && PASSWORD_REGEX.test(password)
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const isMaster = useAuthStore((s) => s.admin_user?.role === 'MASTER')
  const tab = isMaster && searchParams.get('tab') === 'admins' ? 'admins' : 'api'
  const [apiKey, setApiKey] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [adminListError, setAdminListError] = useState<string | null>(null)

  const { data: configData, isLoading } = useQuery({
    queryKey: ['system-config'],
    queryFn: getSystemConfig,
  })

  const { data: adminRequestsData } = useQuery({
    queryKey: ['admin-signup-requests'],
    queryFn: listAdminSignupRequests,
    enabled: isMaster,
  })

  const { data: adminsData, isLoading: adminsLoading, isError: adminsError } = useQuery({
    queryKey: ['admin-accounts'],
    queryFn: listAdminAccounts,
    enabled: isMaster,
    refetchOnMount: 'always',
  })

  const { mutate: saveKey, isPending, isError, error, reset } = useMutation({
    mutationFn: () => saveOpenRouterKey(apiKey),
    onSuccess: () => {
      setSaveSuccess(true)
      setApiKey('')
      void queryClient.invalidateQueries({ queryKey: ['system-config'] })
    },
  })

  const createAdmin = useMutation({
    mutationFn: () => createAdminAccount(adminEmail, adminPassword),
    onSuccess: (res) => {
      setAdminSuccess(`Created admin account for ${res.data.email}`)
      setAdminEmail('')
      setAdminPassword('')
      void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] })
    },
  })

  const approveRequest = useMutation({
    mutationFn: approveAdminSignupRequest,
    onMutate: () => setRequestError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-signup-requests'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] })
    },
    onError: (err) => {
      setRequestError(err instanceof ApiException ? err.message : 'Failed to approve request')
      // The server may have resolved the request (e.g. account already exists) —
      // refetch so a no-longer-pending request drops off the list.
      void queryClient.invalidateQueries({ queryKey: ['admin-signup-requests'] })
    },
  })

  const rejectRequest = useMutation({
    mutationFn: rejectAdminSignupRequest,
    onMutate: () => setRequestError(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-signup-requests'] }),
    onError: (err) => setRequestError(err instanceof ApiException ? err.message : 'Failed to reject request'),
  })

  const revokeAdmin = useMutation({
    mutationFn: revokeAdminAccount,
    onMutate: () => setAdminListError(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] }),
    onError: (err) => setAdminListError(err instanceof ApiException ? err.message : 'Failed to revoke admin access'),
  })

  const isConfigured = configData?.data.openrouter_key_configured ?? false
  const adminRequests = adminRequestsData?.data ?? []
  const admins = adminsData?.data ?? []
  const adminTotals = admins.reduce((totals, admin) => ({
    live: totals.live + admin.live_assignments,
    assignments: totals.assignments + admin.total_assignments,
    activeSessions: totals.activeSessions + admin.active_sessions,
    submitted: totals.submitted + admin.submitted_sessions,
  }), { live: 0, assignments: 0, activeSessions: 0, submitted: 0 })

  return (
    <Layout>
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="mb-6 text-2xl font-bold text-[color:var(--text-primary)]">Settings</h1>

        {isMaster && (
          <div className="grid grid-cols-2 rounded-lg bg-[color:var(--bg-inset)] p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className={`rounded-md px-3 py-2 ${tab === 'api' ? 'bg-[color:var(--bg-overlay)] text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
            >
              API Key
            </button>
            <button
              type="button"
              onClick={() => setSearchParams({ tab: 'admins' })}
              className={`rounded-md px-3 py-2 ${tab === 'admins' ? 'bg-[color:var(--bg-overlay)] text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
            >
              Admin Accounts
            </button>
          </div>
        )}

        {tab === 'api' && (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-6">
          <h2 className="mb-1 text-sm font-semibold text-[color:var(--text-primary)]">OpenRouter API Key</h2>
          <p className="mb-5 text-xs text-[color:var(--text-muted)]">
            Required to enable the AI assistant in candidate assessments. Stored AES-256 encrypted.
          </p>

          {/* Status indicator */}
          {!isLoading && (
            <div
              className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
                isConfigured
                  ? 'border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] text-[color:var(--signal-green)]'
                  : 'border-[color:var(--status-warn)] bg-[color:var(--status-warn-dim)] text-[color:var(--status-warn)]'
              }`}
            >
              {isConfigured
                ? 'API key is configured'
                : 'No API key configured - AI assistant will not work'}
            </div>
          )}

          {/* Success notice */}
          {saveSuccess && (
            <div className="mb-4 rounded-lg border border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] px-4 py-3 text-sm text-[color:var(--signal-green)]">
              API key saved securely
            </div>
          )}

          {/* Error notice */}
          {isError && (
            <div className="mb-4 rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
              {error instanceof ApiException ? error.message : 'Failed to save API key'}
            </div>
          )}

          {/* Key input */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">
              {isConfigured ? 'Replace Key' : 'API Key'}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                if (saveSuccess) setSaveSuccess(false)
                if (isError) reset()
              }}
              placeholder="sk-or-v1-…"
              autoComplete="new-password"
              className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:border-[color:var(--signal-violet)] focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-[color:var(--text-secondary)]">
              The current key is never shown. Enter a new key to replace it.
            </p>
          </div>

          <button
            type="button"
            disabled={!apiKey.trim() || isPending}
            onClick={() => saveKey()}
            className="rounded-lg bg-[color:var(--text-primary)] px-4 py-2.5 text-sm font-medium text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save Key'}
          </button>
        </div>
        )}

        {isMaster && tab === 'admins' && (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-6">
            <h2 className="mb-1 text-sm font-semibold text-[color:var(--text-primary)]">Admin Accounts</h2>
            <p className="mb-5 text-xs text-[color:var(--text-muted)]">Create, approve, monitor, and revoke assessment admins.</p>

            <div className="mb-6 grid gap-3 sm:grid-cols-5">
              {[
                ['Admins', admins.length],
                ['Live assignments', adminTotals.live],
                ['Total assignments', adminTotals.assignments],
                ['Active sessions', adminTotals.activeSessions],
                ['Submitted', adminTotals.submitted],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-3">
                  <p className="text-xs text-[color:var(--text-muted)]">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-[color:var(--text-primary)]">{adminsLoading || adminsError ? '-' : value}</p>
                </div>
              ))}
            </div>

            <div className="mb-6">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Current admins</h3>
              {adminListError && (
                <div className="mb-3 rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
                  {adminListError}
                </div>
              )}
              {admins.length === 0 ? (
                <p className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] px-4 py-3 text-sm text-[color:var(--text-muted)]">
                  No admin accounts yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {admins.map((admin) => (
                    <div key={admin.id} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-[color:var(--text-primary)]">{admin.email}</p>
                          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                            Joined {new Date(admin.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={revokeAdmin.isPending}
                          onClick={() => window.confirm(`Revoke admin access for ${admin.email}?`) && revokeAdmin.mutate(admin.id)}
                          className="rounded-lg border border-[color:var(--status-fail)] px-3 py-2 text-xs font-medium text-[color:var(--status-fail)] disabled:opacity-50"
                        >
                          Revoke access
                        </button>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                        <span className="text-[color:var(--text-muted)]">Live: <b className="text-[color:var(--text-primary)]">{admin.live_assignments}</b></span>
                        <span className="text-[color:var(--text-muted)]">Total: <b className="text-[color:var(--text-primary)]">{admin.total_assignments}</b></span>
                        <span className="text-[color:var(--text-muted)]">Sessions: <b className="text-[color:var(--text-primary)]">{admin.total_sessions}</b></span>
                        <span className="text-[color:var(--text-muted)]">Active: <b className="text-[color:var(--text-primary)]">{admin.active_sessions}</b></span>
                        <span className="text-[color:var(--text-muted)]">Submitted: <b className="text-[color:var(--text-primary)]">{admin.submitted_sessions}</b></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-6">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Pending requests</h3>
              {requestError && (
                <div className="mb-3 rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
                  {requestError}
                </div>
              )}
              {adminRequests.length === 0 ? (
                <p className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] px-4 py-3 text-sm text-[color:var(--text-muted)]">
                  No admin requests under review.
                </p>
              ) : (
                <div className="space-y-3">
                  {adminRequests.map((adminRequest) => (
                    <div key={adminRequest.id} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-4">
                      <div className="mb-3">
                        <p className="text-sm font-medium text-[color:var(--text-primary)]">{adminRequest.email}</p>
                        {(adminRequest.full_name || adminRequest.company_name) && (
                          <p className="text-xs text-[color:var(--text-muted)]">
                            {[adminRequest.full_name, adminRequest.company_name].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => approveRequest.mutate(adminRequest.id)}
                          disabled={approveRequest.isPending || rejectRequest.isPending}
                          className="rounded-lg bg-[color:var(--text-primary)] px-3 py-2 text-xs font-medium text-[color:var(--bg-canvas)] disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectRequest.mutate(adminRequest.id)}
                          disabled={approveRequest.isPending || rejectRequest.isPending}
                          className="rounded-lg border border-[color:var(--border-strong)] px-3 py-2 text-xs font-medium text-[color:var(--text-secondary)] disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {adminSuccess && (
              <div className="mb-4 rounded-lg border border-[color:var(--signal-green)] bg-[color:var(--signal-green-dim)] px-4 py-3 text-sm text-[color:var(--signal-green)]">
                {adminSuccess}
              </div>
            )}

            {createAdmin.isError && (
              <div className="mb-4 rounded-lg border border-[color:var(--status-fail)] bg-[color:var(--status-fail-dim)] px-4 py-3 text-sm text-[color:var(--status-fail)]">
                {createAdmin.error instanceof ApiException ? createAdmin.error.message : 'Failed to create admin account'}
              </div>
            )}

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                setAdminSuccess(null)
                setRequestError(null)
                if (!isValidPassword(adminPassword)) {
                  setRequestError('Password must be 8-20 characters long and include lowercase, uppercase, a number, and a special character.')
                  return
                }
                createAdmin.mutate()
              }}
            >
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Email address</label>
                <input
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(event) => setAdminEmail(event.target.value)}
                  className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:border-[color:var(--signal-violet)] focus:outline-none"
                  placeholder="admin@company.com"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">Temporary password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={20}
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-overlay)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:border-[color:var(--signal-violet)] focus:outline-none"
                  placeholder="Password"
                  autoComplete="new-password"
                />
                {adminPassword && !isValidPassword(adminPassword) && (
                  <ul className="mt-2 space-y-1 text-xs text-[color:var(--status-fail)]">
                    {adminPassword.length < 8 || adminPassword.length > 20 ? <li>8-20 characters</li> : null}
                    {!/[a-z]/.test(adminPassword) ? <li>Lowercase letter</li> : null}
                    {!/[A-Z]/.test(adminPassword) ? <li>Uppercase letter</li> : null}
                    {!/\d/.test(adminPassword) ? <li>Number</li> : null}
                    {!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(adminPassword) ? <li>Special character</li> : null}
                  </ul>
                )}
              </div>
              <button
                type="submit"
                disabled={!adminEmail.trim() || !isValidPassword(adminPassword) || createAdmin.isPending}
                className="rounded-lg bg-[color:var(--text-primary)] px-4 py-2.5 text-sm font-medium text-[color:var(--bg-canvas)] transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {createAdmin.isPending ? 'Creating...' : 'Create Admin'}
              </button>
            </form>
          </div>
        )}
      </div>
    </Layout>
  )
}
