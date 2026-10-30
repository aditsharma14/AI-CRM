// Leads and Pipeline hide what the role or ownership policy would refuse: Delete needs crm:delete; members edit only their own records.
import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import LeadsPage from './leads/LeadsPage.jsx'
import PipelinePage from './deals/PipelinePage.jsx'
import { API, ok, page, server } from '../../tests/server.js'
import { makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'

const MINE = 'user-member' // makeUser('member').id
const THEIRS = 'user-manager'

const PAGES = {
  lead: {
    Page: LeadsPage,
    path: '/leads',
    rows: [
      { _id: 'l1', name: 'My lead', status: 'new', score: 0, ownerId: MINE, createdAt: '2026-10-01' },
      { _id: 'l2', name: 'Their lead', status: 'new', score: 0, ownerId: THEIRS, createdAt: '2026-10-01' },
    ],
    mine: 'My lead',
    theirs: 'Their lead',
  },
  deal: {
    Page: PipelinePage,
    path: '/deals',
    rows: [
      { _id: 'd1', title: 'My deal', value: 100, stageKey: 'new', ownerId: MINE },
      { _id: 'd2', title: 'Their deal', value: 100, stageKey: 'new', ownerId: THEIRS },
    ],
    mine: 'My deal',
    theirs: 'Their deal',
  },
}

/** Renders the page as `role` and opens the record named `name`; returns the edit dialog. */
async function openRecord(kind, role, name) {
  const { Page, path, rows } = PAGES[kind]
  server.use(
    http.get(`${API}${path}`, () => page(rows)),
    // The edit dialog embeds NotesPanel.
    http.get(`${API}/notes`, () => page([])),
    // Pipeline reads the org's stages.
    http.get(`${API}/org/pipeline-stages`, () => ok([{ key: 'new', label: 'New', order: 0 }])),
  )
  const user = userEvent.setup()
  renderWithProviders(<Page />, { session: makeUser(role) })
  await user.click(await screen.findByText(name))
  return within(await screen.findByRole('dialog'))
}

describe.each(['lead', 'deal'])('%s edit dialog', (kind) => {
  const { mine, theirs } = PAGES[kind]

  it.each([
    ['owner', true],
    ['admin', true],
    ['manager', true],
    ['member', false],
  ])('%s sees Delete: %s', async (role, shown) => {
    const dialog = await openRecord(kind, role, theirs)
    expect(Boolean(dialog.queryByRole('button', { name: 'Delete' }))).toBe(shown)
  })

  it("is read-only for a member on someone else's record", async () => {
    const dialog = await openRecord(kind, 'member', theirs)
    expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(dialog.queryByRole('button', { name: 'Convert to deal' })).toBeNull()
  })

  it('is editable for a member on their own record', async () => {
    const dialog = await openRecord(kind, 'member', mine)
    expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
    if (kind === 'lead') expect(dialog.getByRole('button', { name: 'Convert to deal' })).toBeInTheDocument()
  })

  it("is editable for a manager on anyone's record", async () => {
    const dialog = await openRecord(kind, 'manager', theirs)
    expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
