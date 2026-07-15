// Task + calendar-event CRUD over the shared Activity model.
import { Router } from 'express'
import { z } from 'zod'
import Activity from '../models/Activity.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler, notFound } from '../utils/http.js'
import { paginationQuery, objectId, optionalObjectId, optionalDate } from '../utils/validators.js'
import { logActivity } from '../services/activityService.js'

const router = Router()
router.use(auth)

const idParam = z.object({ id: objectId })

const activityCreate = z.object({
  type: z.enum(['task', 'event', 'call', 'meeting']),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  assigneeId: optionalObjectId,
  linkedTo: z
    .object({ entityType: z.enum(['lead', 'contact', 'company', 'deal']), entityId: objectId })
    .optional(),
  dueDate: optionalDate,
  priority: z.enum(['low', 'medium', 'high']).optional(),
  startAt: optionalDate,
  endAt: optionalDate,
  allDay: z.boolean().optional(),
  status: z.enum(['open', 'done']).optional(),
})

const listQuery = paginationQuery.extend({
  type: z.enum(['task', 'event', 'call', 'meeting']).optional(),
  status: z.enum(['open', 'done']).optional(),
  assigneeId: objectId.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

router.get(
  '/',
  requirePermission('crm', 'read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { page, limit, type, status, assigneeId, dateFrom, dateTo } = req.query
    const filter = { orgId: req.user.orgId }
    if (type) filter.type = type
    if (status) filter.status = status
    if (assigneeId) filter.assigneeId = assigneeId

    // Tasks live on dueDate; calendar events live on startAt — filter
    // whichever date field this request's type actually uses.
    if (dateFrom || dateTo) {
      const dateField = type === 'task' ? 'dueDate' : 'startAt'
      filter[dateField] = {}
      if (dateFrom) filter[dateField].$gte = new Date(dateFrom)
      if (dateTo) filter[dateField].$lte = new Date(dateTo)
    }

    const sortField = type === 'task' ? 'dueDate' : 'startAt'
    const skip = (page - 1) * limit
    const [items, total] = await Promise.all([
      Activity.find(filter)
        .sort({ [sortField]: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('assigneeId', 'name'),
      Activity.countDocuments(filter),
    ])
    apiResponse(res, items, { page, limit, total, hasMore: skip + items.length < total })
  }),
)

router.get(
  '/:id',
  requirePermission('crm', 'read'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const doc = await Activity.findOne({ _id: req.params.id, orgId: req.user.orgId }).populate('assigneeId', 'name')
    if (!doc) throw notFound('Activity not found.')
    apiResponse(res, doc)
  }),
)

router.post(
  '/',
  requirePermission('crm', 'write'),
  validate({ body: activityCreate }),
  asyncHandler(async (req, res) => {
    const doc = await Activity.create({ ...req.body, orgId: req.user.orgId, assigneeId: req.body.assigneeId ?? req.user.id })
    await logActivity({
      orgId: req.user.orgId,
      userId: req.user.id,
      action: 'create',
      entityType: 'activity',
      entityId: doc._id,
      message: `Created ${doc.type} "${doc.title}"`,
    })
    apiResponse(res, doc, null, 201)
  }),
)

router.patch(
  '/:id',
  requirePermission('crm', 'write'),
  validate({ params: idParam, body: activityCreate.partial() }),
  asyncHandler(async (req, res) => {
    const doc = await Activity.findOneAndUpdate({ _id: req.params.id, orgId: req.user.orgId }, req.body, {
      new: true,
      runValidators: true,
    })
    if (!doc) throw notFound('Activity not found.')
    apiResponse(res, doc)
  }),
)

// The single most common task action — a one-click done/open toggle,
// separate from the full edit form.
router.patch(
  '/:id/toggle-status',
  requirePermission('crm', 'write'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const doc = await Activity.findOne({ _id: req.params.id, orgId: req.user.orgId })
    if (!doc) throw notFound('Activity not found.')
    doc.status = doc.status === 'done' ? 'open' : 'done'
    await doc.save()
    apiResponse(res, doc)
  }),
)

router.delete(
  '/:id',
  requirePermission('crm', 'delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const doc = await Activity.findOneAndDelete({ _id: req.params.id, orgId: req.user.orgId })
    if (!doc) throw notFound('Activity not found.')
    apiResponse(res, null)
  }),
)

export default router
