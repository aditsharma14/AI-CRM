// Deal CRUD + move-stage + win/loss.
import { Router } from 'express'
import * as dealsService from '../services/dealsService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { idParam } from '../schemas/common.js'
import { dealCreate, dealUpdate, dealMoveStage, dealListQuery } from '../schemas/deals.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  requirePermission('crm', 'read'),
  validate({ query: dealListQuery }),
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
  validate({ params: idParam, body: dealUpdate }),
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
  validate({ params: idParam, body: dealMoveStage }),
  asyncHandler(async (req, res) => {
    const { stageKey, wonLostReason } = req.body
    apiResponse(res, await dealsService.moveStage(req.user, req.params.id, stageKey, wonLostReason))
  }),
)

export default router
