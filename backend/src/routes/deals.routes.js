// Deal CRUD + move-stage + win/loss.
import { Router } from 'express'
import { z } from 'zod'
import * as dealsService from '../services/dealsService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { paginationQuery, objectId, optionalObjectId } from '../utils/validators.js'

const router = Router()
router.use(auth)

const idParam = z.object({ id: objectId })

const dealCreate = z.object({
  title: z.string().trim().min(1),
  value: z.number().min(0),
  currency: z.string().trim().optional(),
  stageKey: z.string().trim().min(1),
  probability: z.number().min(0).max(100).optional(),
  companyId: optionalObjectId,
  contactIds: z.array(objectId).optional(),
  // Accepted from everyone; the ownership policy drops it for members.
  ownerId: optionalObjectId,
})

router.get(
  '/',
  requirePermission('crm', 'read'),
  validate({ query: paginationQuery }),
  asyncHandler(async (req, res) => {
    const { items, meta } = await dealsService.crud.list(req.user, req.query)
    apiResponse(res, items, meta)
  }),
)

router.get(
  '/:id',
  requirePermission('crm', 'read'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => apiResponse(res, await dealsService.crud.getById(req.user, req.params.id))),
)

router.post(
  '/',
  requirePermission('crm', 'write'),
  validate({ body: dealCreate }),
  asyncHandler(async (req, res) => {
    apiResponse(res, await dealsService.crud.create(req.user, req.body), null, 201)
  }),
)

router.patch(
  '/:id',
  requirePermission('crm', 'write'),
  validate({ params: idParam, body: dealCreate.partial() }),
  asyncHandler(async (req, res) => apiResponse(res, await dealsService.crud.update(req.user, req.params.id, req.body))),
)

router.delete(
  '/:id',
  requirePermission('crm', 'delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await dealsService.crud.remove(req.user, req.params.id)
    apiResponse(res, null)
  }),
)

router.patch(
  '/:id/move-stage',
  requirePermission('crm', 'write'),
  validate({ params: idParam, body: z.object({ stageKey: z.string().trim().min(1), wonLostReason: z.string().trim().optional() }) }),
  asyncHandler(async (req, res) => {
    const { stageKey, wonLostReason } = req.body
    apiResponse(res, await dealsService.moveStage(req.user, req.params.id, stageKey, wonLostReason))
  }),
)

export default router
