import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { SettingsPage } from '../pages/SettingsPage'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockGetSystemConfig = vi.fn()
const mockSaveOpenRouterKey = vi.fn()

vi.mock('../api/client', () => ({
  getSystemConfig: () => mockGetSystemConfig(),
  saveOpenRouterKey: (...args: unknown[]) => mockSaveOpenRouterKey(...args),
  listAdminSignupRequests: vi.fn(),
  listAdminAccounts: vi.fn(),
  createAdminAccount: vi.fn(),
  revokeAdminAccount: vi.fn(),
  approveAdminSignupRequest: vi.fn(),
  rejectAdminSignupRequest: vi.fn(),
  ApiException: class ApiException extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'ApiException'
    }
  },
}))

vi.mock('../components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function getKeyInput() {
  return screen.getByRole('textbox', { hidden: true }) as HTMLInputElement ||
    (document.querySelector('input[type="password"]') as HTMLInputElement)
}

// ─── Tests: input masking ──────────────────────────────────────────────────────

describe('SettingsPage - input masking', () => {
  beforeEach(() => {
    mockGetSystemConfig.mockResolvedValue({ data: { openrouter_key_configured: false } })
    mockSaveOpenRouterKey.mockResolvedValue({ data: {} })
  })

  it('API key input has type="password" so the value is masked', async () => {
    renderPage()
    // Wait for the config query to resolve
    await screen.findByText(/no api key configured/i)
    const input = document.querySelector('input[type="password"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('password')
  })
})

// ─── Tests: configured state ──────────────────────────────────────────────────

describe('SettingsPage - API key configured', () => {
  beforeEach(() => {
    mockGetSystemConfig.mockResolvedValue({ data: { openrouter_key_configured: true } })
  })

  it('shows "API key is configured" status text', async () => {
    renderPage()
    expect(await screen.findByText(/api key is configured/i)).toBeInTheDocument()
  })

  it('does not display the actual key value anywhere in the DOM', async () => {
    const fakeKey = 'sk-or-v1-supersecretkey1234567890'
    mockGetSystemConfig.mockResolvedValue({
      data: { openrouter_key_configured: true, key_value: fakeKey },
    })
    renderPage()
    await screen.findByText(/api key is configured/i)
    expect(screen.queryByText(fakeKey)).not.toBeInTheDocument()
    // The input should be empty (never pre-filled with the key)
    const input = document.querySelector('input[type="password"]') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('shows "Replace Key" label when a key is already configured', async () => {
    renderPage()
    expect(await screen.findByText(/replace key/i)).toBeInTheDocument()
  })
})

// ─── Tests: no key configured (warning banner) ────────────────────────────────

describe('SettingsPage - no key configured', () => {
  beforeEach(() => {
    mockGetSystemConfig.mockResolvedValue({ data: { openrouter_key_configured: false } })
  })

  it('shows warning banner when no key is configured', async () => {
    renderPage()
    expect(
      await screen.findByText(/no api key configured - ai assistant will not work/i),
    ).toBeInTheDocument()
  })

  it('warning banner has amber/warning styling', async () => {
    renderPage()
    const banner = await screen.findByText(/no api key configured/i)
    expect(banner.className).toContain('text-[color:var(--status-warn)]')
  })

  it('shows "API Key" label (not "Replace Key") when no key exists', async () => {
    renderPage()
    await screen.findByText(/no api key configured/i)
    expect(screen.getByText(/^api key$/i)).toBeInTheDocument()
    expect(screen.queryByText(/replace key/i)).not.toBeInTheDocument()
  })
})

// ─── Tests: save flow ─────────────────────────────────────────────────────────

describe('SettingsPage - save flow', () => {
  beforeEach(() => {
    mockGetSystemConfig.mockResolvedValue({ data: { openrouter_key_configured: false } })
    mockSaveOpenRouterKey.mockResolvedValue({ data: {} })
  })

  it('Save Key button is disabled when input is empty', async () => {
    renderPage()
    await screen.findByText(/no api key configured/i)
    expect(screen.getByRole('button', { name: /save key/i })).toBeDisabled()
  })

  it('Save Key button becomes enabled after typing a key', async () => {
    renderPage()
    await screen.findByText(/no api key configured/i)
    const input = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'sk-or-v1-abc123' } })
    expect(screen.getByRole('button', { name: /save key/i })).not.toBeDisabled()
  })

  it('shows success message after saving', async () => {
    renderPage()
    await screen.findByText(/no api key configured/i)

    const input = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'sk-or-v1-abc123' } })
    fireEvent.click(screen.getByRole('button', { name: /save key/i }))

    expect(await screen.findByText(/api key saved securely/i)).toBeInTheDocument()
  })

  it('success message has green styling', async () => {
    renderPage()
    await screen.findByText(/no api key configured/i)

    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: 'sk-or-v1-abc123' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /save key/i }))

    const notice = await screen.findByText(/api key saved securely/i)
    expect(notice.className).toContain('text-[color:var(--signal-green)]')
  })

  it('calls saveOpenRouterKey with the entered key value', async () => {
    renderPage()
    await screen.findByText(/no api key configured/i)

    const keyValue = 'sk-or-v1-mykey9876'
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: keyValue } },
    )
    fireEvent.click(screen.getByRole('button', { name: /save key/i }))

    await waitFor(() => {
      expect(mockSaveOpenRouterKey).toHaveBeenCalledWith(keyValue)
    })
  })

  it('input is cleared after a successful save', async () => {
    renderPage()
    await screen.findByText(/no api key configured/i)

    const input = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'sk-or-v1-abc123' } })
    fireEvent.click(screen.getByRole('button', { name: /save key/i }))

    await screen.findByText(/api key saved securely/i)
    expect(input.value).toBe('')
  })

  it('key value never appears in rendered text after saving', async () => {
    const secretKey = 'sk-or-v1-verysecretkey'
    renderPage()
    await screen.findByText(/no api key configured/i)

    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: secretKey } },
    )
    fireEvent.click(screen.getByRole('button', { name: /save key/i }))
    await screen.findByText(/api key saved securely/i)

    // The key must not appear as visible text anywhere in the DOM
    expect(screen.queryByText(secretKey)).not.toBeInTheDocument()
    // The input (type=password) must be cleared
    const input = document.querySelector('input[type="password"]') as HTMLInputElement
    expect(input.value).toBe('')
  })
})

// ─── Tests: error handling ────────────────────────────────────────────────────

describe('SettingsPage - save error', () => {
  beforeEach(() => {
    mockGetSystemConfig.mockResolvedValue({ data: { openrouter_key_configured: false } })
  })

  it('shows error message when save fails', async () => {
    mockSaveOpenRouterKey.mockRejectedValue(new Error('Server error'))
    renderPage()
    await screen.findByText(/no api key configured/i)

    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: 'sk-or-v1-bad' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /save key/i }))

    expect(await screen.findByText(/failed to save api key/i)).toBeInTheDocument()
  })
})
