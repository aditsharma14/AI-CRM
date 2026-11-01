// @ts-check
// MSW server shared by every test. The envelope builders live with the demo's handlers (src/demo/envelope.js), so
// tests and the demo answer in exactly the same shape.
import { http } from 'msw'
import { setupServer } from 'msw/node'

import { page } from '../src/demo/envelope.js'

export { fail, ok, page } from '../src/demo/envelope.js'

/** Same-origin prefix the axios instance in src/api/client.js uses. */
export const API = '/api/v1'

export const server = setupServer()

/**
 * Serves GET `path` with `rows` and records each request's query string, so a
 * test can assert exactly which filters the UI sent.
 * @param {string} path e.g. '/leads' (API prefix added here)
 * @param {unknown[]} [rows]
 * @returns {Record<string, string>[]} Live list: one entry per request, query params as a plain object.
 */
export function recordList(path, rows = []) {
  /** @type {Record<string, string>[]} */
  const seen = []
  server.use(
    http.get(`${API}${path}`, ({ request }) => {
      seen.push(Object.fromEntries(new URL(request.url).searchParams))
      return page(rows)
    }),
  )
  return seen
}
