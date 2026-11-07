import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NewAssessmentPage } from '../pages/NewAssessmentPage'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../api/client', () => ({
  createAssessment: vi.fn().mockResolvedValue({ data: { id: 'new-assessment-id' } }),
  createProblem: vi.fn().mockResolvedValue({ data: {} }),
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

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <NewAssessmentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Fills the assessment title field. */
function fillTitle(title = 'Test Assessment') {
  fireEvent.change(
    screen.getByPlaceholderText(/software engineer/i),
    { target: { value: title } },
  )
}

/** Adds one problem and fills required fields. */
function addFullProblem(opts: { withHidden: boolean } = { withHidden: true }) {
  fireEvent.click(screen.getByRole('button', { name: /add problem/i }))

  fireEvent.change(screen.getByPlaceholderText(/two sum/i), {
    target: { value: 'My Problem' },
  })
  fireEvent.change(screen.getByPlaceholderText(/describe the problem/i), {
    target: { value: 'A description' },
  })

  // Add a visible test case
  fireEvent.click(screen.getByRole('button', { name: /add test case/i }))
  const inputAreas = screen.getAllByPlaceholderText(/stdin input/i)
  fireEvent.change(inputAreas[inputAreas.length - 1], { target: { value: '1 2' } })
  const expectedAreas = screen.getAllByPlaceholderText(/expected stdout/i)
  fireEvent.change(expectedAreas[expectedAreas.length - 1], { target: { value: '3' } })

  if (opts.withHidden) {
    // Add a hidden test case
    fireEvent.click(screen.getByRole('button', { name: /add test case/i }))
    const allInputAreas = screen.getAllByPlaceholderText(/stdin input/i)
    fireEvent.change(allInputAreas[allInputAreas.length - 1], { target: { value: '5 6' } })
    const allExpectedAreas = screen.getAllByPlaceholderText(/expected stdout/i)
    fireEvent.change(allExpectedAreas[allExpectedAreas.length - 1], { target: { value: '11' } })

    // Mark last test case as hidden
    const hiddenCheckboxes = screen.getAllByRole('checkbox', { name: /hidden/i })
    fireEvent.click(hiddenCheckboxes[hiddenCheckboxes.length - 1])
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NewAssessmentPage - weight sliders', () => {
  it('renders with code 60% and AIU 40% by default', () => {
    renderPage()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText(/automatically set to 40%/i)).toBeInTheDocument()
  })

  it('adjusts AIU weight automatically when code weight slider moves', () => {
    renderPage()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '70' } })
    expect(screen.getByText('70%')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText(/automatically set to 30%/i)).toBeInTheDocument()
  })

  it('code + AIU always sums to 100 across multiple slider values', () => {
    renderPage()
    const slider = screen.getByRole('slider')
    // Check the "Automatically set to X%" paragraph which is unique in the DOM
    for (const v of [0, 25, 50, 75, 100]) {
      fireEvent.change(slider, { target: { value: String(v) } })
      expect(
        screen.getByText(`Automatically set to ${100 - v}%`),
      ).toBeInTheDocument()
    }
  })

  it('slider at 0 shows code 0% and AIU 100%', () => {
    renderPage()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
    expect(screen.getByText(/automatically set to 100%/i)).toBeInTheDocument()
  })
})

describe('NewAssessmentPage - save validation (inline errors, not alerts)', () => {
  let alertSpy: { mockRestore: () => void }

  beforeEach(() => {
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    alertSpy.mockRestore()
  })

  it('shows inline error when title is missing', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(await screen.findByText(/assessment title is required/i)).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('shows inline error when no problem is added', async () => {
    renderPage()
    fillTitle()
    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(await screen.findByText(/add at least one problem/i)).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('shows inline error when AIU metric weights do not sum to 100', async () => {
    renderPage()
    fillTitle()
    // Default weights are 25/25/25/25 = 100. Change first to 10 → total 85.
    const weightInputs = screen.getAllByDisplayValue('25')
    fireEvent.change(weightInputs[0], { target: { value: '10' } })

    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(await screen.findByText(/aiu metric weights must sum to 100/i)).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('shows inline error when problem has no hidden test case', async () => {
    renderPage()
    fillTitle()
    // Add a problem with 2 visible test cases but no hidden ones
    // (need ≥2 total test cases so that validation passes the "needs at least 2" check
    //  and reaches the "needs at least one hidden" check)
    fireEvent.click(screen.getByRole('button', { name: /add problem/i }))
    fireEvent.change(screen.getByPlaceholderText(/two sum/i), { target: { value: 'My Problem' } })
    fireEvent.change(screen.getByPlaceholderText(/describe the problem/i), {
      target: { value: 'A description' },
    })
    // First visible test case
    fireEvent.click(screen.getByRole('button', { name: /add test case/i }))
    let inputs = screen.getAllByPlaceholderText(/stdin input/i)
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '1 2' } })
    let expectedAreas = screen.getAllByPlaceholderText(/expected stdout/i)
    fireEvent.change(expectedAreas[expectedAreas.length - 1], { target: { value: '3' } })
    // Second visible test case (no hidden checkbox checked)
    fireEvent.click(screen.getByRole('button', { name: /add test case/i }))
    inputs = screen.getAllByPlaceholderText(/stdin input/i)
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '4 5' } })
    expectedAreas = screen.getAllByPlaceholderText(/expected stdout/i)
    fireEvent.change(expectedAreas[expectedAreas.length - 1], { target: { value: '9' } })

    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(await screen.findByText(/at least one hidden test case/i)).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('error message is rendered as DOM element, not via window.alert', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    const errorEl = await screen.findByText(/assessment title is required/i)
    expect(errorEl.tagName.toLowerCase()).not.toBe('body')
    expect(errorEl).toBeVisible()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('validation error clears and reappears on subsequent invalid saves', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(await screen.findByText(/assessment title is required/i)).toBeInTheDocument()

    fillTitle()
    // Next save triggers a different error (no problems), replacing the previous one
    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(await screen.findByText(/add at least one problem/i)).toBeInTheDocument()
    expect(screen.queryByText(/assessment title is required/i)).not.toBeInTheDocument()
  })
})

describe('NewAssessmentPage - markdown preview', () => {
  it('renders markdown preview for problem description', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /add problem/i }))

    const textarea = screen.getByPlaceholderText(/describe the problem/i)
    fireEvent.change(textarea, { target: { value: '## Hello **World**' } })

    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }))

    await waitFor(() => {
      // The form has multiple h2 section headings; filter by the one ReactMarkdown renders
      const h2s = screen.getAllByRole('heading', { level: 2 })
      const markdownH2 = h2s.find((el) => /hello world/i.test(el.textContent ?? ''))
      expect(markdownH2).toBeTruthy()
    })
  })

  it('shows empty-preview placeholder when description is blank', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /add problem/i }))
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }))
    expect(await screen.findByText(/nothing to preview yet/i)).toBeInTheDocument()
  })

  it('switches back to edit mode when Edit tab is clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /add problem/i }))
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByPlaceholderText(/describe the problem/i)).toBeInTheDocument()
  })
})
