// Mounts the generic CRUD factory for Contacts, Companies, Notes.
import { Router } from 'express'
import { z } from 'zod'
import { Contact, Company } from '../models/CRM.js'
import Note from '../models/Note.js'
import { createCrudService } from '../services/crudService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { paginationQuery, objectId, optionalObjectId, optionalEmail, phone } from '../utils/validators.js'

const router = Router()
router.use(auth)

const idParam = z.object({ id: objectId })

/** Wires the five REST endpoints for one resource onto `router`. */
function mountCrud(path, service, { createSchema, updateSchema }) {
  router.get(
    `/${path}`,
    requirePermission('crm', 'read'),
    validate({ query: paginationQuery }),
    asyncHandler(async (req, res) => {
      const { items, meta } = await service.list(req.user.orgId, req.query)
      apiResponse(res, items, meta)
    }),
  )

  router.get(
    `/${path}/:id`,
    requirePermission('crm', 'read'),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => apiResponse(res, await service.getById(req.user.orgId, req.params.id))),
  )

  router.post(
    `/${path}`,
    requirePermission('crm', 'write'),
    validate({ body: createSchema }),
    asyncHandler(async (req, res) => {
      apiResponse(res, await service.create(req.user.orgId, req.user.id, req.body), null, 201)
    }),
  )

  router.patch(
    `/${path}/:id`,
    requirePermission('crm', 'write'),
    validate({ params: idParam, body: updateSchema }),
    asyncHandler(async (req, res) => apiResponse(res, await service.update(req.user.orgId, req.user.id, req.params.id, req.body))),
  )

  router.delete(
    `/${path}/:id`,
    requirePermission('crm', 'delete'),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => {
      await service.remove(req.user.orgId, req.user.id, req.params.id)
      apiResponse(res, null)
    }),
  )
}

const contactCreate = z.object({
  name: z.string().trim().min(1),
  email: optionalEmail,
  phone,
  title: z.string().trim().optional(),
  companyId: optionalObjectId,
  tags: z.array(z.string()).optional(),
})
mountCrud(
  'contacts',
  createCrudService(Contact, {
    filterableFields: ['companyId', 'ownerId'],
    searchFields: ['name', 'email'],
    sortableFields: ['name', 'createdAt'],
    populate: { path: 'companyId', select: 'name' },
    activityLabel: 'Contact',
  }),
  { createSchema: contactCreate, updateSchema: contactCreate.partial() },
)

const companyCreate = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().toLowerCase().optional(),
  industry: z.string().trim().optional(),
  size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
})
mountCrud(
  'companies',
  createCrudService(Company, {
    filterableFields: ['ownerId'],
    searchFields: ['name'],
    sortableFields: ['name', 'createdAt'],
    activityLabel: 'Company',
  }),
  { createSchema: companyCreate, updateSchema: companyCreate.partial() },
)

const noteCreate = z.object({
  entityType: z.enum(['lead', 'contact', 'company', 'deal']),
  entityId: objectId,
  body: z.string().trim().min(1).max(5000),
})
mountCrud(
  'notes',
  createCrudService(Note, {
    filterableFields: ['entityType', 'entityId'],
    sortableFields: ['createdAt'],
    populate: { path: 'authorId', select: 'name avatarUrl' },
    extraCreateFields: (orgId, actorId) => ({ orgId, authorId: actorId }),
  }),
  { createSchema: noteCreate, updateSchema: z.object({ body: z.string().trim().min(1).max(5000) }) },
)

export default router
