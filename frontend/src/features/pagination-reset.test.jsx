// Changing a list's search or filter goes back to page 1 (#11): staying on page 3 of the old results can land on an empty
// page. Cursor lists (Leads, Pipeline) also drop their cursors: one from the old query would be refused (400).
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { API, ok, server } from '../../tests/server.js'
import CompaniesPage from './companies/CompaniesPage.jsx'
import ContactsPage from './contacts/ContactsPage.jsx'
import PipelinePage from './deals/PipelinePage.jsx'
import LeadsPage from './leads/LeadsPage.jsx'

/** Serves a 3-page list at `path` and records each request's query. */
function serveThreePages(path, extra = []) {
  /** @type {Record<string, string>[]} */
  const seen = []
  server.use(
    http.get(`${API}${path}`, ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams)
      seen.push(query)
      const n = Number(query.page)
      return ok([{ _id: `row-${n}`, name: `Row on page ${n}` }], { page: n, limit: 20, total: 60, hasMore: n < 3 })
    }),
    ...extra,
  )
  return seen
}

async function goToPage2(user) {
  await screen.findByText('Row on page 1')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Row on page 2')
}

const companiesForContacts = http.get(`${API}/companies`, () =>
  ok([], { page: 1, limit: 100, total: 0, hasMore: false }),
)

describe.each([
  ['Contacts', ContactsPage, '/contacts', 'Search contacts…', [companiesForContacts]],
  ['Companies', CompaniesPage, '/companies', 'Search companies…', []],
])('%s', (_, Page, path, placeholder, extra) => {
  it('typing a search on page 2 asks for page 1', async () => {
    const seen = serveThreePages(path, extra)
    const user = userEvent.setup()
    renderWithProviders(<Page />, { session: makeUser('owner') })
    await goToPage2(user)

    await user.type(screen.getByPlaceholderText(placeholder), 'acme')

    await waitFor(() => expect(seen.at(-1)).toMatchObject({ q: 'acme', page: '1' }))
    expect(seen.filter((q) => q.q === 'acme').map((q) => q.page)).toEqual(['1'])
  })
})

/** Serves a 3-page cursor list at `path` (no cursor, then c2, then c3) and records each request's query. */
function serveThreeCursorPages(path) {
  /** @type {Record<string, string>[]} */
  const seen = []
  server.use(
    http.get(`${API}${path}`, ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams)
      seen.push(query)
      const n = query.cursor ? Number(query.cursor.slice(1)) : 1
      const row = { _id: `row-${n}`, name: `Row on page ${n}`, title: `Row on page ${n}`, value: 0, stageKey: 'new' }
      return ok([row], { limit: 20, hasMore: n < 3, nextCursor: n < 3 ? `c${n + 1}` : null })
    }),
  )
  return seen
}

describe('Leads (cursor pages)', () => {
  it('Next sends the cursor the API gave; Prev goes back; the footer counts pages', async () => {
    const seen = serveThreeCursorPages('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('owner') })
    await goToPage2(user)
    expect(seen.at(-1)).toMatchObject({ cursor: 'c2' })
    expect(screen.getByText('page 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Row on page 3')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Prev' }))
    await screen.findByText('Row on page 2')
    await user.click(screen.getByRole('button', { name: 'Prev' }))
    await screen.findByText('Row on page 1')
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    expect(seen[0]).not.toHaveProperty('cursor')
  })

  it('typing a search on page 2 starts again without a cursor', async () => {
    const seen = serveThreeCursorPages('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('owner') })
    await goToPage2(user)

    await user.type(screen.getByPlaceholderText('Search leads…'), 'acme')

    await waitFor(() => expect(seen.at(-1)).toMatchObject({ q: 'acme' }))
    for (const query of seen.filter((q) => q.q !== undefined)) expect(query).not.toHaveProperty('cursor')
    expect(await screen.findByText('page 1')).toBeInTheDocument()
  })
})

describe('Pipeline (cursor pages)', () => {
  it('pages through deals with the API’s cursors', async () => {
    const seen = serveThreeCursorPages('/deals')
    server.use(http.get(`${API}/org/pipeline-stages`, () => ok([{ key: 'new', label: 'New', order: 0 }])))
    const user = userEvent.setup()
    renderWithProviders(<PipelinePage />, { session: makeUser('owner') })
    await goToPage2(user)
    expect(seen.at(-1)).toMatchObject({ cursor: 'c2', sort: '-createdAt' })
    expect(seen.every((q) => !('page' in q))).toBe(true)
  })
})

describe('Leads status filter', () => {
  it('choosing a status on page 2 starts again without a cursor', async () => {
    const seen = serveThreeCursorPages('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('owner') })
    await goToPage2(user)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'qualified')

    await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'qualified' }))
    expect(seen.at(-1)).not.toHaveProperty('cursor')
  })

  it('paging still works after a filter change, with the new list’s cursor', async () => {
    const seen = serveThreeCursorPages('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('owner') })
    await goToPage2(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'qualified')
    await screen.findByText('Row on page 1')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'qualified', cursor: 'c2' }))
  })
})
