// Global search (/api/v1/search) and dashboard/report aggregation reads (/api/v1/dashboard).
import { Router } from 'express'

import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { searchQuery } from '../schemas/insights.js'
import * as insightsService from '../services/insightsService.js'
import { apiResponse, asyncHandler } from '../utils/http.js'

export const searchRoutes = Router()
searchRoutes.use(auth)

searchRoutes.get(
  '/',
  requirePermission('crm', 'read'),
  validate({ query: searchQuery }),
  asyncHandler(async (req, res) => apiResponse(res, await insightsService.search(req.user.orgId, req.query.q))),
)

export const dashboardRoutes = Router()
dashboardRoutes.use(auth)

dashboardRoutes.get(
  '/overview',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => apiResponse(res, await insightsService.dashboardOverview(req.user.orgId))),
)

dashboardRoutes.get(
  '/reports',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => apiResponse(res, await insightsService.dashboardReports(req.user.orgId))),
)
