// @ts-check
// Contact, company and note request schemas — validators plus z.infer input types.
import { z } from 'zod'
import { objectId, optionalObjectId, optionalEmail, phone } from '../utils/validators.js'

export const contactCreate = z.object({
  name: z.string().trim().min(1),
  email: optionalEmail,
  phone,
  title: z.string().trim().optional(),
  companyId: optionalObjectId,
  tags: z.array(z.string()).optional(),
  // Accepted from everyone; the ownership policy drops it for members.
  ownerId: optionalObjectId,
})

export const contactUpdate = contactCreate.partial()

export const companyCreate = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().toLowerCase().optional(),
  industry: z.string().trim().optional(),
  size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
  ownerId: optionalObjectId,
})

export const companyUpdate = companyCreate.partial()

export const noteCreate = z.object({
  entityType: z.enum(['lead', 'contact', 'company', 'deal']),
  entityId: objectId,
  body: z.string().trim().min(1).max(5000),
})

// Only the text of a note is editable; what it's attached to is fixed.
export const noteUpdate = z.object({ body: z.string().trim().min(1).max(5000) })

/** @typedef {z.infer<typeof contactCreate>} ContactCreateInput */
/** @typedef {z.infer<typeof companyCreate>} CompanyCreateInput */
/** @typedef {z.infer<typeof noteCreate>} NoteCreateInput */
/** @typedef {z.infer<typeof noteUpdate>} NoteUpdateInput */
