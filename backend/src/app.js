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

const app = express()

// First, so every request gets an id and a log line, even one that fails in body parsing.
app.use(requestLogger)
app.use(helmet())
app.use(cors({ origin: env.clientOrigin, credentials: true }))
app.use(express.json())
app.use(cookieParser())
app.use('/api', apiRateLimiter)

app.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }))

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
