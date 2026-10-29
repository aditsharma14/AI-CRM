// Settings tabs show management controls only to roles with org:manage, members:manage or pipeline:configure.
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import SettingsPage from './SettingsPage.jsx'
import { API, ok, server } from '../../../tests/server.js'
import { makeMember, makeUser } from '../../../tests/factories.js'
import { renderWithProviders } from '../../../tests/render.jsx'

const ROLES = ['owner', 'admin', 'manager', 'member']

async function openTab(role, tabName) {
  server.use(
    http.get(`${API}/org`, () => ok({ _id: 'org-1', name: 'Acme' })),
    http.get(`${API}/org/members`, () => ok([makeMember('owner')])),
    http.get(`${API}/org/teams`, () => ok([{ _id: 't1', name: 'Sales', memberIds: [] }])),
    http.get(`${API}/org/pipeline-stages`, () => ok([{ key: 'new', label: 'New', order: 0 }])),
    http.get(`${API}/org/email-templates`, () => ok([{ _id: 'e1', name: 'Welcome', subject: 'Hi' }])),
  )
  const user = userEvent.setup()
  renderWithProviders(<SettingsPage />, { session: makeUser(role) })
  await user.click(await screen.findByRole('button', { name: tabName }))
}

describe('Settings: Organization tab (org:manage)', () => {
  it.each(ROLES.map((r) => [r, r === 'owner']))('%s can rename the org: %s', async (role, allowed) => {
    await openTab(role, 'Organization')
    const name = await screen.findByDisplayValue('Acme')
    expect(name).toHaveProperty('disabled', !allowed)
    expect(Boolean(screen.queryByRole('button', { name: 'Save' }))).toBe(allowed)
  })
})

describe('Settings: Members & Teams tab (members:manage)', () => {
  it.each(ROLES.map((r) => [r, ['owner', 'admin'].includes(r)]))('%s sees invite and team controls: %s', async (role, allowed) => {
    await openTab(role, 'Members & Teams')
    await screen.findByText('Sales')
    expect(Boolean(screen.queryByRole('button', { name: 'Invite' }))).toBe(allowed)
    expect(Boolean(screen.queryByRole('button', { name: 'Add team' }))).toBe(allowed)
    expect(Boolean(screen.queryByRole('button', { name: 'Delete team Sales' }))).toBe(allowed)
  })
})

describe('Settings: Pipeline & Templates tab (pipeline:configure)', () => {
  it.each(ROLES.map((r) => [r, ['owner', 'admin'].includes(r)]))('%s can edit stages and templates: %s', async (role, allowed) => {
    await openTab(role, 'Pipeline & Templates')
    await screen.findByText('Welcome')
    expect(screen.getByDisplayValue('New')).toHaveProperty('disabled', !allowed)
    expect(Boolean(screen.queryByRole('button', { name: 'Add template' }))).toBe(allowed)
    expect(Boolean(screen.queryByRole('button', { name: 'Delete template Welcome' }))).toBe(allowed)
  })
})
