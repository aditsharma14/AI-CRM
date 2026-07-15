// Org profile, teams, members/roles, invites, pipeline & template config.
import { Router } from 'express'
import { z } from 'zod'
import * as orgAdminService from '../services/orgAdminService.js'
import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { apiResponse, asyncHandler } from '../utils/http.js'
import { objectId, email, password } from '../utils/validators.js'

const router = Router()
router.use(auth)

const idParam = z.object({ id: objectId })

// ---- Org profile ----

router.get('/', asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.getOrg(req.user.orgId))))

router.patch(
  '/',
  requirePermission('org', 'manage'),
  validate({ body: z.object({ name: z.string().trim().min(2) }) }),
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.updateOrgProfile(req.user.orgId, req.body))),
)

// ---- Members ----

router.get('/members', asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.listMembers(req.user.orgId))))

router.post(
  '/members/invite',
  requirePermission('members', 'manage'),
  validate({ body: z.object({ email, role: z.enum(['admin', 'manager', 'member']) }) }),
  asyncHandler(async (req, res) => {
    await orgAdminService.inviteMember(req.user.orgId, req.body)
    apiResponse(res, null, null, 201)
  }),
)

router.patch(
  '/members/:id/role',
  requirePermission('members', 'manage'),
  validate({ params: idParam, body: z.object({ role: z.enum(['admin', 'manager', 'member']) }) }),
  asyncHandler(async (req, res) => {
    apiResponse(res, await orgAdminService.updateMemberRole(req.user.orgId, req.params.id, req.body.role))
  }),
)

router.delete(
  '/members/:id',
  requirePermission('members', 'manage'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await orgAdminService.removeMember(req.user.orgId, req.params.id)
    apiResponse(res, null)
  }),
)

// ---- Teams ----

router.get('/teams', asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.listTeams(req.user.orgId))))

router.post(
  '/teams',
  requirePermission('members', 'manage'),
  validate({ body: z.object({ name: z.string().trim().min(1) }) }),
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.createTeam(req.user.orgId, req.body.name), null, 201)),
)

router.patch(
  '/teams/:id',
  requirePermission('members', 'manage'),
  validate({ params: idParam, body: z.object({ name: z.string().trim().min(1).optional(), memberIds: z.array(objectId).optional() }) }),
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.updateTeam(req.user.orgId, req.params.id, req.body))),
)

router.delete(
  '/teams/:id',
  requirePermission('members', 'manage'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await orgAdminService.deleteTeam(req.user.orgId, req.params.id)
    apiResponse(res, null)
  }),
)

// ---- Pipeline stages ----

router.get(
  '/pipeline-stages',
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.getPipelineStages(req.user.orgId))),
)

router.patch(
  '/pipeline-stages',
  requirePermission('pipeline', 'configure'),
  validate({
    body: z.array(z.object({ key: z.string().trim().min(1), label: z.string().trim().min(1), order: z.number() })),
  }),
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.updatePipelineStages(req.user.orgId, req.body))),
)

// ---- Email templates ----

router.get(
  '/email-templates',
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.listEmailTemplates(req.user.orgId))),
)

const templateBody = z.object({
  name: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
})

router.post(
  '/email-templates',
  requirePermission('pipeline', 'configure'),
  validate({ body: templateBody }),
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.createEmailTemplate(req.user.orgId, req.body), null, 201)),
)

router.patch(
  '/email-templates/:id',
  requirePermission('pipeline', 'configure'),
  validate({ params: idParam, body: templateBody.partial() }),
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.updateEmailTemplate(req.user.orgId, req.params.id, req.body))),
)

router.delete(
  '/email-templates/:id',
  requirePermission('pipeline', 'configure'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await orgAdminService.deleteEmailTemplate(req.user.orgId, req.params.id)
    apiResponse(res, null)
  }),
)

// ---- "Me" ----

router.patch(
  '/me',
  validate({ body: z.object({ name: z.string().trim().min(1).optional(), avatarUrl: z.string().trim().optional() }) }),
  asyncHandler(async (req, res) => apiResponse(res, await orgAdminService.updateProfile(req.user.id, req.body))),
)

router.patch(
  '/me/password',
  validate({ body: z.object({ currentPassword: z.string().min(1), newPassword: password }) }),
  asyncHandler(async (req, res) => {
    await orgAdminService.changePassword(req.user.id, req.body)
    apiResponse(res, null)
  }),
)

export default router
