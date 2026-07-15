// apiResponse()/apiError() envelope builders and asyncHandler().

/** The one response shape every endpoint in the API returns. */
export function apiResponse(res, data, meta = null, status = 200) {
  return res.status(status).json({ success: true, data, error: null, meta })
}

/** A typed, throwable error that errorHandler.js turns into the envelope's error branch. */
export class AppError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const badRequest = (message, code = 'BAD_REQUEST') => new AppError(400, code, message)
export const unauthorized = (message = 'Unauthorized', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message)
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') =>
  new AppError(403, code, message)
export const notFound = (message = 'Not found', code = 'NOT_FOUND') =>
  new AppError(404, code, message)

/**
 * Express 5 forwards rejected async handlers to error middleware on its own,
 * but routes stay explicit about that contract instead of depending on it.
 */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
