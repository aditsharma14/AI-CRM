// @ts-check
// apiResponse() envelope builder, AppError and its helpers, zodIssuesMessage(), asyncHandler().

/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('express').NextFunction} NextFunction */
/** @typedef {import('../types/index.js').ApiResponse<unknown>['meta']} ResponseMeta */

/**
 * Sends the success branch of the one envelope every endpoint returns.
 * @template T
 * @param {Response} res
 * @param {T} data
 * @param {ResponseMeta} [meta]
 * @param {number} [status]
 * @returns {Response}
 */
export function apiResponse(res, data, meta = null, status = 200) {
  return res.status(status).json({ success: true, data, error: null, meta })
}

/** A typed, throwable error that errorHandler.js turns into the envelope's error branch. */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code.
   * @param {string} code Machine-readable code, e.g. 'NOT_FOUND'.
   * @param {string} message Safe to show to the client.
   */
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * One VALIDATION_ERROR message from Zod issues, each prefixed with its field ("status: Invalid option…"),
 * so '?status=nope' says which param was wrong.
 * @param {ReadonlyArray<{ path: ReadonlyArray<PropertyKey>, message: string }>} issues
 * @returns {string}
 */
export const zodIssuesMessage = (issues) =>
  issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)).join('; ')

/**
 * @param {string} message
 * @param {string} [code]
 * @returns {AppError}
 */
export const badRequest = (message, code = 'BAD_REQUEST') => new AppError(400, code, message)

/**
 * @param {string} [message]
 * @param {string} [code]
 * @returns {AppError}
 */
export const unauthorized = (message = 'Unauthorized', code = 'UNAUTHORIZED') => new AppError(401, code, message)

/**
 * @param {string} [message]
 * @param {string} [code]
 * @returns {AppError}
 */
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') => new AppError(403, code, message)

/**
 * @param {string} [message]
 * @param {string} [code]
 * @returns {AppError}
 */
export const notFound = (message = 'Not found', code = 'NOT_FOUND') => new AppError(404, code, message)

/**
 * Express 5 forwards rejected async handlers to error middleware on its own,
 * but routes stay explicit about that contract instead of depending on it.
 * @param {(req: Request, res: Response, next: NextFunction) => unknown} fn
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
