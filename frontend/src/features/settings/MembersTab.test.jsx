// Settings → Members: each role sees only the controls membership.js allows, and refused changes are shown, not swallowed.
import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import SettingsPage from './SettingsPage.jsx'
import { API, fail, ok, server } from '../../../tests/server.js'
import { makeMember, makeUser } from '../../../tests/factories.js'
import { renderWithProviders } from '../../../tests/render.jsx'

// One of each role, plus a second admin so an admin viewer has a peer.
const ROSTER = [
  makeMember('owner'),
  makeMember('admin'),
  makeMember('admin', { _id: 'user-admin-2', name: 'Peer admin', email: 'peer@acme.test' }),
  makeMember('manager'),
  makeMember('member'),
]
const NAMES = ROSTER.map((m) => m.name)

function serveRoster(roster = ROSTER) {
  server.use(
    http.get(`${API}/org/members`, () => ok(roster)),
    http.get(`${API}/org/teams`, () => ok([])),
  )
}

async function openMembersTab(viewerRole) {
  serveRoster()
  const user = userEvent.setup()
  renderWithProviders(<SettingsPage />, { session: makeUser(viewerRole) })
  await user.click(await screen.findByRole('button', { name: 'Members & Teams' }))
  await screen.findByText('Peer admin')
  return user
}

const roleSelect = (name) => screen.queryByRole('combobox', { name: `Role for ${name}` })
const removeButton = (name) => screen.queryByRole('button', { name: `Remove ${name}` })
const optionsOf = (select) => within(select).getAllByRole('option').map((o) => o.getAttribute('value'))

describe('Members tab: who sees which controls', () => {
  // Names whose row gets a role select and a remove button; every other row shows a badge only.
  it.each([
    ['owner', ['The admin', 'Peer admin', 'The manager', 'The member'], ['member', 'manager', 'admin']],
    ['admin', ['The manager', 'The member'], ['member', 'manager']],
    ['manager', [], null],
    ['member', [], null],
  ])('%s', async (viewer, managed, offered) => {
    await openMembersTab(viewer)

    for (const name of NAMES) {
      const expected = managed.includes(name)
      expect({ name, select: Boolean(roleSelect(name)), remove: Boolean(removeButton(name)) }).toEqual({
        name,
        select: expected,
        remove: expected,
      })
    }
    for (const name of managed) expect(optionsOf(roleSelect(name))).toEqual(offered)

    const inviteRole = screen.queryByRole('combobox', { name: 'Role' })
    if (offered) expect(optionsOf(inviteRole)).toEqual(offered)
    else expect(inviteRole).toBeNull()
  })
})

describe('Members tab: refused changes', () => {
  it('shows a 403 on a role change through the shared error display and snaps the select back', async () => {
    let patched = 0
    server.use(
      http.patch(`${API}/org/members/:id/role`, () => {
        patched += 1
        return fail(403, 'FORBIDDEN', 'Only the owner can manage admins.')
      }),
    )
    const user = await openMembersTab('owner')

    await user.selectOptions(roleSelect('The manager'), 'member')

    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner can manage admins.')
    expect(patched).toBe(1)
    await waitFor(() => expect(roleSelect('The manager')).toHaveValue('manager'))
  })

  it('shows a 403 on remove through the shared error display and keeps the row', async () => {
    server.use(http.delete(`${API}/org/members/:id`, () => fail(403, 'FORBIDDEN', 'Only the owner can manage admins.')))
    const user = await openMembersTab('owner')

    await user.click(removeButton('The member'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner can manage admins.')
    expect(screen.getByText('The member')).toBeInTheDocument()
  })

  it('clears the error once a later change succeeds', async () => {
    let refuse = true
    server.use(
      http.patch(`${API}/org/members/:id/role`, () =>
        refuse ? fail(403, 'FORBIDDEN', 'Only the owner can manage admins.') : ok(makeMember('member')),
      ),
    )
    const user = await openMembersTab('owner')
    await user.selectOptions(roleSelect('The manager'), 'member')
    await screen.findByRole('alert')

    refuse = false
    await user.selectOptions(roleSelect('The admin'), 'manager')

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
