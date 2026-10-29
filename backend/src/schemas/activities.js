// @ts-check
// Task/event request schemas — the validators and, via z.infer, the service input types.
import { z } from 'zod'
import { paginationQuery, objectId, optionalObjectId, optionalDate } from '../utils/validators.js'

export const activityCreate = z.object({
  type: z.enum(['task', 'event', 'call', 'meeting']),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  assigneeId: optionalObjectId,
  linkedTo: z
    .object({ entityType: z.enum(['lead', 'contact', 'company', 'deal']), entityId: objectId })
    .optional(),
  dueDate: optionalDate,
  priority: z.enum(['low', 'medium', 'high']).optional(),
  startAt: optionalDate,
  endAt: optionalDate,
  allDay: z.boolean().optional(),
  status: z.enum(['open', 'done']).optional(),
})

export const activityUpdate = activityCreate.partial()

export const activityListQuery = paginationQuery.extend({
  type: z.enum(['task', 'event', 'call', 'meeting']).optional(),
  status: z.enum(['open', 'done']).optional(),
  assigneeId: objectId.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

/** @typedef {z.infer<typeof activityCreate>} ActivityCreateInput */
/** @typedef {z.infer<typeof activityUpdate>} ActivityUpdateInput */
/** @typedef {z.infer<typeof activityListQuery>} ActivityListQuery */
