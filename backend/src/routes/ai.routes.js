// AI endpoints. Express owns auth, tenancy and data; the FastAPI service only ever sees aiBriefService's bundle, sent
// by a worker process (src/worker.js) that runs the queued job.
import { Router } from 'express'

import { auth } from '../middleware/auth.js'
import { requirePermission, validate } from '../middleware/guards.js'
import { jobIdParam, leadBriefBody } from '../schemas/ai.js'
import { idParam } from '../schemas/common.js'
import { requestLeadBrief } from '../services/aiBriefService.js'
import { getJob, queueStats } from '../services/aiJobService.js'
import { apiResponse, asyncHandler } from '../utils/http.js'

const router = Router()
router.use(auth)

// 200 with the cached brief, or 202 { jobId }: poll GET /jobs/:jobId.
router.post(
  '/leads/:id/brief',
  requirePermission('ai', 'use'),
  validate({ params: idParam, body: leadBriefBody }),
  asyncHandler(async (req, res) => {
    const { status, data } = await requestLeadBrief(req.user, req.params.id, req.body ?? {}, req.log)
    apiResponse(res, data, null, status)
  }),
)

router.get(
  '/jobs/:jobId',
  requirePermission('ai', 'use'),
  validate({ params: jobIdParam }),
  asyncHandler(async (req, res) => {
    apiResponse(res, await getJob(req.user, req.params.jobId))
  }),
)

// The org's queue, for its owner (org:manage is owner-only): S2.6 alerts build on these numbers.
router.get(
  '/queue/stats',
  requirePermission('org', 'manage'),
  asyncHandler(async (req, res) => {
    apiResponse(res, await queueStats(req.user))
  }),
)

export default router
