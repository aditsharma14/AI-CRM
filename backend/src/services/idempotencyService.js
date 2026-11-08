// @ts-check
// Idempotency-Key records: claim a key (or replay its answer, or refuse), save the answer, free the key. Called by
// middleware/idempotency.js, and by lead convert through it, which saves inside its own transaction.
import { createHash } from 'node:crypto'

import IdempotencyRecord, { LEASE_MS, TTL_SECONDS } from '../models/IdempotencyRecord.js'
import { AppError } from '../utils/http.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('mongoose').Types.ObjectId} ObjectId */
/**
 * What a replay sends: the original status, the headers a client relies on, and the JSON text.
 * @typedef {{ status: number, headers: Record<string, string>, body: string }} StoredResponse
 */
/** @typedef {{ run: ObjectId } | { replay: StoredResponse }} Claim */

/** Larger answers are not stored (the record is deleted), so one key can't hold more than this for 24 h. */
export const MAX_RESPONSE_BYTES = 64 * 1024
const CLAIM_ATTEMPTS = 3

const inProgress = () =>
  new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still running. Retry shortly.')
const keyReused = () =>
  new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.')

/**
 * JSON with object keys sorted at every depth, so the order a client wrote its fields in never changes the hash.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * @param {unknown} body The validated request body (absent counts as `{}`).
 * @returns {string} sha256 hex.
 */
export const hashBody = (body) =>
  createHash('sha256')
    .update(canonicalJson(body ?? {}))
    .digest('hex')

/**
 * Claims `key` for this request. Insert first: the unique (orgId, userId, key) index lets exactly one of any number of
 * parallel requests in. The others read the winner's record and get its answer, a 409 or a 422.
 * @param {AuthUser} actor
 * @param {{ key: string, method: string, path: string, bodyHash: string }} request
 * @returns {Promise<Claim>} `run`: go ahead, the record is ours. `replay`: send this instead.
 * @throws {AppError} 409 IDEMPOTENCY_IN_PROGRESS, 422 IDEMPOTENCY_KEY_REUSED
 */
export async function claim(actor, { key, method, path, bodyHash }) {
  const scope = { orgId: actor.orgId, userId: actor.id, key }
  // A retry of the loop happens only when the record vanished between the insert and the read (a 5xx freed it, or
  // an expired one was cleared), so three attempts is plenty; past that, the key is busy.
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const now = new Date()
    try {
      const record = await IdempotencyRecord.create({
        ...scope,
        method,
        path,
        bodyHash,
        state: 'in_progress',
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        createdAt: now,
      })
      return { run: record._id }
    } catch (err) {
      if (/** @type {{ code?: unknown }} */ (err)?.code !== 11000) throw err
    }

    const existing = await IdempotencyRecord.findOne(scope).lean()
    if (!existing) continue
    // Past its 24 h, but the TTL monitor (about once a minute) hasn't removed it yet.
    if (existing.createdAt.getTime() <= now.getTime() - TTL_SECONDS * 1000) {
      await IdempotencyRecord.deleteOne({ _id: existing._id, createdAt: existing.createdAt })
      continue
    }
    if (existing.method !== method || existing.path !== path || existing.bodyHash !== bodyHash) throw keyReused()
    if (existing.state === 'done') {
      return {
        replay: {
          status: existing.status ?? 200,
          headers: /** @type {Record<string, string>} */ (existing.headers ?? {}),
          body: existing.response ?? '',
        },
      }
    }
    if (existing.lockedUntil > now) throw inProgress()
    // The process that held it died: take the lease over, conditionally, so of two retries only one does.
    const taken = await IdempotencyRecord.updateOne(
      { _id: existing._id, state: 'in_progress', lockedUntil: existing.lockedUntil },
      { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) } },
    )
    if (taken.modifiedCount === 1) return { run: existing._id }
    throw inProgress()
  }
  throw inProgress()
}

/**
 * The answer to store, or null when it is over MAX_RESPONSE_BYTES.
 * @param {number} status
 * @param {unknown} body What was passed to res.json.
 * @param {Record<string, string>} headers Only those a client relies on; never Set-Cookie.
 * @returns {StoredResponse | null}
 */
export function storable(status, body, headers) {
  const text = JSON.stringify(body)
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return null
  return { status, headers, body: text }
}

/**
 * Marks the claimed record done with its answer. Pass a session to make it part of the handler's own transaction.
 * @param {ObjectId} id
 * @param {StoredResponse} response
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<void>}
 */
export async function complete(id, { status, headers, body }, { session } = {}) {
  await IdempotencyRecord.updateOne(
    { _id: id, state: 'in_progress' },
    { $set: { state: 'done', status, headers, response: body } },
    { session },
  )
}

/**
 * Frees the key, so a retry runs the handler again: after a 5xx or a 429, or an answer too large to store. A record
 * already done (saved inside a transaction that committed) stays.
 * @param {ObjectId} id
 * @returns {Promise<void>}
 */
export async function release(id) {
  await IdempotencyRecord.deleteOne({ _id: id, state: 'in_progress' })
}
