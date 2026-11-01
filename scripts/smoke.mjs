#!/usr/bin/env node
// Full-stack smoke test, no dependencies (Node 24's fetch): node scripts/smoke.mjs <base-url>
// Against the browser-facing origin (nginx on :8080 in docker compose), so it goes through the same proxy a user does:
// health, register a throwaway smoke-<ts> org, create and convert a lead, refresh, log out, refresh refused.
// Exits non-zero on the first failure.
import { randomBytes } from 'node:crypto'

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? '').replace(/\/+$/, '')
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/smoke.mjs <base-url>   e.g. http://localhost:8080')
  process.exit(2)
}
const api = `${base}/api/v1`

// Right after `docker compose up` the api may still be connecting to mongo.
const READY_BUDGET_MS = Number(process.env.SMOKE_READY_BUDGET_MS ?? 60_000)

class SmokeError extends Error {}
const fail = (message) => {
  throw new SmokeError(message)
}

let refreshCookie = null
let accessToken = null

/** One API call. Returns { status, body, text }; never throws on an HTTP status. */
async function call(method, path, { body, auth = true, cookie = false } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (cookie && refreshCookie) headers.Cookie = refreshCookie
  const res = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  for (const line of res.headers.getSetCookie()) {
    const match = /^(refreshToken=[^;]*)/.exec(line)
    if (match) refreshCookie = match[1]
  }
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    // Left null: the check below says what came back instead.
  }
  return { status: res.status, body: parsed, text }
}

/** Calls and checks the status and the envelope; returns `data`. */
async function expectStatus(label, expected, method, path, options) {
  const res = await call(method, path, options)
  if (res.status !== expected) {
    const detail = res.body?.error ? `${res.body.error.code}: ${res.body.error.message}` : res.text.slice(0, 200)
    fail(`${label}: expected ${expected}, got ${res.status} (${detail})`)
  }
  if (!res.body || typeof res.body.success !== 'boolean') fail(`${label}: not the API's JSON envelope`)
  return res.body.data
}

let total = 0
async function step(name, run) {
  const started = Date.now()
  await run()
  const ms = Date.now() - started
  total += ms
  console.log(`ok  ${name} (${ms} ms)`)
}

const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`
let leadId = null

async function main() {
  console.log(`smoke test against ${base}`)

  await step('health', async () => {
    const deadline = Date.now() + READY_BUDGET_MS
    for (;;) {
      const res = await call('GET', '/health', { auth: false }).catch((err) => ({ status: 0, text: String(err) }))
      if (res.status === 200 && res.body?.data?.status === 'ok') {
        console.log(`    commit ${res.body.data.commit}`)
        return
      }
      if (Date.now() > deadline) fail(`health: not healthy within ${READY_BUDGET_MS / 1000} s (last: ${res.status})`)
      await new Promise((r) => setTimeout(r, 2_000))
    }
  })

  await step(`register org smoke-${stamp}`, async () => {
    const data = await expectStatus('register', 200, 'POST', '/auth/register-org', {
      auth: false,
      body: {
        orgName: `smoke-${stamp}`,
        name: 'Smoke Test',
        email: `smoke-${stamp}@smoke.test`,
        password: randomBytes(18).toString('base64url'),
      },
    })
    accessToken = data.accessToken
    if (!accessToken) fail('register: no access token')
    if (!refreshCookie) fail('register: no refresh cookie')
  })

  await step('create a lead', async () => {
    leadId = (await expectStatus('create lead', 201, 'POST', '/leads', { body: { name: `Smoke lead ${stamp}` } }))._id
  })

  await step('convert it to a deal (a transaction)', async () => {
    const deal = await expectStatus('convert', 201, 'POST', `/leads/${leadId}/convert`, { body: {} })
    if (String(deal.convertedFromLeadId) !== String(leadId)) fail('convert: deal not linked to the lead')
    const lead = await expectStatus('read lead', 200, 'GET', `/leads/${leadId}`)
    if (lead.status !== 'converted') fail(`convert: lead status is ${lead.status}`)
  })

  await step('refresh the session (cookie through the proxy)', async () => {
    const before = refreshCookie
    const data = await expectStatus('refresh', 200, 'POST', '/auth/refresh', { auth: false, cookie: true })
    if (!data.accessToken) fail('refresh: no access token')
    if (refreshCookie === before) fail('refresh: the refresh token was not rotated')
    accessToken = data.accessToken
  })

  await step('log out, then refresh is refused', async () => {
    const cookie = refreshCookie
    await expectStatus('logout', 200, 'POST', '/auth/logout', { auth: false, cookie: true })
    refreshCookie = cookie
    await expectStatus('refresh after logout', 401, 'POST', '/auth/refresh', { auth: false, cookie: true })
  })
}

try {
  await main()
  console.log(`smoke test passed in ${total} ms`)
} catch (err) {
  console.error(`FAIL ${err instanceof SmokeError ? err.message : err.stack}`)
  process.exit(1)
}
