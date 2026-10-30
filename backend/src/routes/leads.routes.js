// Lead CRUD + convert-to-deal + rescore trigger.
import { Router } from 'express'
import * as leadsService from '../services/leadsService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { idParam } from '../schemas/common.js'
import { leadCreate, leadUpdate, leadConvert, leadListQuery } from '../schemas/leads.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  requirePermission('crm', 'read'),
  validate({ query: leadListQuery }),
  asyncHandler(async (req, res) => {
    const { items, meta } = await leadsService.crud.list(req.user, req.query)
    apiResponse(res, items, meta)
  }),
)

router.get(
  '/:id',
  requirePermission('crm', 'read'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => apiResponse(res, await leadsService.crud.getById(req.user, req.params.id))),
)

router.post(
  '/',
  requirePermission('crm', 'write'),
  validate({ body: leadCreate }),
  asyncHandler(async (req, res) => {
    apiResponse(res, await leadsService.crud.create(req.user, req.body), null, 201)
  }),
)

router.patch(
  '/:id',
  requirePermission('crm', 'write'),
  validate({ params: idParam, body: leadUpdate }),
  asyncHandler(async (req, res) => apiResponse(res, await leadsService.crud.update(req.user, req.params.id, req.body))),
)

router.delete(
  '/:id',
  requirePermission('crm', 'delete'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await leadsService.crud.remove(req.user, req.params.id)
    apiResponse(res, null)
  }),
)

router.post(
  '/:id/convert',
  requirePermission('crm', 'write'),
  validate({ params: idParam, body: leadConvert }),
  asyncHandler(async (req, res) => {
    apiResponse(res, await leadsService.convertToDeal(req.user, req.params.id, req.body), null, 201)
  }),
)

export default router
