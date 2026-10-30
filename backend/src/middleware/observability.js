// Rate limiter and the per-request logger (one JSON line per request, with a request id).
import { randomUUID } from 'node:crypto'

import { rateLimit } from 'express-rate-limit'
import { pinoHttp } from 'pino-http'

import { env } from '../config/index.js'
import { logger } from '../config/logger.js'

// The path, not the route pattern: Express resets req.baseUrl when a handler fails, so the pattern
// would read "/:id" for most errors. The query string is dropped because it can carry search terms.
const pathOf = (req) => req.originalUrl.split('?')[0]

// Every line carries reqId; errorHandler logs through req.log, so an error and its request share it.
// The id is also returned as X-Request-Id, so a user can quote it in a bug report.
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = randomUUID()
    res.setHeader('X-Request-Id', id)
    return id
  },
  // Only these fields: no headers, cookies, query or body ever reach the request log.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, path: pathOf(req.raw ?? req) }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  customSuccessMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
})

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
})
