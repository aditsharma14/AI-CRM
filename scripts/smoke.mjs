#!/usr/bin/env node
// Deploy smoke test, no dependencies (Node 24's fetch): node scripts/smoke.mjs <base-url>
// Against the browser-facing origin (Vercel in production, nginx :8080 in compose), so it goes through the same proxy
// a user does: health, register a throwaway smoke org, create and convert a lead, refresh, log out, refresh refused.
// Exits non-zero on the first failure. It deletes its lead and deal; the org and its owner stay, marked isSmoke by the
// API from the reserved @smoke.nimbus.invalid domain (backend/src/utils/smoke.js), so they can be left out and counted.
import { randomBytes } from 'node:crypto'

import { SMOKE_EMAIL_DOMAIN } from '../backend/src/utils/smoke.js'

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? '').replace(/\/+$/, '')
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/smoke.mjs <base-url>   e.g. https://nimbus-crm.vercel.app')
  process.exit(2)
}
const api = `${base}/api/v1`

// A sleeping free-tier backend takes about a minute to wake; Vercel gives up on it after 120 s.
const WAKE_BUDGET_MS = Number(process.env.SMOKE_WAKE_BUDGET_MS ?? 150_000)

class SmokeError extends Error {}
const fail = (message) => {
  throw new SmokeError(message)
}

let refreshCookie = null
let accessToken = null

/** One API call. Returns { status, body, headers }; never throws on an HTTP status. */
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
  return { status: res.status, body: parsed, text, headers: res.headers }
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

const steps = []
async function step(name, run) {
  const started = Date.now()
  const result = await run()
  const ms = Date.now() - started
  steps.push({ name, ms })
  console.log(`ok  ${name} (${ms} ms)`)
  return result
}

const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`
const created = { leadId: null, dealId: null }

async function main() {
  console.log(`smoke test against ${base}`)

  await step('health (waits for a cold start)', async () => {
    const deadline = Date.now() + WAKE_BUDGET_MS
    for (let attempt = 1; ; attempt += 1) {
      const res = await call('GET', '/health', { auth: false }).catch((err) => ({ status: 0, text: String(err) }))
      if (res.status === 200 && res.body?.data?.status === 'ok') {
        console.log(`    commit ${res.body.data.commit ?? '(not reported)'}, attempt ${attempt}`)
        return
      }
      // Render's loading page, a gateway error or no connection yet: the server is waking.
      if (Date.now() > deadline)
        fail(`health: no healthy answer within ${WAKE_BUDGET_MS / 1000} s (last: ${res.status})`)
      await new Promise((r) => setTimeout(r, 5_000))
    }
  })

  await step('register a smoke org', async () => {
    const data = await expectStatus('register', 200, 'POST', '/auth/register-org', {
      auth: false,
      body: {
        orgName: `smoke-${stamp}`,
        name: 'Smoke Test',
        email: `smoke+${stamp}@${SMOKE_EMAIL_DOMAIN}`,
        password: randomBytes(18).toString('base64url'),
      },
    })
    accessToken = data.accessToken
    if (!accessToken) fail('register: no access token')
    if (!refreshCookie) fail('register: no refresh cookie')
  })

  await step('create a lead', async () => {
    const lead = await expectStatus('create lead', 201, 'POST', '/leads', { body: { name: `Smoke lead ${stamp}` } })
    created.leadId = lead._id
  })

  await step('convert it to a deal (a transaction)', async () => {
    const deal = await expectStatus('convert', 201, 'POST', `/leads/${created.leadId}/convert`, { body: {} })
    created.dealId = deal._id
    if (String(deal.convertedFromLeadId) !== String(created.leadId)) fail('convert: deal not linked to the lead')
    const lead = await expectStatus('read lead', 200, 'GET', `/leads/${created.leadId}`)
    if (lead.status !== 'converted') fail(`convert: lead status is ${lead.status}`)
  })

  await step('refresh the session (cookie through the proxy)', async () => {
    const before = refreshCookie
    const data = await expectStatus('refresh', 200, 'POST', '/auth/refresh', { auth: false, cookie: true })
    if (!data.accessToken) fail('refresh: no access token')
    if (refreshCookie === before) fail('refresh: the refresh token was not rotated')
    accessToken = data.accessToken
  })

  await step('delete the lead and the deal', () => cleanUp({ strict: true }))

  await step('log out, then refresh is refused', async () => {
    const cookie = refreshCookie
    await expectStatus('logout', 200, 'POST', '/auth/logout', { auth: false, cookie: true })
    refreshCookie = cookie
    await expectStatus('refresh after logout', 401, 'POST', '/auth/refresh', { auth: false, cookie: true })
  })
}

/** Deletes what the run created (the deal first: it points at the lead). `strict` fails the run if a delete does. */
async function cleanUp({ strict = false } = {}) {
  if (!accessToken) return
  for (const [key, path] of [
    ['dealId', 'deals'],
    ['leadId', 'leads'],
  ]) {
    if (!created[key]) continue
    const res = await call('DELETE', `/${path}/${created[key]}`)
    if (res.status === 200) created[key] = null
    else if (strict) fail(`cleanup: DELETE /${path}/${created[key]} -> ${res.status}`)
    else console.error(`    cleanup: DELETE /${path}/${created[key]} -> ${res.status}`)
  }
}

try {
  await main()
  const total = steps.reduce((sum, s) => sum + s.ms, 0)
  console.log(`smoke test passed in ${total} ms`)
} catch (err) {
  console.error(`FAIL ${err instanceof SmokeError ? err.message : err.stack}`)
  await cleanUp().catch(() => {})
  process.exit(1)
}
