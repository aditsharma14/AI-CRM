// Convert-to-deal transaction; triggers an AI rescoring call.
import { Lead } from '../models/CRM.js'
import Deal from '../models/Deal.js'
import Organization from '../models/Organization.js'
import { createCrudService } from './crudService.js'
import { logActivity, notify } from './activityService.js'
import { badRequest, notFound } from '../utils/http.js'
import { missOrForbidden, scopeFor } from '../policies/ownership.js'

export const crud = createCrudService(Lead, {
  resource: 'lead',
  filterableFields: ['status', 'ownerId', 'companyId'],
  searchFields: ['name', 'email'],
  sortableFields: ['name', 'score', 'createdAt'],
  populate: { path: 'companyId', select: 'name' },
  activityLabel: 'Lead',
})

export async function convertToDeal(actor, leadId, dealInput = {}) {
  const { orgId, id: actorId } = actor
  // Converting changes the lead, so it's a write: members may convert only
  // their own. The new deal goes to the lead's owner, as before.
  const lead = await Lead.findOne({ _id: leadId, orgId, ...scopeFor(actor, 'lead', 'write') })
  if (!lead) throw await missOrForbidden(Lead, actor, leadId)
  if (lead.status === 'converted') throw badRequest('This lead has already been converted.', 'ALREADY_CONVERTED')

  const org = await Organization.findById(orgId).select('pipelineStages')
  if (!org) throw notFound('Organization not found.')
  const [firstStage] = [...org.pipelineStages].sort((a, b) => a.order - b.order)

  const deal = await Deal.create({
    orgId,
    title: dealInput.title || lead.name,
    value: dealInput.value ?? 0,
    stageKey: dealInput.stageKey || firstStage?.key || 'new',
    companyId: lead.companyId,
    ownerId: lead.ownerId,
    convertedFromLeadId: lead._id,
  })

  lead.status = 'converted'
  lead.convertedToDealId = deal._id
  lead.convertedAt = new Date()
  await lead.save()

  await logActivity({
    orgId,
    userId: actorId,
    action: 'convert',
    entityType: 'lead',
    entityId: lead._id,
    message: `Converted lead "${lead.name}" into a deal`,
  })
  await notify({
    orgId,
    userId: lead.ownerId,
    entityType: 'deal',
    entityId: deal._id,
    message: `Lead "${lead.name}" was converted into a deal.`,
  })

  return deal
}
