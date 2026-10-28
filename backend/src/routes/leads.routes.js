// Lead CRUD + convert-to-deal + rescore trigger.
import { Router } from 'express'
import { z } from 'zod'
import * as leadsService from '../services/leadsService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { paginationQuery, objectId, optionalObjectId, optionalEmail, phone } from '../utils/validators.js'

const router = Router()
router.use(auth)

const idParam = z.object({ id: objectId })

const leadCreate = z.object({
  name: z.string().trim().min(1),
  email: optionalEmail,
  phone,
  source: z.string().trim().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
  companyId: optionalObjectId,
  // Accepted from everyone; the ownership policy drops it for members.
  ownerId: optionalObjectId,
})

router.get(
  '/',
  requirePermission('crm', 'read'),
  validate({ query: paginationQuery }),
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
  validate({ params: idParam, body: leadCreate.partial() }),
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
  validate({
    params: idParam,
    // The client sends no body at all on a plain convert — the whole object
    // is optional, not just its fields (convertToDeal defaults it to {}).
    body: z.object({ title: z.string().trim().optional(), value: z.number().min(0).optional(), stageKey: z.string().optional() }).optional(),
  }),
  asyncHandler(async (req, res) => {
    apiResponse(res, await leadsService.convertToDeal(req.user, req.params.id, req.body), null, 201)
  }),
)

export default router
