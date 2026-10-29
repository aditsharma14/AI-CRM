// List/mark-read notifications; read-only activity-log listing.
import { Router } from 'express'
import { Notification, ActivityLog } from '../models/Logs.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler, notFound } from '../utils/http.js'
import { paginationQuery } from '../utils/validators.js'
import { idParam } from '../schemas/common.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  validate({ query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query
    const filter = { orgId: req.user.orgId, userId: req.user.id }
    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...filter, read: false }),
    ])
    apiResponse(res, items, { page, limit, total, hasMore: page * limit < total, unreadCount })
  }),
)

router.patch(
  '/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const doc = await Notification.findOneAndUpdate(
      { _id: req.params.id, orgId: req.user.orgId, userId: req.user.id },
      { read: true },
      { new: true },
    )
    if (!doc) throw notFound('Notification not found.')
    apiResponse(res, doc)
  }),
)

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ orgId: req.user.orgId, userId: req.user.id, read: false }, { read: true })
    apiResponse(res, null)
  }),
)

router.get(
  '/activity-log',
  requirePermission('reports', 'view'),
  validate({ query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query
    const filter = { orgId: req.user.orgId }
    const [items, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'name'),
      ActivityLog.countDocuments(filter),
    ])
    apiResponse(res, items, { page, limit, total, hasMore: page * limit < total })
  }),
)

export default router
