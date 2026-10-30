// @ts-check
// Deal request schemas — the validators and, via z.infer, the service input types.
import { z } from 'zod'
import { listQuery, objectId, optionalObjectId, stageKeyParam } from '../utils/validators.js'

export const dealCreate = z.object({
  title: z.string().trim().min(1),
  value: z.number().min(0),
  currency: z.string().trim().optional(),
  // Optional: dealsService.create defaults to the org's first stage and checks it is one of the org's.
  stageKey: z.string().trim().min(1).optional(),
  probability: z.number().min(0).max(100).optional(),
  companyId: optionalObjectId,
  contactIds: z.array(objectId).optional(),
  // Accepted from everyone; the ownership policy drops it for members.
  ownerId: optionalObjectId,
})

export const dealUpdate = dealCreate.partial()

export const dealMoveStage = z.object({ stageKey: z.string().trim().min(1), wonLostReason: z.string().trim().optional() })

/** @typedef {z.infer<typeof dealCreate>} DealCreateInput */
/** @typedef {z.infer<typeof dealUpdate>} DealUpdateInput */
/** @typedef {z.infer<typeof dealMoveStage>} DealMoveStageInput */

// Shared by the route (listQuery) and the service (filterableFields/sortableFields).
export const dealList = {
  filters: {
    stageKey: stageKeyParam.optional(),
    status: z.enum(['open', 'won', 'lost']).optional(),
    ownerId: objectId.optional(),
    companyId: objectId.optional(),
  },
  sort: ['value', 'createdAt', 'closedAt'],
}
export const dealListQuery = listQuery(dealList)
/** @typedef {z.infer<typeof dealListQuery>} DealListQuery */
