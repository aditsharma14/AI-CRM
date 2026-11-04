// AI endpoints. Express owns auth, tenancy and data; the FastAPI service only ever sees aiBriefService's bundle.
import { Router } from 'express'

import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { leadBriefBody } from '../schemas/ai.js'
import { idParam } from '../schemas/common.js'
import { generateLeadBrief } from '../services/aiBriefService.js'
import { apiResponse, asyncHandler } from '../utils/http.js'

const router = Router()
router.use(auth)

router.post(
  '/leads/:id/brief',
  requirePermission('ai', 'use'),
  validate({ params: idParam, body: leadBriefBody }),
  asyncHandler(async (req, res) => {
    apiResponse(res, await generateLeadBrief(req.user, req.params.id, req.body ?? {}, req.log))
  }),
)

export default router
