// Money on the Dashboard is shown in the org's currency (session user.org.currency), and the owner sets it in
// Settings → Organization; the session picks it up at once.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeUser, ORG } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { API, ok, server } from '../../tests/server.js'
import { useSession } from '../context/SessionContext.jsx'
import DashboardPage from './dashboard/DashboardPage.jsx'
import SettingsPage from './settings/SettingsPage.jsx'

// The same formatter the app uses, so the test doesn't depend on the runner's locale.
const money = (value, currency) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

const inr = makeUser('owner', { org: { ...ORG, currency: 'INR' } })

function serveDashboard() {
  server.use(
    http.get(`${API}/dashboard/overview`, () =>
      ok({
        leadsByStatus: { new: 2 },
        dealsByStage: [{ stageKey: 'proposal', count: 2, value: 850000 }],
        openPipelineValue: 1250000,
        recentActivity: [],
      }),
    ),
    http.get(`${API}/dashboard/reports`, () =>
      ok({
        winRate: 0.5,
        won: 1,
        lost: 1,
        wonLostByMonth: [
          { _id: { year: 2026, month: 10, status: 'won' }, value: 300000 },
          { _id: { year: 2026, month: 10, status: 'lost' }, value: 120000 },
        ],
      }),
    ),
    http.get(`${API}/org/pipeline-stages`, () => ok([{ key: 'proposal', label: 'Proposal', order: 0 }])),
  )
}

describe('Dashboard totals use the org currency', () => {
  it('overview: open pipeline value and the per-stage totals', async () => {
    serveDashboard()
    renderWithProviders(<DashboardPage />, { session: inr })

    const card = await screen.findByRole('group', { name: 'Open pipeline value' })
    expect(card).toHaveTextContent(money(1250000, 'INR'))
    expect(await screen.findByText(`2 · ${money(850000, 'INR')}`)).toBeInTheDocument()
  })

  it('reports: won and lost by month', async () => {
    serveDashboard()
    const user = userEvent.setup()
    renderWithProviders(<DashboardPage />, { session: inr })
    await user.click(await screen.findByRole('button', { name: 'Reports' }))

    expect(await screen.findByTitle(`Won: ${money(300000, 'INR')}`)).toBeInTheDocument()
    expect(screen.getByTitle(`Lost: ${money(120000, 'INR')}`)).toBeInTheDocument()
  })

  it('USD when the session has no currency (an API from before the field)', async () => {
    serveDashboard()
    renderWithProviders(<DashboardPage />, { session: makeUser('owner') })
    expect(await screen.findByRole('group', { name: 'Open pipeline value' })).toHaveTextContent(money(1250000, 'USD'))
  })
})

function SessionCurrency() {
  return <output aria-label="session currency">{useSession().org?.currency ?? 'none'}</output>
}

describe('Settings → Organization: currency', () => {
  it('the owner picks one; it is saved and the session uses it straight away', async () => {
    let org = { _id: 'org-1', name: 'Acme', currency: 'USD' }
    const patches = []
    server.use(
      http.get(`${API}/org`, () => ok(org)),
      http.patch(`${API}/org`, async ({ request }) => {
        const body = await request.json()
        patches.push(body)
        org = { ...org, ...body }
        return ok(org)
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <SettingsPage />
        <SessionCurrency />
      </>,
      { session: makeUser('owner', { org: { ...ORG, currency: 'USD' } }) },
    )
    await user.click(await screen.findByRole('button', { name: 'Organization' }))

    const select = await screen.findByLabelText('Currency')
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['INR', 'USD', 'EUR', 'GBP'])
    expect(select).toHaveValue('USD')
    await user.selectOptions(select, 'INR')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByLabelText('session currency')).toHaveTextContent('INR')
    expect(patches).toEqual([{ name: 'Acme', currency: 'INR' }])
  })

  it('read-only for everyone but the owner', async () => {
    server.use(http.get(`${API}/org`, () => ok({ _id: 'org-1', name: 'Acme', currency: 'GBP' })))
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />, { session: makeUser('admin') })
    await user.click(await screen.findByRole('button', { name: 'Organization' }))
    const select = await screen.findByLabelText('Currency')
    expect(select).toHaveValue('GBP')
    expect(select).toBeDisabled()
  })
})
