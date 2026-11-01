// Express app assembly: global middleware, route mounting, error handler.
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'

import { env } from './config/index.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { apiRateLimiter, requestLogger } from './middleware/observability.js'
import activitiesRoutes from './routes/activities.routes.js'
import aiRoutes from './routes/ai.routes.js'
import authRoutes from './routes/auth.routes.js'
import { companiesRoutes, contactsRoutes, notesRoutes } from './routes/crud.routes.js'
import dealsRoutes from './routes/deals.routes.js'
import { dashboardRoutes, searchRoutes } from './routes/insights.routes.js'
import leadsRoutes from './routes/leads.routes.js'
import notificationsRoutes from './routes/notifications.routes.js'
import orgAdminRoutes from './routes/orgAdmin.routes.js'
import { apiResponse } from './utils/http.js'

const app = express()
// Without it, behind Vercel and Render every visitor has the proxy's IP and shares one rate-limit bucket.
app.set('trust proxy', env.trustProxy)

// First, so every request gets an id and a log line, even one that fails in body parsing.
app.use(requestLogger)
app.use(helmet())
app.use(cors({ origin: env.clientOrigin, credentials: true }))
// Before body parsing, so its errors carry it too: sessions and tenant data must never be kept by a CDN or browser.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})
app.use(express.json())
app.use(cookieParser())

// /health is the container check; /api/v1/health answers through the same-origin /api proxy (scripts/smoke.mjs) and
// reports the commit the image was built from (GIT_COMMIT). Both sit ahead of the rate limiter.
app.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }))
app.get('/api/v1/health', (req, res) => apiResponse(res, { status: 'ok', commit: process.env.GIT_COMMIT || 'dev' }))

app.use('/api', apiRateLimiter)

// Public: what the frontend may offer before anyone signs in (e.g. no "Forgot password?" without email).
app.get('/api/v1/config', (req, res) => apiResponse(res, { emailEnabled: env.emailEnabled }))

app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/org', orgAdminRoutes)
app.use('/api/v1/leads', leadsRoutes)
app.use('/api/v1/deals', dealsRoutes)
app.use('/api/v1/activities', activitiesRoutes)
app.use('/api/v1/contacts', contactsRoutes)
app.use('/api/v1/companies', companiesRoutes)
app.use('/api/v1/notes', notesRoutes)
app.use('/api/v1/notifications', notificationsRoutes)
app.use('/api/v1/search', searchRoutes)
app.use('/api/v1/dashboard', dashboardRoutes)
app.use('/api/v1/ai', aiRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
