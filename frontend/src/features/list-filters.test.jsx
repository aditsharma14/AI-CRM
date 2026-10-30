// Filter UIs send exactly the params the backend's strict list schemas accept (see backend tests/list-filters.test.js).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { recordList } from '../../tests/server.js'
import { queryClient } from '../lib/queryClient.js'
import LeadsPage from './leads/LeadsPage.jsx'
import NotesPanel from './notes/NotesPanel.jsx'

describe('Leads status filter', () => {
  it('sends no status at first, then ?status=<choice>, then none again for "All statuses"', async () => {
    const requests = recordList('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('member') })

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({ page: '1', limit: '20' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'qualified')
    await waitFor(() => expect(requests.at(-1)).toEqual({ page: '1', limit: '20', status: 'qualified' }))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), '')
    // Back to the first query: served from cache or refetched, either way no stray empty status.
    await waitFor(() => expect(requests.every((q) => q.status !== '')).toBe(true))
  })

  it('sends the search box as ?q= (debounced), alongside the status', async () => {
    const requests = recordList('/leads')
    const user = userEvent.setup()
    renderWithProviders(<LeadsPage />, { session: makeUser('member') })
    await waitFor(() => expect(requests).toHaveLength(1))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'new')
    await user.type(screen.getByPlaceholderText('Search leads…'), 'acme')

    await waitFor(() => expect(requests.at(-1)).toEqual({ page: '1', limit: '20', status: 'new', q: 'acme' }))
  })
})

describe('NotesPanel', () => {
  it('asks only for the notes of its own record', async () => {
    const requests = recordList('/notes')
    render(
      <QueryClientProvider client={queryClient}>
        <NotesPanel entityType="deal" entityId="64b000000000000000000001" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({ entityType: 'deal', entityId: '64b000000000000000000001', sort: '-createdAt' })
  })
})
