// Changing a list's search or filter goes back to page 1 (#11): staying on page 3 of the old results can land on an empty page.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { API, ok, server } from '../../tests/server.js'
import CompaniesPage from './companies/CompaniesPage.jsx'
import ContactsPage from './contacts/ContactsPage.jsx'
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
  ['Leads', LeadsPage, '/leads', 'Search leads…', []],
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

describe('Leads status filter', () => {
  it('choosing a status on page 2 asks for page 1', async () => {
    const seen = serveThreePages('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('owner') })
    await goToPage2(user)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'qualified')

    await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'qualified', page: '1' }))
  })

  it('paging still works after a filter change', async () => {
    const seen = serveThreePages('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('owner') })
    await goToPage2(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'qualified')
    await screen.findByText('Row on page 1')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'qualified', page: '2' }))
  })
})
