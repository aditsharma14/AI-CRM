// List/mark-read notifications; read-only activity-log listing.
import { Router } from 'express'

import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { idParam } from '../schemas/common.js'
import { activityLogQuery, notificationListQuery } from '../schemas/notifications.js'
import * as notificationsService from '../services/notificationsService.js'
import { apiResponse, asyncHandler } from '../utils/http.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  validate({ query: notificationListQuery }),
  asyncHandler(async (req, res) => {
    const { items, meta } = await notificationsService.list(req.user, req.query)
    apiResponse(res, items, meta)
  }),
)

router.patch(
  '/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => apiResponse(res, await notificationsService.markRead(req.user, req.params.id))),
)

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    await notificationsService.markAllRead(req.user)
    apiResponse(res, null)
  }),
)

router.get(
  '/activity-log',
  requirePermission('reports', 'view'),
  validate({ query: activityLogQuery }),
  asyncHandler(async (req, res) => {
    const { items, meta } = await notificationsService.activityLog(req.user, req.query)
    apiResponse(res, items, meta)
  }),
)

export default router
