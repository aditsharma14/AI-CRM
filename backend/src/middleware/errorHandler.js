// The only place that writes an error response: maps every error to the envelope's error branch.
import { logger } from '../config/logger.js'
import { AppError, notFound, zodIssuesMessage } from '../utils/http.js'

/** Sends `{ success: false, data: null, error: { code, message }, meta: null }`. */
function sendError(res, status, code, message) {
  return res.status(status).json({ success: false, data: null, error: { code, message }, meta: null })
}

/**
 * One Mongoose path error in the API's "field: message" form, without the model name or Mongoose's
 * "Path `x`" wording. `_id` is reported as `id`, the name clients use.
 */
function mongooseIssue(path, error) {
  const field = path === '_id' ? 'id' : path
  if (error.name === 'CastError') return `${field}: ${error.kind === 'ObjectId' ? 'invalid id' : 'invalid value'}`
  if (error.kind === 'required') return `${field}: is required`
  if (error.kind === 'enum') return `${field}: must be one of ${error.properties.enumValues.join(', ')}`
  return `${field}: ${String(error.message)
    .replace(/^Path `[^`]+` /, '')
    .replace(/\.$/, '')}`
}

/** No route matched: forwarded to errorHandler like any other error. */
export function notFoundHandler(req, res, next) {
  next(notFound(`No route for ${req.method} ${req.originalUrl}`))
}

// Express recognises error middleware by its four parameters, so _next must stay.
export function errorHandler(err, req, res, _next) {
  // Thrown on purpose (services, guards, validate()): status, code and message are safe to send.
  if (err instanceof AppError) return sendError(res, err.status, err.code, err.message)

  // A Zod .parse() that threw instead of going through validate(); same message format.
  if (err.name === 'ZodError') return sendError(res, 400, 'VALIDATION_ERROR', zodIssuesMessage(err.issues))

  // express.json(): a body that isn't JSON, or is over the size limit (100 kB).
  if (err.type === 'entity.parse.failed') return sendError(res, 400, 'VALIDATION_ERROR', 'body: malformed JSON.')
  if (err.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'body: the request body is too large.')
  }

  // Mongoose schema validation: one "field: message" per failing path, sorted, like validate()'s Zod output.
  if (err.name === 'ValidationError') {
    const issues = Object.entries(err.errors)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, error]) => mongooseIssue(path, error))
    return sendError(res, 400, 'VALIDATION_ERROR', issues.join('; '))
  }

  // A value Mongoose couldn't cast for a query (e.g. a malformed id that skipped validation).
  if (err.name === 'CastError') return sendError(res, 400, 'VALIDATION_ERROR', mongooseIssue(err.path, err))

  // Unique index violation.
  if (err.code === 11000) return sendError(res, 409, 'DUPLICATE_KEY', 'A record with that value already exists.')

  // Anything else is a bug: log it with the request id, and never send its details.
  const log = req.log ?? logger
  log.error({ err }, 'unhandled error')
  return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
}
