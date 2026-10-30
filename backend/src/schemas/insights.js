// @ts-check
// Search request schema.
import { z } from 'zod'

export const searchQuery = z.object({ q: z.string().trim().min(1) })

/** @typedef {z.infer<typeof searchQuery>} SearchQuery */
