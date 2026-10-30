// The only place that writes an error response: maps every error to the envelope's error branch.
import { logger } from '../config/logger.js'
import { AppError, notFound, zodIssuesMessage } from '../utils/http.js'

/** Sends `{ success: false, data: null, error: { code, message }, meta: null }`. */
function sendError(res, status, code, message) {
  return res.status(status).json({ success: false, data: null, error: { code, message }, meta: null })
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

  // Mongoose schema validation.
  if (err.name === 'ValidationError') return sendError(res, 400, 'VALIDATION_ERROR', err.message)

  // Unique index violation.
  if (err.code === 11000) return sendError(res, 409, 'DUPLICATE_KEY', 'A record with that value already exists.')

  // Anything else is a bug: log it with the request id, and never send its details.
  const log = req.log ?? logger
  log.error({ err }, 'unhandled error')
  return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
}
