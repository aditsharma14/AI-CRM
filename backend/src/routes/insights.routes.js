// Global search plus dashboard/report aggregation reads.
import { Router } from 'express'

import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { searchQuery } from '../schemas/insights.js'
import * as insightsService from '../services/insightsService.js'
import { apiResponse, asyncHandler } from '../utils/http.js'

const router = Router()
router.use(auth)

router.get(
  '/search',
  requirePermission('crm', 'read'),
  validate({ query: searchQuery }),
  asyncHandler(async (req, res) => apiResponse(res, await insightsService.search(req.user.orgId, req.query.q))),
)

router.get(
  '/dashboard/overview',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => apiResponse(res, await insightsService.dashboardOverview(req.user.orgId))),
)

router.get(
  '/dashboard/reports',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => apiResponse(res, await insightsService.dashboardReports(req.user.orgId))),
)

export default router
