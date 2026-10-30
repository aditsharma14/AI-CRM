// Pipeline: failed saves, stage moves and deletes show a specific error; after a partial failure the table resyncs with the server.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../../tests/factories.js'
import { renderWithProviders } from '../../../tests/render.jsx'
import { API, fail, ok, page, server } from '../../../tests/server.js'
import PipelinePage from './PipelinePage.jsx'

const DEAL = { _id: 'd1', title: 'Big deal', value: 100, stageKey: 'new', ownerId: 'user-owner' }
const STAGES = [
  { key: 'new', label: 'New', order: 0 },
  { key: 'qualified', label: 'Qualified', order: 1 },
  { key: 'won', label: 'Closed Won', order: 2 },
  { key: 'lost', label: 'Closed Lost', order: 3 },
]

const FAILURES = [
  [
    400,
    'VALIDATION_ERROR',
    `stageKey: "qualified" is not a stage in this organization's pipeline.`,
    `stageKey: "qualified" is not a stage in this organization's pipeline.`,
  ],
  [403, 'FORBIDDEN', 'You can only change records you own.', 'You can only change records you own.'],
  [
    500,
    'INTERNAL_ERROR',
    'Internal server error',
    "Something went wrong on our side. Your changes weren't saved. Try again.",
  ],
]

/** Serves the deal list; `rows` may be swapped later to simulate the server's state changing. */
function serveDeals(rows = [DEAL]) {
  const state = { rows }
  server.use(
    http.get(`${API}/deals`, () => page(state.rows)),
    http.get(`${API}/notes`, () => page([])),
    http.get(`${API}/org/pipeline-stages`, () => ok(STAGES)),
  )
  return state
}

async function setup() {
  const user = userEvent.setup()
  renderWithProviders(<PipelinePage />, { session: makeUser('owner') })
  await screen.findByRole('cell', { name: 'Big deal' })
  return user
}

async function openDeal(user) {
  await user.click(screen.getByRole('cell', { name: 'Big deal' }))
  return within(await screen.findByRole('dialog', { name: 'Edit deal' }))
}

const rowOf = (title) => screen.getByRole('row', { name: new RegExp(title) })

describe.each(FAILURES)('Pipeline when the API answers %i', (status, code, serverMessage, shown) => {
  it('save: shows the error, keeps the dialog and the typed title; the table keeps the saved title', async () => {
    serveDeals()
    server.use(http.patch(`${API}/deals/:id`, () => fail(status, code, serverMessage)))
    const user = await setup()
    const dialog = await openDeal(user)

    await user.clear(dialog.getByLabelText('Title'))
    await user.type(dialog.getByLabelText('Title'), 'Bigger deal')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(shown)
    expect(dialog.getByLabelText('Title')).toHaveValue('Bigger deal')
    expect(screen.getByRole('cell', { name: 'Big deal' })).toBeInTheDocument()
  })

  it('stage move: shows the error and the table keeps the old stage', async () => {
    serveDeals()
    server.use(http.patch(`${API}/deals/:id/move-stage`, () => fail(status, code, serverMessage)))
    const user = await setup()
    const dialog = await openDeal(user)

    await user.selectOptions(dialog.getByLabelText('Stage'), 'qualified')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(shown)
    expect(rowOf('Big deal')).toHaveTextContent('New')
  })

  it('delete: shows the error on the page and the row stays', async () => {
    serveDeals()
    server.use(http.delete(`${API}/deals/:id`, () => fail(status, code, serverMessage)))
    const user = await setup()
    const dialog = await openDeal(user)

    await user.click(dialog.getByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete this deal?' })).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(shown)
    expect(screen.getByRole('cell', { name: 'Big deal' })).toBeInTheDocument()
  })
})

describe('Pipeline partial failure', () => {
  it('stage moved but the details save failed: the error shows and the table refetches the moved stage', async () => {
    const state = serveDeals()
    server.use(
      http.patch(`${API}/deals/:id/move-stage`, () => {
        state.rows = [{ ...DEAL, stageKey: 'qualified' }] // the server really moved it
        return ok(state.rows[0])
      }),
      http.patch(`${API}/deals/:id`, () => fail(500, 'INTERNAL_ERROR', 'Internal server error')),
    )
    const user = await setup()
    const dialog = await openDeal(user)

    await user.selectOptions(dialog.getByLabelText('Stage'), 'qualified')
    await user.clear(dialog.getByLabelText('Title'))
    await user.type(dialog.getByLabelText('Title'), 'Renamed too')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent("Your changes weren't saved")
    await waitFor(() => expect(rowOf('Big deal')).toHaveTextContent('Qualified'))
  })

  it('retrying after a partial failure resends only the details, not the stage move', async () => {
    const state = serveDeals()
    let moves = 0
    let patchOk = false
    server.use(
      http.patch(`${API}/deals/:id/move-stage`, () => {
        moves += 1
        state.rows = [{ ...DEAL, stageKey: 'qualified' }]
        return ok(state.rows[0])
      }),
      http.patch(`${API}/deals/:id`, () =>
        patchOk ? ok(state.rows[0]) : fail(500, 'INTERNAL_ERROR', 'Internal server error'),
      ),
    )
    const user = await setup()
    const dialog = await openDeal(user)
    await user.selectOptions(dialog.getByLabelText('Stage'), 'qualified')
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await dialog.findByRole('alert')

    patchOk = true
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // A second move would log and notify the stage change twice.
    expect(moves).toBe(1)
  })
})
