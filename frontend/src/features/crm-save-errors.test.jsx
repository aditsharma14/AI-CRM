// Contacts, Companies, Tasks, Calendar and Notes (#13): a refused or failed save, delete or toggle is shown through ErrorAlert
// with a specific message for 4xx and a generic one for 500; the user's input stays; nothing unsaved shows as saved.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { API, fail, page, server } from '../../tests/server.js'
import CalendarPage from './calendar/CalendarPage.jsx'
import CompaniesPage from './companies/CompaniesPage.jsx'
import ContactsPage from './contacts/ContactsPage.jsx'
import NotesPanel from './notes/NotesPanel.jsx'
import TasksPage from './tasks/TasksPage.jsx'

const FAILURES = [
  [400, 'VALIDATION_ERROR', 'email: Invalid email address', 'email: Invalid email address'],
  [403, 'FORBIDDEN', 'You can only change records you own.', 'You can only change records you own.'],
  [
    500,
    'INTERNAL_ERROR',
    'Internal server error',
    "Something went wrong on our side. Your changes weren't saved. Try again.",
  ],
]

// Today at 10:00, so the event lands in the calendar's current month.
const today10 = new Date(new Date().setHours(10, 0, 0, 0)).toISOString()

const PAGES = [
  {
    name: 'Contacts',
    Page: ContactsPage,
    path: '/contacts',
    record: { _id: 'c1', name: 'Pat Buyer', ownerId: 'user-owner' },
    label: 'Name',
    noun: 'contact',
    extra: [http.get(`${API}/companies`, () => page([])), http.get(`${API}/notes`, () => page([]))],
  },
  {
    name: 'Companies',
    Page: CompaniesPage,
    path: '/companies',
    record: { _id: 'co1', name: 'Globex', ownerId: 'user-owner' },
    label: 'Name',
    noun: 'company',
    extra: [http.get(`${API}/notes`, () => page([]))],
  },
  {
    name: 'Tasks',
    Page: TasksPage,
    path: '/activities',
    record: { _id: 't1', type: 'task', title: 'Call back', status: 'open', priority: 'low', assigneeId: 'user-owner' },
    label: 'Title',
    noun: 'task',
    extra: [],
  },
  {
    name: 'Calendar',
    Page: CalendarPage,
    path: '/activities',
    record: { _id: 'e1', type: 'event', title: 'Standup', startAt: today10, assigneeId: 'user-owner' },
    label: 'Title',
    noun: 'event',
    extra: [],
  },
]

const shownName = (record) => record.name ?? record.title

async function setup({ Page, path, record, extra }) {
  server.use(
    http.get(`${API}${path}`, () => page([record])),
    ...extra,
  )
  const user = userEvent.setup()
  renderWithProviders(<Page />, { session: makeUser('owner') })
  await screen.findByText(shownName(record))
  return user
}

async function openRecord(user, spec) {
  await user.click(screen.getByText(shownName(spec.record)))
  return within(await screen.findByRole('dialog', { name: `Edit ${spec.noun}` }))
}

async function openNew(user, spec) {
  if (spec.noun === 'event') await user.click(screen.getAllByRole('button', { name: /^\d+/ })[10])
  else await user.click(screen.getByRole('button', { name: `New ${spec.noun}` }))
  return within(await screen.findByRole('dialog', { name: `New ${spec.noun}` }))
}

describe.each(PAGES)('$name', (spec) => {
  const resource = `${API}${spec.path}`

  describe.each(FAILURES)('when the API answers %i', (status, code, serverMessage, shown) => {
    it('save: shows the error, keeps the dialog and the typed value; the list keeps the saved value', async () => {
      server.use(http.patch(`${resource}/:id`, () => fail(status, code, serverMessage)))
      const user = await setup(spec)
      const dialog = await openRecord(user, spec)

      await user.clear(dialog.getByLabelText(spec.label))
      await user.type(dialog.getByLabelText(spec.label), 'Renamed')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(await dialog.findByRole('alert')).toHaveTextContent(shown)
      expect(dialog.getByLabelText(spec.label)).toHaveValue('Renamed')
      expect(screen.queryByText('Renamed', { selector: 'td, span' })).toBeNull()
    })

    it('create: shows the error and keeps the dialog open with the input', async () => {
      server.use(http.post(resource, () => fail(status, code, serverMessage)))
      const user = await setup(spec)
      const dialog = await openNew(user, spec)

      await user.type(dialog.getByLabelText(spec.label), 'Brand new')
      await user.click(dialog.getByRole('button', { name: 'Create' }))

      expect(await dialog.findByRole('alert')).toHaveTextContent(shown)
      expect(dialog.getByLabelText(spec.label)).toHaveValue('Brand new')
    })

    it('delete: shows the error on the page and the record stays', async () => {
      server.use(http.delete(`${resource}/:id`, () => fail(status, code, serverMessage)))
      const user = await setup(spec)
      const dialog = await openRecord(user, spec)

      await user.click(dialog.getByRole('button', { name: 'Delete' }))
      const confirm = within(screen.getByRole('dialog', { name: `Delete this ${spec.noun}?` }))
      await user.click(confirm.getByRole('button', { name: 'Delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(shown)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(screen.getByText(shownName(spec.record))).toBeInTheDocument()
    })
  })

  it('a later successful save clears the error', async () => {
    let attempts = 0
    server.use(
      http.patch(`${resource}/:id`, () => {
        attempts += 1
        return attempts === 1 ? fail(500, 'INTERNAL_ERROR', 'boom') : page([spec.record])
      }),
    )
    const user = await setup(spec)
    const dialog = await openRecord(user, spec)
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await dialog.findByRole('alert')

    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Tasks: done/open toggle', () => {
  it.each(FAILURES)('%i: shows the error and the task stays open', async (status, code, serverMessage, shown) => {
    server.use(http.patch(`${API}/activities/:id/toggle-status`, () => fail(status, code, serverMessage)))
    const user = await setup(PAGES[2])

    await user.click(screen.getByRole('button', { name: 'Mark as done' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByRole('button', { name: 'Mark as done' })).toBeInTheDocument()
  })
})

describe('Calendar: a failed load', () => {
  it('shows the error with Retry, not an empty month', async () => {
    server.use(http.get(`${API}/activities`, () => fail(500, 'INTERNAL_ERROR', 'boom')))
    renderWithProviders(<CalendarPage />, { session: makeUser('owner') })

    const alert = await screen.findByRole('alert', {}, { timeout: 4000 })
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('Notes: adding a note', () => {
  it.each(FAILURES)('%i: shows the error and keeps the draft', async (status, code, serverMessage, shown) => {
    server.use(
      http.get(`${API}/notes`, () => page([])),
      http.post(`${API}/notes`, () => fail(status, code, serverMessage)),
    )
    const user = userEvent.setup()
    renderWithProviders(<NotesPanel entityType="lead" entityId="l1" />, { session: makeUser('owner') })
    await screen.findByText('No notes yet.')

    await user.type(screen.getByRole('textbox', { name: 'New note' }), 'Called, no answer')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByRole('textbox', { name: 'New note' })).toHaveValue('Called, no answer')
    expect(screen.getByText('No notes yet.')).toBeInTheDocument()
  })
})
