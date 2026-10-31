// A failed load shows the shared ErrorAlert with Retry: never a crash (#10), and never an empty state that looks like "no data".
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeMember, makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { API, fail, ok, page, server } from '../../tests/server.js'
import DashboardPage from './dashboard/DashboardPage.jsx'
import NotesPanel from './notes/NotesPanel.jsx'
import SettingsPage from './settings/SettingsPage.jsx'

const LOAD_FAILED = 'Something went wrong on our side. Please try again.'
// Queries retry once (lib/queryClient.js), with a 1s delay, before they settle as failed.
const SETTLED = { timeout: 4000 }

/**
 * Serves GET `path` with a 500 until `fixed()` is called, then with `body()`.
 * @returns {{ fix: () => void }}
 */
function brokenUntilFixed(path, body) {
  let broken = true
  server.use(http.get(`${API}${path}`, () => (broken ? fail(500, 'INTERNAL_ERROR', 'Internal server error') : body())))
  return { fix: () => (broken = false) }
}

async function expectRetryRecovers(user, endpoint, recovered) {
  const alert = await screen.findByRole('alert', {}, SETTLED)
  expect(alert).toHaveTextContent(LOAD_FAILED)
  endpoint.fix()
  await user.click(within(alert).getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText(recovered, {}, SETTLED)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
}

describe('a failed load shows an error with Retry', () => {
  it('Settings → Members: the members list (#10, used to crash on members.map)', async () => {
    const members = brokenUntilFixed('/org/members', () => ok([makeMember('owner'), makeMember('member')]))
    server.use(http.get(`${API}/org/teams`, () => ok([])))
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />, { session: makeUser('owner') })
    await user.click(await screen.findByRole('button', { name: 'Members & Teams' }))

    await expectRetryRecovers(user, members, 'The member')
  })

  it('Settings → Members: the teams list', async () => {
    server.use(http.get(`${API}/org/members`, () => ok([makeMember('owner')])))
    const teams = brokenUntilFixed('/org/teams', () => ok([{ _id: 't1', name: 'Closers', memberIds: [] }]))
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />, { session: makeUser('owner') })
    await user.click(await screen.findByRole('button', { name: 'Members & Teams' }))

    expect(screen.queryByText('No teams yet.')).toBeNull()
    await expectRetryRecovers(user, teams, 'Closers')
  })

  it('Settings → Pipeline: the stages, not an empty list', async () => {
    const stages = brokenUntilFixed('/org/pipeline-stages', () => ok([{ key: 'lead', label: 'Lead in', order: 0 }]))
    server.use(http.get(`${API}/org/email-templates`, () => ok([])))
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />, { session: makeUser('owner') })
    await user.click(await screen.findByRole('button', { name: 'Pipeline & Templates' }))

    const alert = await screen.findByRole('alert', {}, SETTLED)
    expect(alert).toHaveTextContent(LOAD_FAILED)
    stages.fix()
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByDisplayValue('Lead in', {}, SETTLED)).toBeInTheDocument()
  })

  it('NotesPanel: not "No notes yet"', async () => {
    const notes = brokenUntilFixed('/notes', () => page([{ _id: 'n1', body: 'Called them', createdAt: '2026-10-01' }]))
    const user = userEvent.setup()
    renderWithProviders(<NotesPanel entityType="lead" entityId="l1" />, { session: makeUser('owner') })

    await screen.findByRole('alert', {}, SETTLED)
    expect(screen.queryByText('No notes yet.')).toBeNull()
    await expectRetryRecovers(user, notes, 'Called them')
  })

  it('Dashboard overview: not zeros', async () => {
    const overview = brokenUntilFixed('/dashboard/overview', () =>
      ok({ leadsByStatus: { new: 7 }, dealsByStage: [], openPipelineValue: 0, recentActivity: [] }),
    )
    server.use(http.get(`${API}/org/pipeline-stages`, () => ok([])))
    const user = userEvent.setup()
    renderWithProviders(<DashboardPage />, { session: makeUser('owner') })

    await screen.findByRole('alert', {}, SETTLED)
    expect(screen.queryByRole('group', { name: 'Total leads' })).toBeNull()
    await expectRetryRecovers(user, overview, 'Leads by status')
  })

  it('Dashboard reports: not a 0 win count', async () => {
    server.use(
      http.get(`${API}/dashboard/overview`, () =>
        ok({ leadsByStatus: {}, dealsByStage: [], openPipelineValue: 0, recentActivity: [] }),
      ),
      http.get(`${API}/org/pipeline-stages`, () => ok([])),
    )
    const reports = brokenUntilFixed('/dashboard/reports', () =>
      ok({ winRate: 0.5, won: 3, lost: 3, wonLostByMonth: [] }),
    )
    const user = userEvent.setup()
    renderWithProviders(<DashboardPage />, { session: makeUser('owner') })
    await user.click(await screen.findByRole('button', { name: 'Reports' }))

    await screen.findByRole('alert', {}, SETTLED)
    expect(screen.queryByRole('group', { name: 'Deals won' })).toBeNull()
    await expectRetryRecovers(user, reports, '50%')
  })
})
