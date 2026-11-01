// The app's route table: /pipeline is an alias that lands on the Pipeline page at /deals.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { makeUser } from '../tests/factories.js'
import { serveSession } from '../tests/render.jsx'
import { API, ok, page, server } from '../tests/server.js'
import { AppRoutes } from './App.jsx'
import { SessionProvider } from './context/SessionContext.jsx'
import { queryClient } from './lib/queryClient.js'

function Where() {
  return <output aria-label="path">{useLocation().pathname}</output>
}

function renderAt(path) {
  serveSession(makeUser('manager'))
  server.use(
    http.get(`${API}/org/pipeline-stages`, () => ok([{ key: 'new', label: 'New', order: 0 }])),
    http.get(`${API}/deals`, () => page([])),
    http.get(`${API}/notifications`, () => page([])),
  )
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider>
          <AppRoutes />
          <Where />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('routes', () => {
  it.each(['/pipeline', '/deals'])('%s shows the Pipeline page at /deals', async (path) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { name: 'Pipeline' })).toBeInTheDocument()
    expect(screen.getByLabelText('path')).toHaveTextContent(/^\/deals$/)
  })
})
