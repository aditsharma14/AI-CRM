// Idempotency-Key on the writes a client may retry (docs/conventions.md#idempotency). Goes after validate(), so a
// request that fails permission or validation never uses up its key. Captures the answer at res.json, which both
// apiResponse() and errorHandler send through, so routes and the envelope stay as they are.
import { logger } from '../config/logger.js'
import { idempotencyHeader } from '../schemas/idempotency.js'
import { claim, complete, hashBody, release, storable } from '../services/idempotencyService.js'
import { asyncHandler, badRequest, envelope, zodIssuesMessage } from '../utils/http.js'

const JSON_TYPE = 'application/json; charset=utf-8'

/**
 * The headers a replay repeats: Content-Type and Location. Never Set-Cookie: a replay must not hand out a session.
 * @param {import('express').Response} res
 * @returns {Record<string, string>}
 */
function replayHeaders(res) {
  const headers = { 'Content-Type': String(res.get('Content-Type') ?? JSON_TYPE) }
  const location = res.get('Location')
  return location ? { ...headers, Location: String(location) } : headers
}

/**
 * A 5xx or a 429 says "try again", so the key is freed for that retry instead of replaying the failure for 24 h.
 * @param {number} status
 */
const isRetryable = (status) => status >= 500 || status === 429

export function idempotent() {
  return asyncHandler(async (req, res, next) => {
    const header = req.get('Idempotency-Key')
    if (header === undefined) return next()
    const parsed = idempotencyHeader.safeParse({ 'idempotency-key': header })
    if (!parsed.success) throw badRequest(zodIssuesMessage(parsed.error.issues), 'VALIDATION_ERROR')
    const key = parsed.data['idempotency-key']

    const claimed = await claim(req.user, {
      key,
      method: req.method,
      path: req.baseUrl + req.path,
      bodyHash: hashBody(req.body),
    })
    if ('replay' in claimed) {
      const { status, headers, body } = claimed.replay
      return res.status(status).set(headers).set('Idempotent-Replayed', 'true').send(body)
    }

    const id = claimed.run
    // The status saved by saveInside() in a transaction that committed: nothing left to write at res.json.
    let savedStatus = null
    req.idempotency = {
      // For a handler with its own transaction (lead convert): the done record commits or rolls back with its writes.
      saveInside: (status) => async (data, session) => {
        const answer = storable(status, envelope(data), { 'Content-Type': JSON_TYPE })
        if (!answer) return
        await complete(id, answer, { session })
        savedStatus = status
      },
    }

    const json = res.json.bind(res)
    res.json = (body) => {
      res.json = json
      const status = res.statusCode
      const settle = async () => {
        if (isRetryable(status)) return release(id)
        if (savedStatus === status) return
        const answer = storable(status, body, replayHeaders(res))
        return answer ? complete(id, answer) : release(id)
      }
      // Saved before the answer leaves, so a retry that arrives right after it replays instead of getting a 409. If
      // the save fails, the answer is sent anyway; the key stays in progress until its lease ends (known-issues.md).
      settle()
        .catch((err) => (req.log ?? logger).error({ err, idempotencyKey: key }, 'idempotency record not saved'))
        .finally(() => json(body))
      return res
    }
    next()
  })
}
