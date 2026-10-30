// Pipeline stages come from the org (GET /org/pipeline-stages), in `order`, never from a hardcoded frontend list.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../../tests/factories.js'
import { renderWithProviders } from '../../../tests/render.jsx'
import { API, ok, page, server } from '../../../tests/server.js'
import DashboardPage from '../dashboard/DashboardPage.jsx'
import PipelinePage from './PipelinePage.jsx'

// A custom pipeline, stored out of order on purpose: display must follow `order`, not array position.
const CUSTOM_STAGES = [
  { key: 'discovery', label: 'Discovery call', order: 0 },
  { key: 'demo', label: 'Product demo', order: 2 },
  { key: 'trial', label: 'Free trial', order: 1 },
  { key: 'lost', label: 'Lost', order: 4 },
  { key: 'won', label: 'Signed', order: 3 },
]
const IN_ORDER = ['Discovery call', 'Free trial', 'Product demo', 'Signed', 'Lost']

const DEALS = [
  { _id: 'd1', title: 'Alpha', value: 100, stageKey: 'trial', ownerId: 'user-owner' },
  { _id: 'd2', title: 'Beta', value: 200, stageKey: 'won', ownerId: 'user-owner' },
]

function serve() {
  const moves = []
  const creates = []
  server.use(
    http.get(`${API}/org/pipeline-stages`, () => ok(CUSTOM_STAGES)),
    http.get(`${API}/deals`, () => page(DEALS)),
    http.get(`${API}/notes`, () => page([])),
    http.patch(`${API}/deals/:id/move-stage`, async ({ request }) => {
      moves.push(await request.json())
      return ok(DEALS[0])
    }),
    http.patch(`${API}/deals/:id`, () => ok(DEALS[0])),
    http.post(`${API}/deals`, async ({ request }) => {
      creates.push(await request.json())
      return ok({ _id: 'd3' })
    }),
  )
  return { moves, creates }
}

const optionLabels = (select) =>
  within(select)
    .getAllByRole('option')
    .map((o) => o.textContent)

describe('Pipeline with an org that has custom stages', () => {
  it("shows each deal's stage by the org's label", async () => {
    serve()
    renderWithProviders(<PipelinePage />, { session: makeUser('owner') })

    await waitFor(() => expect(screen.getByRole('row', { name: /Alpha/ })).toHaveTextContent('Free trial'))
    expect(screen.getByRole('row', { name: /Beta/ })).toHaveTextContent('Signed')
  })

  it("offers the org's stages, in order, and moves a deal to a custom stage by its key", async () => {
    const { moves } = serve()
    const user = userEvent.setup()
    renderWithProviders(<PipelinePage />, { session: makeUser('owner') })
    await user.click(await screen.findByRole('cell', { name: 'Alpha' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit deal' }))

    await waitFor(() => expect(optionLabels(dialog.getByLabelText('Stage'))).toEqual(IN_ORDER))
    expect(dialog.getByLabelText('Stage')).toHaveValue('trial')

    await user.selectOptions(dialog.getByLabelText('Stage'), 'Product demo')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(moves).toEqual([{ stageKey: 'demo' }]))
  })

  // The API refuses stageKey on PATCH /deals/:id (stage changes must go through
  // move-stage for status, closedAt, the log and the notification).
  it.each([
    ['with a stage change', 'Product demo'],
    ['without one', null],
  ])('never sends stageKey in PATCH /deals/:id when saving %s', async (_label, newStage) => {
    serve()
    const patches = []
    server.use(
      http.patch(`${API}/deals/:id`, async ({ request }) => {
        patches.push(await request.json())
        return ok(DEALS[0])
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<PipelinePage />, { session: makeUser('owner') })
    await user.click(await screen.findByRole('cell', { name: 'Alpha' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit deal' }))
    await waitFor(() => expect(optionLabels(dialog.getByLabelText('Stage'))).toEqual(IN_ORDER))

    if (newStage) await user.selectOptions(dialog.getByLabelText('Stage'), newStage)
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).not.toHaveProperty('stageKey')
  })

  it("starts a new deal in the org's first stage", async () => {
    const { creates } = serve()
    const user = userEvent.setup()
    renderWithProviders(<PipelinePage />, { session: makeUser('owner') })
    await screen.findByRole('cell', { name: 'Alpha' })

    await user.click(screen.getByRole('button', { name: 'New deal' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New deal' }))
    await waitFor(() => expect(dialog.getByLabelText('Stage')).toHaveValue('discovery'))
    await user.type(dialog.getByLabelText('Title'), 'Gamma')
    await user.click(dialog.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(creates).toHaveLength(1))
    expect(creates[0]).toMatchObject({ title: 'Gamma', stageKey: 'discovery' })
  })

  it("keeps the deal's own stage when the dialog opens before the stages have loaded", async () => {
    const { moves } = serve()
    let releaseStages
    const stagesArrive = new Promise((resolve) => (releaseStages = resolve))
    server.use(
      http.get(`${API}/org/pipeline-stages`, async () => {
        await stagesArrive
        return ok(CUSTOM_STAGES)
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<PipelinePage />, { session: makeUser('owner') })
    await user.click(await screen.findByRole('cell', { name: 'Alpha' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit deal' }))

    releaseStages()
    await waitFor(() => expect(optionLabels(dialog.getByLabelText('Stage'))).toEqual(IN_ORDER))
    expect(dialog.getByLabelText('Stage')).toHaveValue('trial')
    // Saving without touching the stage must not move the deal to the first option.
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(moves).toEqual([])
  })

  it('falls back to the raw key for a stage the org no longer has', async () => {
    serve()
    server.use(http.get(`${API}/deals`, () => page([{ ...DEALS[0], stageKey: 'legacy_stage' }])))
    renderWithProviders(<PipelinePage />, { session: makeUser('owner') })

    await waitFor(() => expect(screen.getByRole('row', { name: /Alpha/ })).toHaveTextContent('legacy_stage'))
  })
})

describe('Dashboard funnel with custom stages', () => {
  it("labels stages by the org's names and lists them in pipeline order", async () => {
    server.use(
      http.get(`${API}/org/pipeline-stages`, () => ok(CUSTOM_STAGES)),
      http.get(`${API}/dashboard/overview`, () =>
        ok({
          leadsByStatus: {},
          openPipelineValue: 0,
          recentActivity: [],
          // Aggregation order, not pipeline order.
          dealsByStage: [
            { stageKey: 'won', count: 1, value: 200 },
            { stageKey: 'discovery', count: 2, value: 50 },
            { stageKey: 'trial', count: 3, value: 100 },
          ],
        }),
      ),
    )
    renderWithProviders(<DashboardPage />, { session: makeUser('owner') })

    const funnel = within((await screen.findByRole('heading', { name: 'Deals by stage' })).parentElement)
    await waitFor(() => expect(funnel.getByText('Signed')).toBeInTheDocument())
    const labels = ['Discovery call', 'Free trial', 'Signed'].map((l) => funnel.getByText(l))
    // DOM order: each label precedes the next.
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i - 1].compareDocumentPosition(labels[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})
