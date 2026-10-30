// Task + calendar-event CRUD over the shared Activity model.
import { Router } from 'express'
import * as activitiesService from '../services/activitiesService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { idParam } from '../schemas/common.js'
import { activityCreate, activityUpdate, activityListQuery } from '../schemas/activities.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  requirePermission('crm', 'read'),
  validate({ query: activityListQuery }),
  asyncHandler(async (req, res) => {
    const { items, meta } = await activitiesService.list(req.user, req.query)
    apiResponse(res, items, meta)
  }),
)

router.get(
  '/:id',
  requirePermission('crm', 'read'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => apiResponse(res, await activitiesService.crud.getById(req.user, req.params.id))),
)

router.post(
  '/',
  requirePermission('crm', 'write'),
  validate({ body: activityCreate }),
  asyncHandler(async (req, res) => apiResponse(res, await activitiesService.create(req.user, req.body), null, 201)),
)

router.patch(
  '/:id',
  requirePermission('crm', 'write'),
  validate({ params: idParam, body: activityUpdate }),
  asyncHandler(async (req, res) =>
    apiResponse(res, await activitiesService.crud.update(req.user, req.params.id, req.body)),
  ),
)

// The single most common task action — a one-click done/open toggle,
// separate from the full edit form.
router.patch(
  '/:id/toggle-status',
  requirePermission('crm', 'write'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => apiResponse(res, await activitiesService.toggleStatus(req.user, req.params.id))),
)

router.delete(
  '/:id',
  requirePermission('crm', 'delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await activitiesService.crud.remove(req.user, req.params.id)
    apiResponse(res, null)
  }),
)

export default router
