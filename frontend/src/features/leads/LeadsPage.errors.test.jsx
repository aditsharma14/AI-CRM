// Leads: a refused or failed save, convert or delete is shown through ErrorAlert with a specific message; nothing unsaved shows as saved.
import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import LeadsPage from './LeadsPage.jsx'
import { API, fail, page, server } from '../../../tests/server.js'
import { makeUser } from '../../../tests/factories.js'
import { renderWithProviders } from '../../../tests/render.jsx'

const LEAD = { _id: 'l1', name: 'Acme', status: 'new', score: 0, ownerId: 'user-owner', createdAt: '2026-10-01' }

// What the server says for each status, and what the user should read.
const FAILURES = [
  [400, 'VALIDATION_ERROR', 'name: Too small: expected string to have >=1 characters', 'name: Too small: expected string to have >=1 characters'],
  [403, 'FORBIDDEN', 'You can only change records you own.', 'You can only change records you own.'],
  // A 500's server text is not for users; they get what happened and what to do.
  [500, 'INTERNAL_ERROR', 'Internal server error', "Something went wrong on our side. Your changes weren't saved. Try again."],
]

async function setup() {
  server.use(
    http.get(`${API}/leads`, () => page([LEAD])),
    http.get(`${API}/notes`, () => page([])),
  )
  const user = userEvent.setup()
  renderWithProviders(<LeadsPage />, { session: makeUser('owner') })
  await screen.findByRole('cell', { name: 'Acme' })
  return user
}

async function openLead(user) {
  await user.click(screen.getByRole('cell', { name: 'Acme' }))
  return within(await screen.findByRole('dialog', { name: 'Edit lead' }))
}

describe.each(FAILURES)('Leads when the API answers %i', (status, code, serverMessage, shown) => {
  it('save: shows the error, keeps the dialog and the typed value, and the table still shows the saved name', async () => {
    server.use(http.patch(`${API}/leads/:id`, () => fail(status, code, serverMessage)))
    const user = await setup()
    const dialog = await openLead(user)

    await user.clear(dialog.getByLabelText('Name'))
    await user.type(dialog.getByLabelText('Name'), 'Acme renamed')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(shown)
    expect(dialog.getByLabelText('Name')).toHaveValue('Acme renamed')
    expect(screen.getByRole('cell', { name: 'Acme' })).toBeInTheDocument()
  })

  it('create: shows the error and keeps the dialog open with the input', async () => {
    server.use(http.post(`${API}/leads`, () => fail(status, code, serverMessage)))
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'New lead' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New lead' }))

    await user.type(dialog.getByLabelText('Name'), 'Brand new')
    await user.click(dialog.getByRole('button', { name: 'Create' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(shown)
    expect(dialog.getByLabelText('Name')).toHaveValue('Brand new')
    expect(screen.queryByRole('cell', { name: 'Brand new' })).toBeNull()
  })

  it('convert: shows the error in the dialog and the lead stays unconverted', async () => {
    server.use(http.post(`${API}/leads/:id/convert`, () => fail(status, code, serverMessage)))
    const user = await setup()
    const dialog = await openLead(user)

    await user.click(dialog.getByRole('button', { name: 'Convert to deal' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByRole('row', { name: /Acme/ })).toHaveTextContent('new')
  })

  it('delete: shows the error on the page and the row stays', async () => {
    server.use(http.delete(`${API}/leads/:id`, () => fail(status, code, serverMessage)))
    const user = await setup()
    const dialog = await openLead(user)

    await user.click(dialog.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this lead?' })).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByRole('cell', { name: 'Acme' })).toBeInTheDocument()
  })
})

describe('Leads error lifecycle', () => {
  it('clears the error when the dialog is reopened', async () => {
    server.use(http.patch(`${API}/leads/:id`, () => fail(403, 'FORBIDDEN', 'You can only change records you own.')))
    const user = await setup()
    let dialog = await openLead(user)
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await dialog.findByRole('alert')

    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    dialog = await openLead(user)

    expect(dialog.queryByRole('alert')).toBeNull()
  })

  it('names a network failure as such', async () => {
    server.use(http.patch(`${API}/leads/:id`, () => Response.error()))
    const user = await setup()
    const dialog = await openLead(user)
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent("Can't reach the server. Check your connection and try again.")
  })
})
