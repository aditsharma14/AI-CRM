// Rate limiter and structured per-request logger.
import { rateLimit } from 'express-rate-limit'
import morgan from 'morgan'

import { env } from '../config/index.js'

// Silent under the test runner — the role matrix makes hundreds of requests
// per file and a log line for each buries the actual failures.
export const requestLogger = morgan(env.nodeEnv === 'production' ? 'combined' : 'dev', {
  skip: () => env.nodeEnv === 'test',
})

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
})
