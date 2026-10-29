// The refresh-on-401 interceptor: concurrent 401s share one refresh, and nothing loops or refreshes for guests.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { http } from 'msw'
import { api, getAccessToken, setAccessToken, setOnUnauthorized } from './client.js'
import { API, fail, ok, server } from '../../tests/server.js'

/** Serves `path` with 200 only for `Bearer fresh`; records every Authorization header it saw. */
function protectedEndpoint(path) {
  const seen = []
  server.use(
    http.get(`${API}${path}`, ({ request }) => {
      const auth = request.headers.get('authorization')
      seen.push(auth)
      return auth === 'Bearer fresh' ? ok({ path }) : fail(401, 'UNAUTHORIZED', 'Token expired.')
    }),
  )
  return seen
}

/** POST /auth/refresh; counts calls. `outcome` 'ok' rotates the token to `fresh`. */
function refreshEndpoint(outcome = 'ok') {
  const calls = { count: 0 }
  server.use(
    http.post(`${API}/auth/refresh`, async () => {
      calls.count += 1
      // Hold the response open a tick so concurrent 401s really overlap it.
      await new Promise((r) => setTimeout(r, 20))
      return outcome === 'ok' ? ok({ accessToken: 'fresh' }) : fail(401, 'UNAUTHORIZED', 'Refresh token invalid.')
    }),
  )
  return calls
}

describe('api client: refresh on 401', () => {
  it('sends exactly one refresh for three concurrent 401s, then retries all three with the new token', async () => {
    setAccessToken('stale')
    const leads = protectedEndpoint('/leads')
    protectedEndpoint('/deals')
    protectedEndpoint('/contacts')
    const refresh = refreshEndpoint('ok')

    const results = await Promise.all([api.get('/leads'), api.get('/deals'), api.get('/contacts')])

    expect(refresh.count).toBe(1)
    expect(results.map((r) => r.data.data.path)).toEqual(['/leads', '/deals', '/contacts'])
    expect(leads).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(getAccessToken()).toBe('fresh')
  })

  it('refreshes again for a later 401 once the first refresh has settled', async () => {
    setAccessToken('stale')
    protectedEndpoint('/leads')
    const refresh = refreshEndpoint('ok')

    await api.get('/leads')
    setAccessToken('stale-again')
    await api.get('/leads')

    expect(refresh.count).toBe(2)
  })

  it('does not refresh twice for one request: a 401 on the retry is final', async () => {
    setAccessToken('stale')
    // Rejects even the fresh token, so the retried request 401s again.
    server.use(http.get(`${API}/leads`, () => fail(401, 'UNAUTHORIZED', 'Nope.')))
    const refresh = refreshEndpoint('ok')

    await expect(api.get('/leads')).rejects.toMatchObject({ response: { status: 401 } })
    expect(refresh.count).toBe(1)
  })

  it('when the refresh fails: every waiter rejects, the token is cleared, the session is torn down', async () => {
    setAccessToken('stale')
    protectedEndpoint('/leads')
    protectedEndpoint('/deals')
    const refresh = refreshEndpoint('fail')
    const onUnauthorized = vi.fn()
    setOnUnauthorized(onUnauthorized)

    const settled = await Promise.allSettled([api.get('/leads'), api.get('/deals')])

    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected'])
    expect(refresh.count).toBe(1)
    expect(getAccessToken()).toBeNull()
    // Both waiters share the one failed refresh, but each runs the catch block.
    // What matters is that the session is torn down, not exactly how often.
    expect(onUnauthorized).toHaveBeenCalled()
  })

  it('never refreshes for a 401 from an /auth/ route (e.g. wrong password)', async () => {
    setAccessToken('stale')
    server.use(http.post(`${API}/auth/login`, () => fail(401, 'INVALID_CREDENTIALS', 'Wrong email or password.')))
    const refresh = refreshEndpoint('ok')

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ response: { status: 401 } })
    expect(refresh.count).toBe(0)
  })

  it('passes non-401 errors straight through', async () => {
    setAccessToken('valid')
    server.use(http.get(`${API}/leads/x`, () => fail(403, 'FORBIDDEN', 'No.')))
    const refresh = refreshEndpoint('ok')

    await expect(api.get('/leads/x')).rejects.toMatchObject({ response: { status: 403 } })
    expect(refresh.count).toBe(0)
  })
})

describe('api client: guests (no access token)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a GET 401 without refreshing or redirecting', async () => {
    protectedEndpoint('/leads')
    const refresh = refreshEndpoint('ok')
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })

    await expect(api.get('/leads')).rejects.toMatchObject({ response: { status: 401 } })
    expect(refresh.count).toBe(0)
    expect(assign).not.toHaveBeenCalled()
  })

  it('sends a guest who tries to change something to /login', async () => {
    server.use(http.post(`${API}/leads`, () => fail(401, 'UNAUTHORIZED', 'Log in.')))
    const refresh = refreshEndpoint('ok')
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })

    await expect(api.post('/leads', { name: 'x' })).rejects.toMatchObject({ response: { status: 401 } })
    expect(refresh.count).toBe(0)
    expect(assign).toHaveBeenCalledWith('/login')
  })
})

describe('api client: request interceptor', () => {
  it('attaches the bearer token only when one is set', async () => {
    const seen = protectedEndpoint('/leads')
    server.use(http.get(`${API}/public`, ({ request }) => ok(request.headers.get('authorization'))))

    expect((await api.get('/public')).data.data).toBeNull()
    setAccessToken('fresh')
    await api.get('/leads')
    expect(seen).toEqual(['Bearer fresh'])
  })
})
