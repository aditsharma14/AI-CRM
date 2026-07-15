// Stage-transition validation, win/loss side effects, logging/notifying.
import Deal from '../models/Deal.js'
import Organization from '../models/Organization.js'
import { createCrudService } from './crudService.js'
import { logActivity, notify } from './activityService.js'
import { badRequest, notFound } from '../utils/http.js'

export const crud = createCrudService(Deal, {
  filterableFields: ['stageKey', 'ownerId', 'status', 'companyId'],
  sortableFields: ['value', 'createdAt', 'closedAt'],
  populate: [
    { path: 'companyId', select: 'name' },
    { path: 'contactIds', select: 'name' },
  ],
  activityLabel: 'Deal',
})

export async function moveStage(orgId, actorId, dealId, stageKey, wonLostReason) {
  const org = await Organization.findById(orgId).select('pipelineStages')
  const stage = org.pipelineStages.find((s) => s.key === stageKey)
  if (!stage) throw badRequest(`Unknown pipeline stage "${stageKey}".`, 'INVALID_STAGE')

  const deal = await Deal.findOne({ _id: dealId, orgId })
  if (!deal) throw notFound('Deal not found.')

  deal.stageKey = stageKey
  if (stageKey === 'won' || stageKey === 'lost') {
    deal.status = stageKey
    deal.closedAt = new Date()
    if (wonLostReason) deal.wonLostReason = wonLostReason
  } else {
    deal.status = 'open'
    deal.closedAt = undefined
  }
  await deal.save()

  await logActivity({
    orgId,
    userId: actorId,
    action: 'move-stage',
    entityType: 'deal',
    entityId: deal._id,
    message: `Moved deal "${deal.title}" to ${stage.label}`,
  })

  if (stageKey === 'won' || stageKey === 'lost') {
    await notify({
      orgId,
      userId: deal.ownerId,
      entityType: 'deal',
      entityId: deal._id,
      message: `Deal "${deal.title}" was marked ${stageKey}.`,
    })
  }

  return deal
}
