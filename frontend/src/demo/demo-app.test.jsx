// The real app's pages on the demo's data: sign in with the demo buttons, the Dashboard in INR, a deal closed from the
// Pipeline, the member/manager differences, and an unsupported action's message. Same client, hooks and pages as
// production; only the API is the demo's.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { server } from '../../tests/server.js'
import { AppRoutes } from '../App.jsx'
import { SessionProvider } from '../context/SessionContext.jsx'
import { registerDemoUi } from '../lib/demo.js'
import { queryClient } from '../lib/queryClient.js'
import { DemoBanner, DemoSignIn } from './DemoUi.jsx'
import { createDemoApi, NOT_AVAILABLE } from './handlers.js'

const money = (value) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
// Every open deal in seed.js.
const OPEN_PIPELINE = 45000 + 84000 + 360000 + 125000 + 640000 + 1150000 + 410000 + 98000 + 1800000 + 720000
const SLOW = { timeout: 4000 }

beforeEach(() => {
  server.use(...createDemoApi().handlers)
  registerDemoUi({ Banner: DemoBanner, SignIn: DemoSignIn })
  return () => registerDemoUi({ Banner: null, SignIn: null })
})

function renderDemo(route = '/login') {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <SessionProvider>
          <DemoBanner />
          <AppRoutes />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

async function signInAs(user, label) {
  await user.click(await screen.findByRole('button', { name: label }))
  return screen.findByRole('group', { name: 'Open pipeline value' }, SLOW)
}

const openDeal = async (user, title) => {
  await user.click(await screen.findByText(title, {}, SLOW))
  return screen.findByRole('dialog')
}

describe('the demo, through the real app', () => {
  it('banner, sign-in buttons, and the Dashboard in the org currency', async () => {
    const user = renderDemo()
    expect(screen.getByRole('note', { name: 'Demo mode' })).toHaveTextContent(
      'Demo mode: data stays in your browser and resets on reload. The real backend runs in Docker; see README.',
    )
    const card = await signInAs(user, 'Try as Sales Manager')
    expect(card).toHaveTextContent(money(OPEN_PIPELINE))
  })

  it('the manager moves a deal to Closed Won from the Pipeline', async () => {
    const user = renderDemo()
    await signInAs(user, 'Try as Sales Manager')
    await user.click(screen.getByRole('link', { name: 'Pipeline' }))

    const dialog = await openDeal(user, 'Tapti Logistics: label printers')
    await user.selectOptions(within(dialog).getByLabelText('Stage'), 'won')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const row = (await screen.findByText('Tapti Logistics: label printers')).closest('tr')
    expect(await within(row).findByText('Closed Won', {}, SLOW)).toBeInTheDocument()
  })

  it('member: a colleague’s deal is read-only and nothing has Delete; the manager has Delete', async () => {
    let user = renderDemo()
    await signInAs(user, 'Try as Member')
    await user.click(screen.getByRole('link', { name: 'Pipeline' }))
    let dialog = await openDeal(user, 'Vindhya Infra: site office furniture')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    dialog = await openDeal(user, 'Godavari Textiles: ergonomic chairs')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('manager: Delete is offered', async () => {
    const user = renderDemo()
    await signInAs(user, 'Try as Sales Manager')
    await user.click(screen.getByRole('link', { name: 'Pipeline' }))
    const dialog = await openDeal(user, 'Godavari Textiles: ergonomic chairs')
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('an unsupported action says it is not available in the demo', async () => {
    const user = renderDemo('/register')
    await user.type(await screen.findByLabelText('Organization name'), 'My Shop') // the auth pages are a lazy chunk
    await user.type(screen.getByLabelText('Your name'), 'Me')
    await user.type(screen.getByLabelText('Email'), 'me@shop.example')
    await user.type(screen.getByLabelText('Password'), 'long enough password')
    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_AVAILABLE)
  })
})
