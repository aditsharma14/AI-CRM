// GlobalSearch's Escape key always calls the current onClose and clears the query (#12: it used to keep the one from when it opened).
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'
import { API, ok, server } from '../../tests/server.js'
import GlobalSearch from './GlobalSearch.jsx'

const PLACEHOLDER = 'Search leads, contacts, companies, deals…'

function serveSearch() {
  server.use(http.get(`${API}/search`, () => ok({ leads: [], contacts: [], companies: [], deals: [] })))
}

/** Stays open; each render hands GlobalSearch a new onClose that records which version it is. */
function NewCallbackEachRender({ calls }) {
  const [version, setVersion] = useState(1)
  return (
    <>
      <button type="button" onClick={() => setVersion((v) => v + 1)}>
        Bump
      </button>
      <GlobalSearch isOpen onClose={() => calls.push(version)} />
    </>
  )
}

/** Opens and closes like AppLayout does. */
function Palette() {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open search
      </button>
      <GlobalSearch isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

describe('GlobalSearch Escape', () => {
  it('calls the onClose from the latest render, not the one it opened with', async () => {
    serveSearch()
    const calls = []
    const user = userEvent.setup()
    renderWithProviders(<NewCallbackEachRender calls={calls} />, { session: makeUser('member') })
    await screen.findByPlaceholderText(PLACEHOLDER)

    await user.click(screen.getByRole('button', { name: 'Bump' }))
    await user.click(screen.getByRole('button', { name: 'Bump' }))
    await user.keyboard('{Escape}')

    expect(calls).toEqual([3])
  })

  it('closes after the query has changed, and opens blank next time', async () => {
    serveSearch()
    const user = userEvent.setup()
    renderWithProviders(<Palette />, { session: makeUser('member') })

    await user.click(await screen.findByRole('button', { name: 'Open search' }))
    await user.type(await screen.findByPlaceholderText(PLACEHOLDER), 'acme')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Open search' }))
    expect(await screen.findByPlaceholderText(PLACEHOLDER)).toHaveValue('')
  })
})
