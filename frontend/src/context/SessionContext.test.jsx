// SessionProvider: one silent restore even under StrictMode, login/logout lifecycle, can(), and teardown on a failed refresh.
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { useSession } from './SessionContext.jsx'
import { api, getAccessToken } from '../api/client.js'
import { queryClient } from '../lib/queryClient.js'
import { API, fail, ok, server } from '../../tests/server.js'
import { makeUser } from '../../tests/factories.js'
import { renderWithProviders } from '../../tests/render.jsx'

/** Renders the session's visible state and hands the live context back to the test. */
function mountSession(options) {
  const ref = { current: null }
  function Probe() {
    const session = useSession()
    ref.current = session
    if (session.isBootstrapping) return <p>booting</p>
    return <p>{session.user ? `signed in as ${session.user.name}` : 'guest'}</p>
  }
  const result = renderWithProviders(<Probe />, options)
  return { ...result, session: () => ref.current }
}

describe('SessionProvider bootstrap', () => {
  it('restores the session with exactly one refresh under StrictMode', async () => {
    const owner = makeUser('owner')
    const { refreshCalls, session } = mountSession({ session: owner, strict: true })

    expect(await screen.findByText('signed in as The owner')).toBeInTheDocument()
    // StrictMode double-invokes the effect; refresh tokens rotate on use, so a
    // second call would race the first (see the comment in SessionContext).
    expect(refreshCalls.count).toBe(1)
    expect(session().isBootstrapping).toBe(false)
    expect(session().role).toBe('owner')
    expect(session().org).toEqual(owner.org)
    expect(getAccessToken()).toBe('token-for-user-owner')
  })

  it('ends as a guest, not an endless spinner, when there is no valid refresh cookie', async () => {
    const { refreshCalls, session } = mountSession({ session: null, strict: true })

    expect(await screen.findByText('guest')).toBeInTheDocument()
    expect(refreshCalls.count).toBe(1)
    expect(session().isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
  })
})

describe('SessionProvider actions', () => {
  it.each([
    ['login', '/auth/login'],
    ['registerOrg', '/auth/register-org'],
    ['acceptInvite', '/auth/accept-invite'],
  ])('%s applies the returned session', async (action, path) => {
    const member = makeUser('member')
    const { session } = mountSession({ session: null })
    await screen.findByText('guest')
    server.use(http.post(`${API}${path}`, () => ok({ accessToken: 'new-token', user: member })))

    await act(() => session()[action]({}))

    expect(screen.getByText('signed in as The member')).toBeInTheDocument()
    expect(getAccessToken()).toBe('new-token')
  })

  it('login surfaces a server rejection to the caller and stays a guest', async () => {
    const { session } = mountSession({ session: null })
    await screen.findByText('guest')
    server.use(http.post(`${API}/auth/login`, () => fail(401, 'INVALID_CREDENTIALS', 'Wrong email or password.')))

    await expect(act(() => session().login({}))).rejects.toMatchObject({ response: { status: 401 } })
    expect(screen.getByText('guest')).toBeInTheDocument()
  })

  it('logout clears the user, the token and cached data, even if the server call fails', async () => {
    const { session } = mountSession({ session: makeUser('admin') })
    await screen.findByText('signed in as The admin')
    queryClient.setQueryData(['leads', 'list', {}], { data: ['cached'] })
    server.use(http.post(`${API}/auth/logout`, () => fail(500, 'INTERNAL_ERROR', 'Down.')))

    await act(() => session().logout())

    expect(screen.getByText('guest')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
    expect(queryClient.getQueryData(['leads', 'list', {}])).toBeUndefined()
  })

  it('updateLocalUser merges into the current user', async () => {
    const { session } = mountSession({ session: makeUser('manager') })
    await screen.findByText('signed in as The manager')

    act(() => session().updateLocalUser({ name: 'Renamed' }))

    expect(screen.getByText('signed in as Renamed')).toBeInTheDocument()
    expect(session().user.role).toBe('manager')
  })

  it('tears the session down when the api client reports an unrecoverable 401', async () => {
    const { session } = mountSession({ session: makeUser('owner') })
    await screen.findByText('signed in as The owner')
    // The access token expires and the refresh cookie is gone too.
    server.use(
      http.get(`${API}/leads`, () => fail(401, 'UNAUTHORIZED', 'Expired.')),
      http.post(`${API}/auth/refresh`, () => fail(401, 'UNAUTHORIZED', 'Refresh token invalid.')),
    )

    await act(() => api.get('/leads').catch(() => {}))

    await waitFor(() => expect(screen.getByText('guest')).toBeInTheDocument())
    expect(session().isAuthenticated).toBe(false)
  })
})

describe('can()', () => {
  it.each([
    ['owner', { org: true, members: true, pipeline: true, crmDelete: true }],
    ['admin', { org: false, members: true, pipeline: true, crmDelete: true }],
    ['manager', { org: false, members: false, pipeline: false, crmDelete: true }],
    ['member', { org: false, members: false, pipeline: false, crmDelete: false }],
  ])('answers from the permission mirror for %s', async (role, expected) => {
    const { session } = mountSession({ session: makeUser(role) })
    await screen.findByText(`signed in as The ${role}`)
    const { can } = session()

    expect({
      org: can('org', 'manage'),
      members: can('members', 'manage'),
      pipeline: can('pipeline', 'configure'),
      crmDelete: can('crm', 'delete'),
    }).toEqual(expected)
    expect(can('crm', 'write')).toBe(true)
  })

  it('is false for everything when signed out', async () => {
    const { session } = mountSession({ session: null })
    await screen.findByText('guest')
    expect(session().can('crm', 'read')).toBe(false)
  })
})

describe('useSession', () => {
  it('throws outside a SessionProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Orphan() {
      useSession()
      return null
    }
    expect(() => render(<Orphan />)).toThrow('useSession must be used within a SessionProvider')
    vi.restoreAllMocks()
  })
})
