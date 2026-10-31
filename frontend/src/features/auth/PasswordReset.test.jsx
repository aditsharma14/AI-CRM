// Forgot password → reset password: the token leaves the URL, every state (missing, form, submitting, success, expired)
// is reachable, the client refuses what the API would, and server errors land on the right field or alert.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../../tests/render.jsx'
import { API, fail, ok, server } from '../../../tests/server.js'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from './AuthPages.jsx'

const TOKEN = 'a'.repeat(64)
const NEW_PASSWORD = 'correct-horse-battery'

function AuthRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
    </Routes>
  )
}

/** Opens /reset-password?token=… in both the router and the real address bar (which replaceState edits). */
function openResetLink(search = `?token=${TOKEN}`, { strict = false } = {}) {
  window.history.replaceState(null, '', `/reset-password${search}`)
  renderWithProviders(<AuthRoutes />, { route: `/reset-password${search}`, strict })
}

/** Records reset requests and answers each with `respond`. */
function serveReset(respond = () => ok(null)) {
  const bodies = []
  server.use(
    http.post(`${API}/auth/reset-password`, async ({ request }) => {
      bodies.push(await request.json())
      return respond()
    }),
  )
  return bodies
}

async function fillAndSubmit(user, password = NEW_PASSWORD, confirm = password) {
  await user.type(await screen.findByLabelText('New password'), password)
  await user.type(screen.getByLabelText('Confirm new password'), confirm)
  await user.click(screen.getByRole('button', { name: 'Set new password' }))
}

afterEach(() => window.history.replaceState(null, '', '/'))

describe('Reset password: the token', () => {
  it('is removed from the address bar as soon as the page opens, and still sent with the form', async () => {
    const bodies = serveReset()
    const user = userEvent.setup()
    openResetLink()

    await screen.findByLabelText('New password')
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/reset-password')

    await fillAndSubmit(user)
    await waitFor(() => expect(bodies).toEqual([{ token: TOKEN, password: NEW_PASSWORD }]))
  })

  it('survives StrictMode (as main.jsx renders it): the effect runs twice, the token is still sent', async () => {
    const bodies = serveReset()
    const user = userEvent.setup()
    openResetLink(undefined, { strict: true })

    await fillAndSubmit(user)
    await waitFor(() => expect(bodies).toEqual([{ token: TOKEN, password: NEW_PASSWORD }]))
    expect(window.location.search).toBe('')
  })

  it('missing: says so, links to request a new email, and shows no form', async () => {
    openResetLink('')
    expect(await screen.findByRole('heading', { name: 'This reset link is incomplete' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByLabelText('New password')).toBeNull()
  })
})

describe('Reset password: submitting', () => {
  it('success: goes to sign-in with a toast', async () => {
    serveReset()
    const user = userEvent.setup()
    openResetLink()
    await fillAndSubmit(user)

    expect(await screen.findByRole('status')).toHaveTextContent('Password changed. Sign in with your new password.')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('while the request is in flight the button is disabled and says so', async () => {
    let release
    server.use(
      http.post(`${API}/auth/reset-password`, () => new Promise((resolve) => (release = () => resolve(ok(null))))),
    )
    const user = userEvent.setup()
    openResetLink()
    await fillAndSubmit(user)

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    release()
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('expired or used token: the expired state, with a link to request a new email', async () => {
    serveReset(() => fail(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.'))
    const user = userEvent.setup()
    openResetLink()
    await fillAndSubmit(user)

    expect(await screen.findByRole('heading', { name: 'This reset link has expired' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('mismatched passwords: an error under Confirm, and nothing is sent', async () => {
    const bodies = serveReset()
    const user = userEvent.setup()
    openResetLink()
    await fillAndSubmit(user, NEW_PASSWORD, `${NEW_PASSWORD}x`)

    await waitFor(() =>
      expect(screen.getByLabelText('Confirm new password')).toHaveAccessibleDescription('Passwords do not match'),
    )
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('aria-invalid', 'true')
    expect(bodies).toEqual([])
  })

  it('a password the API would refuse (8 spaces) is refused here, under the field, and nothing is sent', async () => {
    const bodies = serveReset()
    const user = userEvent.setup()
    openResetLink()
    await fillAndSubmit(user, ' '.repeat(8))

    await waitFor(() =>
      expect(screen.getByLabelText('New password')).toHaveAccessibleDescription('must not be only whitespace'),
    )
    expect(bodies).toEqual([])
  })

  it('a backend field error shows under New password, not as an alert, and the form stays', async () => {
    serveReset(() => fail(400, 'VALIDATION_ERROR', 'password: must be at most 72 bytes'))
    const user = userEvent.setup()
    openResetLink()
    await fillAndSubmit(user)

    await waitFor(() =>
      expect(screen.getByLabelText('New password')).toHaveAccessibleDescription('must be at most 72 bytes'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('New password')).toHaveValue(NEW_PASSWORD)
  })

  it('a 500: the generic message in an alert, and the form stays for a retry', async () => {
    serveReset(() => fail(500, 'INTERNAL_ERROR', 'Internal server error'))
    const user = userEvent.setup()
    openResetLink()
    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Something went wrong on our side. Your changes weren't saved.",
    )
    expect(screen.getByLabelText('New password')).toHaveValue(NEW_PASSWORD)
  })
})

describe('Reset password: the form', () => {
  it('Show passwords reveals both fields, and hides them again', async () => {
    const user = userEvent.setup()
    openResetLink()
    const toggle = await screen.findByRole('button', { name: 'Show passwords' })
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'text')

    await user.click(toggle)
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')
  })

  it('the rule is described on the password field', async () => {
    openResetLink()
    expect(await screen.findByLabelText('New password')).toHaveAccessibleDescription(/at least 8 characters/i)
  })
})

describe('Forgot password', () => {
  it('sends the email and says a link is on its way, whether or not the account exists', async () => {
    const bodies = []
    server.use(
      http.post(`${API}/auth/forgot-password`, async ({ request }) => {
        bodies.push(await request.json())
        return ok(null)
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<AuthRoutes />, { route: '/forgot-password' })

    await user.type(await screen.findByLabelText('Email'), 'pat@acme.test')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists for pat@acme.test')
    expect(bodies).toEqual([{ email: 'pat@acme.test' }])
  })

  it('a failed request shows the error and keeps the email', async () => {
    server.use(http.post(`${API}/auth/forgot-password`, () => fail(500, 'INTERNAL_ERROR', 'Internal server error')))
    const user = userEvent.setup()
    renderWithProviders(<AuthRoutes />, { route: '/forgot-password' })

    await user.type(await screen.findByLabelText('Email'), 'pat@acme.test')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('pat@acme.test')
  })

  it('is linked from sign-in', async () => {
    renderWithProviders(<AuthRoutes />, { route: '/login' })
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })
})
