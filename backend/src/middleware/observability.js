// Rate limiter and structured per-request logger.
import morgan from 'morgan'
import { rateLimit } from 'express-rate-limit'
import { env } from '../config/index.js'

export const requestLogger = morgan(env.nodeEnv === 'production' ? 'combined' : 'dev')

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
})
