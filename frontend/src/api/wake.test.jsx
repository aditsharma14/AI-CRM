// Cold starts (Render's free tier sleeps; waking takes about a minute): an HTML loading page, 503, or a 502/504 on a
// safe request is retried with backoff instead of failing, and "Waking up the server…" shows while anything waits.
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { API, fail, ok, server } from '../../tests/server.js'
import { WakingBanner } from '../components/WakingBanner.jsx'
import { apiErrorMessage } from '../lib/utils.js'
import { api, isWaking, setSlowRequestMs, setWakeRetryDelays } from './client.js'

const loadingPage = () =>
  new HttpResponse('<!doctype html><title>Service waking up</title>', { headers: { 'Content-Type': 'text/html' } })

/** Answers with `first()` for the first `times` calls, then a JSON success. Counts calls. */
function wakesAfter(method, path, times, first) {
  const calls = { count: 0 }
  server.use(
    http[method](`${API}${path}`, () => {
      calls.count += 1
      return calls.count <= times ? first() : ok({ awake: true })
    }),
  )
  return calls
}

beforeEach(() => {
  setWakeRetryDelays([20, 20, 20])
})

describe('retries while the server wakes', () => {
  it("Render's HTML loading page: retried until the API answers JSON", async () => {
    const calls = wakesAfter('get', '/leads', 2, loadingPage)
    const res = await api.get('/leads')
    expect(res.data.data).toEqual({ awake: true })
    expect(calls.count).toBe(3)
  })

  it.each([502, 503, 504])('a GET that gets %i is retried', async (status) => {
    const calls = wakesAfter('get', '/leads', 2, () => fail(status, 'BAD_GATEWAY', 'upstream'))
    expect((await api.get('/leads')).data.data).toEqual({ awake: true })
    expect(calls.count).toBe(3)
  })

  it('the session bootstrap (POST /auth/refresh) is retried on 502, since it is the first call a cold page makes', async () => {
    const calls = wakesAfter('post', '/auth/refresh', 1, () => fail(502, 'BAD_GATEWAY', 'upstream'))
    expect((await api.post('/auth/refresh')).data.data).toEqual({ awake: true })
    expect(calls.count).toBe(2)
  })

  it.each([
    ['the HTML loading page', loadingPage],
    ['503', () => fail(503, 'UNAVAILABLE', 'starting')],
  ])('a write that gets %s is retried (the app never saw it)', async (_, first) => {
    const calls = wakesAfter('post', '/leads', 1, first)
    expect((await api.post('/leads', { name: 'x' })).data.data).toEqual({ awake: true })
    expect(calls.count).toBe(2)
  })

  it.each([502, 504])('a write that gets %i is not retried (it may have been applied)', async (status) => {
    const calls = wakesAfter('post', '/leads', 1, () => fail(status, 'BAD_GATEWAY', 'upstream'))
    await expect(api.post('/leads', { name: 'x' })).rejects.toMatchObject({ response: { status } })
    expect(calls.count).toBe(1)
  })

  it('a 500 is a real error, not a cold start: no retry', async () => {
    const calls = wakesAfter('get', '/leads', 1, () => fail(500, 'INTERNAL_ERROR', 'boom'))
    await expect(api.get('/leads')).rejects.toMatchObject({ response: { status: 500 } })
    expect(calls.count).toBe(1)
  })

  it('gives up after the last delay, with a message that says what happened', async () => {
    const calls = wakesAfter('get', '/leads', 99, loadingPage)
    const error = await api.get('/leads').catch((e) => e)
    expect(calls.count).toBe(4)
    expect(error.wakeTimedOut).toBe(true)
    expect(apiErrorMessage(error)).toBe('The server is still starting up. Try again in a minute.')
    expect(isWaking()).toBe(false)
  })

  it('the default schedule waits about 90 seconds in all', async () => {
    const { WAKE_RETRY_DELAYS_MS } = await import('./client.js')
    const total = WAKE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(85_000)
    expect(total).toBeLessThanOrEqual(95_000)
  })
})

describe('the "Waking up the server…" banner', () => {
  it('shows while a request waits to retry, and goes away once the API answers', async () => {
    setWakeRetryDelays([150])
    wakesAfter('get', '/leads', 1, loadingPage)
    render(<WakingBanner />)
    expect(screen.queryByRole('status')).toBeNull()

    let settled = false
    const pending = api.get('/leads').then(() => (settled = true))
    expect(await screen.findByRole('status')).toHaveTextContent('Waking up the server')
    await act(() => pending)
    expect(settled).toBe(true)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('also shows while a request is just slow (Render may hold the connection while it boots)', async () => {
    setSlowRequestMs(30)
    server.use(
      http.get(`${API}/leads`, async () => {
        await new Promise((r) => setTimeout(r, 200))
        return ok([])
      }),
    )
    render(<WakingBanner />)
    const pending = api.get('/leads')
    expect(await screen.findByRole('status')).toHaveTextContent('Waking up the server')
    await act(() => pending)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('stays hidden for ordinary fast requests and real errors', async () => {
    server.use(
      http.get(`${API}/leads`, () => ok([])),
      http.get(`${API}/deals`, () => fail(403, 'FORBIDDEN', 'no')),
    )
    render(<WakingBanner />)
    await api.get('/leads')
    await api.get('/deals').catch(() => {})
    expect(screen.queryByRole('status')).toBeNull()
    expect(isWaking()).toBe(false)
  })
})
