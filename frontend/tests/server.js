// @ts-check
// MSW server shared by every test, plus builders for the API's { success, data, error, meta } envelope.
import { HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

/** Same-origin prefix the axios instance in src/api/client.js uses. */
export const API = '/api/v1'

export const server = setupServer()

/**
 * @typedef {{ page: number, limit: number, total: number, hasMore: boolean }} PageMeta
 */

/**
 * A success envelope, as built by the backend's apiResponse().
 * @param {unknown} data
 * @param {PageMeta | null} [meta]
 * @param {number} [status]
 * @returns {Response}
 */
export function ok(data, meta = null, status = 200) {
  return HttpResponse.json({ success: true, data, error: null, meta }, { status })
}

/**
 * An error envelope, as formatted by the backend's errorHandler.
 * @param {number} status
 * @param {string} code e.g. 'FORBIDDEN', 'UNAUTHORIZED'
 * @param {string} message
 * @returns {Response}
 */
export function fail(status, code, message) {
  return HttpResponse.json({ success: false, data: null, error: { code, message }, meta: null }, { status })
}

/**
 * A one-page list envelope.
 * @param {unknown[]} rows
 * @returns {Response}
 */
export function page(rows) {
  return ok(rows, { page: 1, limit: 20, total: rows.length, hasMore: false })
}
