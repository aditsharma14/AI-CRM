// @ts-check
// Lead request schemas — the validators and, via z.infer, the service input types.
import { z } from 'zod'
import { listQuery, objectId, optionalObjectId, optionalEmail, phone } from '../utils/validators.js'

export const leadCreate = z.object({
  name: z.string().trim().min(1),
  email: optionalEmail,
  phone,
  source: z.string().trim().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
  companyId: optionalObjectId,
  // Accepted from everyone; the ownership policy drops it for members.
  ownerId: optionalObjectId,
})

export const leadUpdate = leadCreate.partial()

// The client sends no body at all on a plain convert — the whole object
// is optional, not just its fields (convertToDeal defaults it to {}).
export const leadConvert = z
  .object({ title: z.string().trim().optional(), value: z.number().min(0).optional(), stageKey: z.string().optional() })
  .optional()

/** @typedef {z.infer<typeof leadCreate>} LeadCreateInput */
/** @typedef {z.infer<typeof leadUpdate>} LeadUpdateInput */
/** @typedef {NonNullable<z.infer<typeof leadConvert>>} LeadConvertInput */

// Shared by the route (listQuery) and the service (filterableFields/sortableFields).
export const leadList = {
  filters: {
    status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
    ownerId: objectId.optional(),
    companyId: objectId.optional(),
  },
  sort: ['name', 'score', 'createdAt'],
  search: true,
}
export const leadListQuery = listQuery(leadList)
/** @typedef {z.infer<typeof leadListQuery>} LeadListQuery */
