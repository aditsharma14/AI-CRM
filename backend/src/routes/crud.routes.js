// The generic CRUD factory for Contacts, Companies and Notes: one router each, mounted by app.js.
import { Router } from 'express'

import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { Company, Contact } from '../models/CRM.js'
import Note from '../models/Note.js'
import { entityModel } from '../policies/references.js'
import { idParam } from '../schemas/common.js'
import {
  companyCreate,
  companyList,
  companyListQuery,
  companyUpdate,
  contactCreate,
  contactList,
  contactListQuery,
  contactUpdate,
  noteCreate,
  noteList,
  noteListQuery,
  noteUpdate,
} from '../schemas/crm.js'
import { createCrudService } from '../services/crudService.js'
import { apiResponse, asyncHandler } from '../utils/http.js'

/** The five REST endpoints for one resource, behind auth, for app.js to mount at the resource's path. */
function crudRouter(service, { createSchema, updateSchema, listSchema }) {
  const router = Router()
  router.use(auth)

  router.get(
    '/',
    requirePermission('crm', 'read'),
    validate({ query: listSchema }),
    asyncHandler(async (req, res) => {
      const { items, meta } = await service.list(req.user, req.query)
      apiResponse(res, items, meta)
    }),
  )

  router.get(
    '/:id',
    requirePermission('crm', 'read'),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => apiResponse(res, await service.getById(req.user, req.params.id))),
  )

  router.post(
    '/',
    requirePermission('crm', 'write'),
    validate({ body: createSchema }),
    asyncHandler(async (req, res) => {
      apiResponse(res, await service.create(req.user, req.body), null, 201)
    }),
  )

  router.patch(
    '/:id',
    requirePermission('crm', 'write'),
    validate({ params: idParam, body: updateSchema }),
    asyncHandler(async (req, res) => apiResponse(res, await service.update(req.user, req.params.id, req.body))),
  )

  router.delete(
    '/:id',
    requirePermission('crm', 'delete'),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => {
      await service.remove(req.user, req.params.id)
      apiResponse(res, null)
    }),
  )

  return router
}

export const contactsRoutes = crudRouter(
  createCrudService(Contact, {
    resource: 'contact',
    list: contactList,
    searchFields: ['name', 'email'],
    populate: { path: 'companyId', select: 'name' },
    activityLabel: 'Contact',
    references: (body) => [{ field: 'companyId', model: Company, ids: body.companyId }],
  }),
  { createSchema: contactCreate, updateSchema: contactUpdate, listSchema: contactListQuery },
)

export const companiesRoutes = crudRouter(
  createCrudService(Company, {
    resource: 'company',
    list: companyList,
    searchFields: ['name'],
    activityLabel: 'Company',
  }),
  { createSchema: companyCreate, updateSchema: companyUpdate, listSchema: companyListQuery },
)

export const notesRoutes = crudRouter(
  createCrudService(Note, {
    // authorId is the note's owner field: set to the writer on create, never reassignable.
    resource: 'note',
    list: noteList,
    populate: { path: 'authorId', select: 'name avatarUrl' },
    // What a note is attached to is fixed after create, so only a create body carries entityId.
    references: (body) =>
      body.entityId === undefined
        ? []
        : [{ field: 'entityId', model: entityModel('entityType', body.entityType), ids: body.entityId }],
  }),
  { createSchema: noteCreate, updateSchema: noteUpdate, listSchema: noteListQuery },
)
