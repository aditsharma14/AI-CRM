// The one pino logger: JSON lines, with credentials redacted wherever they appear.
import pino from 'pino'

import { env } from './index.js'

export const logger = pino({
  level: env.logLevel,
  // Request logs only carry method, path, route and status, so these are a backstop for
  // anything else that logs a request, a response or an error holding one.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      // body-parser errors carry the raw request body.
      'err.body',
      'headers.authorization',
      'headers.cookie',
      'password',
      '*.password',
      'token',
      '*.token',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
})
