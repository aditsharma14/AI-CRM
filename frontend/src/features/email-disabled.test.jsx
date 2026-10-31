// No email provider until S2.6 (GET /config → emailEnabled). Off: sign-in offers no "Forgot password?", /forgot-password
// says reset isn't available, and an invite's link is shown to the admin who sent it with a Copy button. On: as before.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { makeMember, makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { API, ok, server } from '../../tests/server.js'
import { ForgotPasswordPage, LoginPage } from './auth/AuthPages.jsx'
import SettingsPage from './settings/SettingsPage.jsx'

const TOKEN = 'b'.repeat(64)

function serveConfig(emailEnabled) {
  server.use(http.get(`${API}/config`, () => ok({ emailEnabled })))
}

function AuthRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
    </Routes>
  )
}

async function openMembers(role, inviteResponse) {
  const posted = []
  server.use(
    http.get(`${API}/org/members`, () => ok([makeMember('owner'), makeMember('admin')])),
    http.get(`${API}/org/teams`, () => ok([])),
    http.post(`${API}/org/members/invite`, async ({ request }) => {
      posted.push(await request.json())
      return ok(inviteResponse, null, 201)
    }),
  )
  const user = userEvent.setup()
  renderWithProviders(<SettingsPage />, { session: makeUser(role) })
  await user.click(await screen.findByRole('button', { name: 'Members & Teams' }))
  await screen.findByText('The admin')
  return { user, posted }
}

async function sendInvite(user, email = 'new@acme.test') {
  await user.type(screen.getByLabelText('Invite by email'), email)
  await user.click(screen.getByRole('button', { name: 'Invite' }))
}

describe('email off', () => {
  it('sign-in offers no "Forgot password?"', async () => {
    serveConfig(false)
    renderWithProviders(<AuthRoutes />, { route: '/login' })
    await screen.findByRole('button', { name: 'Sign in' })
    // The config has answered once the link would have appeared.
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Forgot password?' })).toBeNull())
  })

  it('/forgot-password says reset is not available yet, and asks for no email', async () => {
    serveConfig(false)
    renderWithProviders(<AuthRoutes />, { route: '/forgot-password' })
    expect(await screen.findByRole('heading', { name: 'Password reset isn’t available yet' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('an invite shows its link to the inviter, with a working Copy button', async () => {
    serveConfig(false)
    const { user, posted } = await openMembers('owner', { inviteUrl: `/invite/${TOKEN}` })
    await sendInvite(user)

    const link = await screen.findByRole('textbox', { name: 'Invite link for new@acme.test' })
    expect(link).toHaveValue(`${window.location.origin}/invite/${TOKEN}`)
    expect(link).toHaveAttribute('readonly')
    expect(posted).toEqual([{ email: 'new@acme.test', role: 'member' }])

    await user.click(screen.getByRole('button', { name: 'Copy invite link' }))
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/invite/${TOKEN}`)
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('nobody else sees a link: another admin opening Members has none (the server never returns it to them)', async () => {
    serveConfig(false)
    await openMembers('admin', null)
    expect(screen.queryByRole('button', { name: 'Copy invite link' })).toBeNull()
    expect(screen.queryByDisplayValue(/\/invite\//)).toBeNull()
  })

  it('the next invite replaces the link, and a failed one clears it', async () => {
    serveConfig(false)
    const { user } = await openMembers('owner', { inviteUrl: `/invite/${TOKEN}` })
    await sendInvite(user)
    await screen.findByRole('button', { name: 'Copy invite link' })

    server.use(http.post(`${API}/org/members/invite`, () => ok(null, null, 400)))
    await sendInvite(user, 'other@acme.test')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Copy invite link' })).toBeNull())
  })
})

describe('email on', () => {
  it('sign-in links to Forgot password, and the page asks for an email', async () => {
    serveConfig(true)
    const user = userEvent.setup()
    renderWithProviders(<AuthRoutes />, { route: '/login' })
    await user.click(await screen.findByRole('link', { name: 'Forgot password?' }))
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  })

  it('an invite says it was sent and shows no link', async () => {
    serveConfig(true)
    const { user } = await openMembers('owner', null)
    await sendInvite(user)
    expect(await screen.findByText(/Invite sent/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy invite link' })).toBeNull()
  })
})
