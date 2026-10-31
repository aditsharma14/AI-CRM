// Validates required env vars at boot; exports env and connectDB().
import 'dotenv/config'

import mongoose from 'mongoose'

import { ttlToMs } from '../utils/duration.js'

// AI_SERVICE_URL joins this list with the AI proxy (S2.2).
const REQUIRED = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'CLIENT_ORIGIN']

const missing = REQUIRED.filter((key) => !process.env[key])
if (missing.length) {
  // Fail fast at boot — a misconfigured deploy should never take its first
  // request before dying.
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

// How many proxy hops of X-Forwarded-For to believe. 0 (the default) locally and in compose, where nothing sits in
// front of the API; 2 in production (Vercel's rewrite, then Render's ingress), so req.ip is the visitor.
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return 0
  if (!/^\d+$/.test(raw) || Number(raw) > 10) {
    throw new Error(`TRUST_PROXY must be a hop count from 0 to 10, got ${JSON.stringify(raw)}.`)
  }
  return Number(raw)
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || '7d',
  clientOrigin: process.env.CLIENT_ORIGIN,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 100,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // Silent under the test runner: the role matrix makes hundreds of requests per file.
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
}

// Same fail-fast rule for a lifetime the cookie code couldn't read.
ttlToMs(env.refreshTokenTtl)

// The placeholders in .env.example and docker-compose.yml are fine for development, never for production:
// anyone who has read the repo could sign tokens. (The error never includes the secret.)
const PLACEHOLDER_SECRETS = ['change-me-access-secret', 'dev-only-compose-secret-change-me']
if (env.nodeEnv === 'production') {
  const secret = env.jwtAccessSecret ?? ''
  if (secret.length < 32 || PLACEHOLDER_SECRETS.includes(secret)) {
    throw new Error(
      'JWT_ACCESS_SECRET must be at least 32 characters, and not a placeholder, when NODE_ENV=production.',
    )
  }
}

export async function connectDB() {
  mongoose.set('strictQuery', true)
  await mongoose.connect(env.mongoUri)
  return mongoose.connection
}
