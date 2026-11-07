// The demo honours Idempotency-Key like the real API (backend/tests/idempotency.test.js): a replay returns the stored
// answer with Idempotent-Replayed, another body or path is 422, a bad key is 400, keys are per user. The demo answers
// one request at a time, so it never has a 409 IDEMPOTENCY_IN_PROGRESS.
import { beforeEach, describe, expect, it } from 'vitest'

import contract from '../../../contracts/idempotency.json'
import { server } from '../../tests/server.js'
import { api, setAccessToken } from '../api/client.js'
import { createDemoApi } from './handlers.js'
import { DEMO_ACCOUNTS } from './seed.js'

let demo
const signIn = async (account) => {
  const login = await api.post('/auth/login', { email: account.email, password: 'x' })
  setAccessToken(login.data.data.accessToken)
}
beforeEach(async () => {
  demo = createDemoApi()
  server.use(...demo.handlers)
  await signIn(DEMO_ACCOUNTS.manager)
})

const withKey = (key) => ({ headers: { 'Idempotency-Key': key } })
const send = (method, path, body, key) =>
  api.request({ method, url: path, data: body, ...withKey(key) }).catch((err) => err.response)
const named = (name) => demo.db().leads.filter((l) => l.name === name).length

describe('demo Idempotency-Key', () => {
  it('a retried create is replayed: one lead, the same id, Idempotent-Replayed', async () => {
    const key = crypto.randomUUID()
    const first = await send('post', '/leads', { name: 'Once only' }, key)
    const retry = await send('post', '/leads', { name: 'Once only' }, key)
    expect([first.status, retry.status]).toEqual([201, 201])
    expect(first.headers['idempotent-replayed']).toBeUndefined()
    expect(retry.headers['idempotent-replayed']).toBe('true')
    expect(retry.data).toEqual(first.data)
    expect(named('Once only')).toBe(1)
  })

  it('a retried convert replays the same deal', async () => {
    const lead = (await send('post', '/leads', { name: 'To convert' }, crypto.randomUUID())).data.data
    const key = crypto.randomUUID()
    const first = await send('post', `/leads/${lead._id}/convert`, undefined, key)
    const retry = await send('post', `/leads/${lead._id}/convert`, undefined, key)
    expect([first.status, retry.status, retry.headers['idempotent-replayed']]).toEqual([201, 201, 'true'])
    expect(retry.data.data._id).toBe(first.data.data._id)
  })

  it('the same key with another body or on another path is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = crypto.randomUUID()
    expect((await send('post', '/leads', { name: 'First' }, key)).status).toBe(201)
    const body = await send('post', '/leads', { name: 'Second' }, key)
    const path = await send('post', '/deals', { title: 'First', value: 1 }, key)
    for (const res of [body, path]) expect([res.status, res.data.error.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED'])
    expect(named('Second')).toBe(0)
  })

  it('a malformed key is 400 VALIDATION_ERROR and writes nothing', async () => {
    const res = await send('post', '/leads', { name: 'Bad key' }, 'short')
    expect([res.status, res.data.error.code]).toEqual([400, 'VALIDATION_ERROR'])
    expect(res.data.error.message).toMatch(/^idempotency-key: /)
    expect(named('Bad key')).toBe(0)
  })

  it('keys are per user', async () => {
    const key = crypto.randomUUID()
    expect((await send('post', '/leads', { name: 'Shared key' }, key)).status).toBe(201)
    await signIn(DEMO_ACCOUNTS.member)
    const other = await send('post', '/leads', { name: 'Shared key' }, key)
    expect([other.status, other.headers['idempotent-replayed']]).toEqual([201, undefined])
    expect(named('Shared key')).toBe(2)
  })
})

describe('the contract (contracts/idempotency.json)', () => {
  it('the demo sends the codes, statuses and header it lists, and never a 409', async () => {
    expect(contract.errors.IDEMPOTENCY_IN_PROGRESS.demo).toBe(false)
    const key = crypto.randomUUID()
    await send('post', '/leads', { name: 'Contract' }, key)
    const replay = await send('post', '/leads', { name: 'Contract' }, key)
    expect(replay.headers[contract.replayHeader.toLowerCase()]).toBe('true')
    const reused = await send('post', '/leads', { name: 'Contract 2' }, key)
    expect(reused.status).toBe(contract.errors.IDEMPOTENCY_KEY_REUSED.status)
    const pattern = new RegExp(contract.keyPattern)
    for (const k of ['short', 'a'.repeat(8), 'a'.repeat(15), 'k'.repeat(65), 'a'.repeat(16), crypto.randomUUID()]) {
      const res = await send('post', '/leads', { name: `Pattern ${k}` }, k)
      expect(res.status === 400, k).toBe(!pattern.test(k))
    }
  })
})
