// Mounts the generic CRUD factory for Contacts, Companies, Notes.
import { Router } from 'express'
import { Contact, Company } from '../models/CRM.js'
import Note from '../models/Note.js'
import { createCrudService } from '../services/crudService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { paginationQuery } from '../utils/validators.js'
import { idParam } from '../schemas/common.js'
import { contactCreate, contactUpdate, companyCreate, companyUpdate, noteCreate, noteUpdate } from '../schemas/crm.js'

const router = Router()
router.use(auth)

/** Wires the five REST endpoints for one resource onto `router`. */
function mountCrud(path, service, { createSchema, updateSchema }) {
  router.get(
    `/${path}`,
    requirePermission('crm', 'read'),
    validate({ query: paginationQuery }),
    asyncHandler(async (req, res) => {
      const { items, meta } = await service.list(req.user, req.query)
      apiResponse(res, items, meta)
    }),
  )

  router.get(
    `/${path}/:id`,
    requirePermission('crm', 'read'),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => apiResponse(res, await service.getById(req.user, req.params.id))),
  )

  router.post(
    `/${path}`,
    requirePermission('crm', 'write'),
    validate({ body: createSchema }),
    asyncHandler(async (req, res) => {
      apiResponse(res, await service.create(req.user, req.body), null, 201)
    }),
  )

  router.patch(
    `/${path}/:id`,
    requirePermission('crm', 'write'),
    validate({ params: idParam, body: updateSchema }),
    asyncHandler(async (req, res) => apiResponse(res, await service.update(req.user, req.params.id, req.body))),
  )

  router.delete(
    `/${path}/:id`,
    requirePermission('crm', 'delete'),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => {
      await service.remove(req.user, req.params.id)
      apiResponse(res, null)
    }),
  )
}

mountCrud(
  'contacts',
  createCrudService(Contact, {
    resource: 'contact',
    filterableFields: ['companyId', 'ownerId'],
    searchFields: ['name', 'email'],
    sortableFields: ['name', 'createdAt'],
    populate: { path: 'companyId', select: 'name' },
    activityLabel: 'Contact',
  }),
  { createSchema: contactCreate, updateSchema: contactUpdate },
)

mountCrud(
  'companies',
  createCrudService(Company, {
    resource: 'company',
    filterableFields: ['ownerId'],
    searchFields: ['name'],
    sortableFields: ['name', 'createdAt'],
    activityLabel: 'Company',
  }),
  { createSchema: companyCreate, updateSchema: companyUpdate },
)

mountCrud(
  'notes',
  createCrudService(Note, {
    // authorId is the note's owner field: set to the writer on create, never reassignable.
    resource: 'note',
    filterableFields: ['entityType', 'entityId'],
    sortableFields: ['createdAt'],
    populate: { path: 'authorId', select: 'name avatarUrl' },
  }),
  { createSchema: noteCreate, updateSchema: noteUpdate },
)

export default router
