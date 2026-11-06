// @ts-check
// AI request schemas, and the AI service's answers, which Express re-validates before trusting them.
import { z } from 'zod'

import { objectId } from '../utils/validators.js'

/** POST /api/v1/ai/leads/:id/brief. `refresh` skips the cache (and counts against the per-lead refresh limit). */
export const leadBriefBody = z.object({ refresh: z.boolean().optional() }).strict()

/** GET /api/v1/ai/jobs/:jobId */
export const jobIdParam = z.object({ jobId: objectId })

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** The brief itself, as the AI service returns it (AI/app/lead_brief/models.py). */
export const leadBrief = z
  .object({
    summary: z.string().min(1).max(800),
    nextAction: z.object({ action: z.string().min(1).max(200), dueDate: isoDate }).strict(),
    followUpEmail: z.object({ subject: z.string().min(1).max(120), body: z.string().min(1).max(2000) }).strict(),
    citations: z
      .array(z.object({ claim: z.string().min(1).max(300), sourceIds: z.array(z.string()).max(10) }).strict())
      .max(10),
  })
  .strict()

/** The AI service's per-call numbers (counts only; never content). */
export const aiCallMeta = z.object({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0).default(0),
  latencyMs: z.number().int().min(0).optional(),
  firstTokenMs: z.number().int().min(0).nullable().optional(),
  attempts: z.number().int().min(0).optional(),
  citationsRejected: z.number().int().min(0).default(0),
})

export const leadBriefAnswer = z.object({ brief: leadBrief, meta: aiCallMeta })

/** GET /v1/info: what, besides the input, decides a brief (part of the cache key). */
export const aiInfo = z.object({ provider: z.string(), model: z.string(), promptVersion: z.string() })

/** @typedef {z.infer<typeof leadBriefBody>} LeadBriefBody */
/** @typedef {z.infer<typeof jobIdParam>} JobIdParam */
/** @typedef {z.infer<typeof leadBrief>} LeadBrief */
/** @typedef {z.infer<typeof aiCallMeta>} AiCallMeta */
/** @typedef {z.infer<typeof aiInfo>} AiInfo */
