// Settings (#13): every save, create and delete shows a refused or failed write with a specific message for 4xx and a
// generic one for 500, keeps what the user typed, and never shows the unsaved value as saved.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeMember, makeUser } from '../../../tests/factories.js'
import { renderWithProviders } from '../../../tests/render.jsx'
import { API, fail, ok, server } from '../../../tests/server.js'
import SettingsPage from './SettingsPage.jsx'

const FAILURES = [
  [400, 'VALIDATION_ERROR', 'name: Too small: expected string to have >=2 characters'],
  [403, 'FORBIDDEN', 'Only the owner can do that.'],
  [500, 'INTERNAL_ERROR', 'Internal server error'],
]
const SAVE_FAILED = "Something went wrong on our side. Your changes weren't saved. Try again."
const shownFor = (status, message) => (status === 500 ? SAVE_FAILED : message)

async function openTab(tabName) {
  server.use(
    http.get(`${API}/org`, () => ok({ _id: 'org-1', name: 'Acme' })),
    http.get(`${API}/org/members`, () => ok([makeMember('owner'), makeMember('member')])),
    http.get(`${API}/org/teams`, () => ok([{ _id: 't1', name: 'Sales', memberIds: [] }])),
    http.get(`${API}/org/pipeline-stages`, () => ok([{ key: 'new', label: 'New', order: 0 }])),
    http.get(`${API}/org/email-templates`, () => ok([{ _id: 'e1', name: 'Welcome', subject: 'Hi' }])),
  )
  const user = userEvent.setup()
  renderWithProviders(<SettingsPage />, { session: makeUser('owner') })
  if (tabName !== 'Profile') await user.click(await screen.findByRole('button', { name: tabName }))
  return user
}

async function retype(user, input, value) {
  await user.clear(input)
  await user.type(input, value)
}

describe.each(FAILURES)('Settings when the API answers %i', (status, code, message) => {
  const shown = shownFor(status, message)

  it('Profile → name: shows the error and keeps the typed name', async () => {
    server.use(http.patch(`${API}/org/me`, () => fail(status, code, message)))
    const user = await openTab('Profile')
    await retype(user, await screen.findByLabelText('Name'), 'New Name')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByLabelText('Name')).toHaveValue('New Name')
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('Organization → name: shows the error and keeps the typed name', async () => {
    server.use(http.patch(`${API}/org`, () => fail(status, code, message)))
    const user = await openTab('Organization')
    await retype(user, await screen.findByDisplayValue('Acme'), 'Acme Two')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByLabelText('Name')).toHaveValue('Acme Two')
  })

  it('Members → add team: shows the error and keeps the typed name', async () => {
    server.use(http.post(`${API}/org/teams`, () => fail(status, code, message)))
    const user = await openTab('Members & Teams')
    await user.type(await screen.findByRole('textbox', { name: 'New team name' }), 'Closers')
    await user.click(screen.getByRole('button', { name: 'Add team' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByRole('textbox', { name: 'New team name' })).toHaveValue('Closers')
  })

  it('Members → delete team: shows the error and the team stays', async () => {
    server.use(http.delete(`${API}/org/teams/:id`, () => fail(status, code, message)))
    const user = await openTab('Members & Teams')
    await user.click(await screen.findByRole('button', { name: 'Delete team Sales' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByText('Sales')).toBeInTheDocument()
  })

  it('Members → invite: shows the error and keeps the email', async () => {
    server.use(http.post(`${API}/org/members/invite`, () => fail(status, code, message)))
    const user = await openTab('Members & Teams')
    await user.type(await screen.findByLabelText('Invite by email'), 'new@acme.test')
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByLabelText('Invite by email')).toHaveValue('new@acme.test')
    expect(screen.queryByText(/Invite sent/)).toBeNull()
  })

  it('Pipeline → stage names: shows the error and keeps the draft label', async () => {
    server.use(http.patch(`${API}/org/pipeline-stages`, () => fail(status, code, message)))
    const user = await openTab('Pipeline & Templates')
    await retype(user, await screen.findByRole('textbox', { name: 'Label for stage new' }), 'Fresh')
    await user.click(screen.getByRole('button', { name: 'Save stage names' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByRole('textbox', { name: 'Label for stage new' })).toHaveValue('Fresh')
  })

  it('Pipeline → add template: shows the error and keeps the inputs', async () => {
    server.use(http.post(`${API}/org/email-templates`, () => fail(status, code, message)))
    const user = await openTab('Pipeline & Templates')
    const form = within((await screen.findByRole('button', { name: 'Add template' })).closest('form'))
    await user.type(form.getByLabelText('Name'), 'Follow-up')
    await user.type(form.getByLabelText('Subject'), 'Checking in')
    await user.type(form.getByLabelText('Body'), 'Hi there')
    await user.click(form.getByRole('button', { name: 'Add template' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(form.getByLabelText('Subject')).toHaveValue('Checking in')
    expect(screen.queryByText('Follow-up', { selector: 'p' })).toBeNull()
  })

  it('Pipeline → delete template: shows the error and the template stays', async () => {
    server.use(http.delete(`${API}/org/email-templates/:id`, () => fail(status, code, message)))
    const user = await openTab('Pipeline & Templates')
    await user.click(await screen.findByRole('button', { name: 'Delete template Welcome' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
  })
})

describe('Profile → change password', () => {
  async function submitPassword(user) {
    await user.type(await screen.findByLabelText('Current password'), 'old-password')
    await user.type(screen.getByLabelText('New password'), 'new-password-1')
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
  }

  it('a backend field error shows under the New password field, not as a page alert', async () => {
    server.use(
      http.patch(`${API}/org/me/password`, () =>
        fail(400, 'VALIDATION_ERROR', 'newPassword: must be at most 72 bytes'),
      ),
    )
    const user = await openTab('Profile')
    await submitPassword(user)

    await waitFor(() =>
      expect(screen.getByLabelText('New password')).toHaveAccessibleDescription('must be at most 72 bytes'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    [401, 'INVALID_CREDENTIALS', 'Current password is incorrect.', 'Current password is incorrect.'],
    [500, 'INTERNAL_ERROR', 'Internal server error', SAVE_FAILED],
  ])('%i: shows the error in the alert', async (status, code, message, shown) => {
    server.use(http.patch(`${API}/org/me/password`, () => fail(status, code, message)))
    const user = await openTab('Profile')
    await submitPassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.queryByText(/Password changed/)).toBeNull()
  })
})
