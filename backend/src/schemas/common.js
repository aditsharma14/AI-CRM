// @ts-check
// Request schemas shared by every resource router.
import { z } from 'zod'
import { objectId } from '../utils/validators.js'

/** `/:id` route params. */
export const idParam = z.object({ id: objectId })

/** @typedef {z.infer<typeof idParam>} IdParam */
