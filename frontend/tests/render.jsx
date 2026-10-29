// @ts-check
// Renders UI inside the app's real providers; the session is restored through MSW, never a mocked context.
import { StrictMode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { SessionProvider } from '../src/context/SessionContext.jsx'
import { queryClient } from '../src/lib/queryClient.js'
import { API, fail, ok, server } from './server.js'

/** @typedef {import('./factories.js').SessionUser} SessionUser */

/**
 * @typedef {object} RenderOptions
 * @property {SessionUser | null} [session] Who the bootstrap refresh restores; null renders a guest.
 * @property {string} [route] Initial URL for the MemoryRouter.
 * @property {boolean} [strict] Wrap in <StrictMode>, as main.jsx does.
 */

/**
 * Answers the SessionProvider's silent-bootstrap POST /auth/refresh.
 * @param {SessionUser | null} session
 * @returns {{ count: number }} Live count of refresh calls served.
 */
export function serveSession(session) {
  const calls = { count: 0 }
  server.use(
    http.post(`${API}/auth/refresh`, () => {
      calls.count += 1
      return session ? ok({ accessToken: `token-for-${session.id}`, user: session }) : fail(401, 'UNAUTHORIZED', 'No session.')
    }),
  )
  return calls
}

/**
 * @param {import('react').ReactElement} ui
 * @param {RenderOptions} [options]
 * @returns {import('@testing-library/react').RenderResult & { refreshCalls: { count: number } }}
 */
export function renderWithProviders(ui, { session = null, route = '/', strict = false } = {}) {
  const refreshCalls = serveSession(session)
  const tree = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <SessionProvider>{ui}</SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...render(strict ? <StrictMode>{tree}</StrictMode> : tree), refreshCalls }
}
