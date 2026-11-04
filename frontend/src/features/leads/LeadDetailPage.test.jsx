// The lead page: details, one history of activities and notes (newest first, each with an anchor id), a 404 state,
// and the Leads list's name link that opens it.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../../tests/factories.js'
import { renderWithProviders } from '../../../tests/render.jsx'
import { API, fail, ok, page, server } from '../../../tests/server.js'
import { historyOf } from './history.js'
import LeadDetailPage from './LeadDetailPage.jsx'
import LeadsPage from './LeadsPage.jsx'

const LEAD_ID = 'a'.repeat(24)
const LEAD = {
  _id: LEAD_ID,
  name: 'Ravi Deshpande',
  email: 'ravi@sahyadri.example',
  status: 'qualified',
  score: 72,
  source: 'IndiaMART',
  companyId: { _id: 'c'.repeat(24), name: 'Sahyadri Packaging' },
  createdAt: '2026-10-01T09:00:00.000Z',
}
const ACTIVITIES = [
  {
    _id: '1'.repeat(24),
    type: 'call',
    title: 'Discovery call',
    description: 'Needs 40 printers',
    startAt: '2026-10-30T11:00:00.000Z',
    status: 'done',
    createdAt: '2026-10-30T11:00:00.000Z',
  },
  {
    _id: '2'.repeat(24),
    type: 'task',
    title: 'Send quote',
    dueDate: '2026-11-07T10:00:00.000Z',
    status: 'open',
    createdAt: '2026-11-01T10:00:00.000Z',
  },
]
const NOTES = [{ _id: '3'.repeat(24), body: 'Budget approved', createdAt: '2026-11-03T16:00:00.000Z' }]

function serveLead({ lead = LEAD, activities = ACTIVITIES, notes = NOTES } = {}) {
  const seen = []
  server.use(
    http.get(`${API}/leads/:id`, ({ params }) =>
      lead && params.id === LEAD_ID ? ok(lead) : fail(404, 'NOT_FOUND', 'Lead not found.'),
    ),
    http.get(`${API}/activities`, ({ request }) => {
      seen.push(Object.fromEntries(new URL(request.url).searchParams))
      return page(activities)
    }),
    http.get(`${API}/notes`, ({ request }) => {
      seen.push(Object.fromEntries(new URL(request.url).searchParams))
      return page(notes)
    }),
    http.get(`${API}/config`, () => ok({ emailEnabled: false, aiEnabled: false })),
  )
  return seen
}

const renderPage = (id = LEAD_ID) =>
  renderWithProviders(
    <Routes>
      <Route path="/leads/:id" element={<LeadDetailPage />} />
      <Route path="/leads" element={<p>the leads list</p>} />
    </Routes>,
    { session: makeUser('member'), route: `/leads/${id}` },
  )

describe('LeadDetailPage', () => {
  it('shows the lead and one history, newest first, each entry with an anchor id', async () => {
    const seen = serveLead()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Ravi Deshpande' })).toBeInTheDocument()
    expect(
      screen.getByText(/Sahyadri Packaging · ravi@sahyadri.example · from IndiaMART · score 72/),
    ).toBeInTheDocument()

    const items = within(await screen.findByRole('list')).getAllByRole('listitem')
    expect(items.map((li) => li.id)).toEqual([
      `history-${'2'.repeat(24)}`,
      `history-${'3'.repeat(24)}`,
      `history-${'1'.repeat(24)}`,
    ])
    expect(items[0]).toHaveTextContent('Send quote')
    expect(items[0]).toHaveTextContent('open')
    expect(items[1]).toHaveTextContent('Budget approved')
    expect(seen).toContainEqual(expect.objectContaining({ entityType: 'lead', entityId: LEAD_ID }))
  })

  it('an empty history says so', async () => {
    serveLead({ activities: [], notes: [] })
    renderPage()
    expect(await screen.findByText('No history yet')).toBeInTheDocument()
  })

  it('a lead that does not exist (or is in another workspace) shows "Lead not found" and a way back', async () => {
    serveLead()
    const user = userEvent.setup()
    renderPage('b'.repeat(24))
    expect(await screen.findByText('Lead not found')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Leads' }))
    expect(await screen.findByText('the leads list')).toBeInTheDocument()
  })

  it('historyOf dates a task by its due date and an event by its start', () => {
    const merged = historyOf(ACTIVITIES, NOTES)
    expect(merged.map((h) => [h.kind, h.date])).toEqual([
      ['task', '2026-11-07T10:00:00.000Z'],
      ['note', '2026-11-03T16:00:00.000Z'],
      ['call', '2026-10-30T11:00:00.000Z'],
    ])
  })
})

describe('the Leads list links to the page', () => {
  it("the lead's name opens its page; the rest of the row still opens the edit dialog", async () => {
    serveLead()
    server.use(http.get(`${API}/leads`, () => ok([LEAD], { limit: 20, hasMore: false, nextCursor: null })))
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/:id" element={<LeadDetailPage />} />
      </Routes>,
      { session: makeUser('owner'), route: '/leads' },
    )
    await user.click(await screen.findByText('ravi@sahyadri.example'))
    expect(await screen.findByRole('dialog', { name: 'Edit lead' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('link', { name: 'Ravi Deshpande' }))
    expect(await screen.findByRole('heading', { name: 'Ravi Deshpande' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
